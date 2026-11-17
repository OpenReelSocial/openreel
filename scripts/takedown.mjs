#!/usr/bin/env node
// Takes an account or a single record down (#120), or lifts a takedown:
//
//   SUBJECT=did:plc:... make takedown                    # an account
//   SUBJECT=at://did:plc:.../social.openreel.video.post/... make takedown
//   SUBJECT=... REVERSE=1 make takedown                  # lift it again
//
// It calls com.atproto.admin.updateSubjectStatus on the PDS and then on the
// AppView. The PDS stops serving the subject (and a taken-down account can no
// longer sign in or write); the AppView drops it from feeds and comments and
// queues its renditions for removal from storage and the CDN. The AppView
// needs telling directly because a record takedown emits nothing on the
// firehose.
//
// Against the shared AWS environment, with the admin password read from
// Parameter Store (never printed):
//   AWS_PROFILE=openreel-dev PUBLIC_URL=https://dev.openreel.social SUBJECT=... make takedown
// or pass PDS_ADMIN_PASSWORD yourself. Locally it is in .env.

import { execFileSync } from 'node:child_process'
import { Buffer } from 'node:buffer'

import { endpoints, jsonRequest } from './lib/atproto.mjs'

const subject = (process.env.SUBJECT ?? '').trim()
const applied = !['1', 'true', 'yes'].includes((process.env.REVERSE ?? '').toLowerCase())
const ref = process.env.REF ?? `takedown ${new Date().toISOString()}`
const { pdsUrl, appviewUrl } = endpoints()

const isDid = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(subject)
const isUri = /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._:~-]+$/.test(
  subject,
)
if (!isDid && !isUri) {
  throw new Error('set SUBJECT to an account DID (did:plc:...) or a record AT-URI (at://...)')
}

function adminPassword() {
  if (process.env.PDS_ADMIN_PASSWORD) return process.env.PDS_ADMIN_PASSWORD
  if (!process.env.AWS_PROFILE) {
    throw new Error('set PDS_ADMIN_PASSWORD, or AWS_PROFILE to read it from Parameter Store')
  }
  const name = `${process.env.PARAMETER_PATH ?? '/openreel/dev'}/PDS_ADMIN_PASSWORD`
  return execFileSync(
    'aws',
    [
      'ssm',
      'get-parameter',
      '--region',
      process.env.AWS_REGION ?? 'us-east-1',
      '--name',
      name,
      '--with-decryption',
      '--query',
      'Parameter.Value',
      '--output',
      'text',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim()
}

const authorization = `Basic ${Buffer.from(`admin:${adminPassword()}`).toString('base64')}`

/** The PDS wants a strongRef for a record; its admin view has the CID even once taken down. */
async function subjectRef() {
  if (isDid) return { $type: 'com.atproto.admin.defs#repoRef', did: subject }
  const status = await jsonRequest(
    `${pdsUrl}/xrpc/com.atproto.admin.getSubjectStatus?${new URLSearchParams({ uri: subject })}`,
    { headers: { authorization } },
  )
  if (typeof status?.subject?.cid !== 'string') throw new Error(`the PDS has no record ${subject}`)
  return { $type: 'com.atproto.repo.strongRef', uri: subject, cid: status.subject.cid }
}

function updateSubjectStatus(base, body) {
  return jsonRequest(`${base}/xrpc/com.atproto.admin.updateSubjectStatus`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(body),
  })
}

const body = { subject: await subjectRef(), takedown: { applied, ...(applied ? { ref } : {}) } }
const verb = applied ? 'Took down' : 'Lifted the takedown of'

await updateSubjectStatus(pdsUrl, body)
console.log(`${verb} ${subject} on the PDS (${pdsUrl})`)
await updateSubjectStatus(appviewUrl, body)
console.log(`${verb} ${subject} on the AppView (${appviewUrl})`)

if (applied) {
  console.log('Feeds and comments stop serving it now; its renditions are deleted, and on')
  console.log('AWS invalidated on CloudFront, within a minute or two.')
} else {
  console.log('The AppView indexes it again the next time its author writes it; content it')
  console.log('already removed is not restored (see infra/README.md).')
}
