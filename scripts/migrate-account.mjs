#!/usr/bin/env node
// Moves an account from one PDS to another with the protocol's own migration
// flow (the sequence `goat account migrate` uses), so the DID, its records,
// and its blobs move, and the account's PLC document is updated to name the
// new PDS. OpenReel's AppView follows the move through the relay (ADR-0008).
//
// Two runs, because the PLC change needs a token the old PDS would email:
//
//   1. OLD_PDS_URL=https://dev.openreel.social NEW_PDS_URL=https://pds2.dev.openreel.social \
//        MIGRATE_HANDLE=alice.dev.openreel.social MIGRATE_PASSWORD=... make migrate-account
//      requests the token and says how to read it (our PDSs send no mail):
//        AWS_PROFILE=openreel-dev make aws-plc-token DID=did:plc:...
//   2. The same command with PLC_TOKEN=... performs the migration.
//
// NEW_PDS_ADMIN_PASSWORD mints an invite on the new PDS if it requires one
// (on AWS, the /openreel/dev/PDS2_ADMIN_PASSWORD parameter). NEW_HANDLE
// defaults to the old handle's first label under the new PDS's domain.
// Rerunning after a failure resumes: an account already created on the new
// PDS is signed into rather than created again.

import { Buffer } from 'node:buffer'

import { jsonRequest } from './lib/atproto.mjs'

const trim = (url) => url.replace(/\/+$/, '')
const required = (name) => {
  const value = process.env[name]
  if (!value) throw new Error(`set ${name}`)
  return value
}

const oldPds = trim(process.env.OLD_PDS_URL ?? process.env.PUBLIC_URL ?? 'http://localhost:3000')
const newPds = trim(required('NEW_PDS_URL'))
const handle = required('MIGRATE_HANDLE')
const password = required('MIGRATE_PASSWORD')
const plcToken = process.env.PLC_TOKEN

const bearer = (token) => ({ authorization: `Bearer ${token}` })

function xrpc(base, method, { token, query, body, headers = {} } = {}) {
  const url = `${base}/xrpc/${method}${query ? `?${new URLSearchParams(query)}` : ''}`
  const init = { headers: { ...headers, ...(token ? bearer(token) : {}) } }
  // `body: null` is a procedure without input: POST with no body at all.
  if (body !== undefined) {
    init.method = 'POST'
    if (body === null) {
      // Nothing to send.
    } else if (body instanceof Uint8Array) {
      init.body = body
    } else {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(body)
    }
  }
  return jsonRequest(url, init)
}

async function bytes(base, method, query) {
  const response = await fetch(`${base}/xrpc/${method}?${new URLSearchParams(query)}`)
  if (!response.ok)
    throw new Error(`${method} failed (${response.status}): ${await response.text()}`)
  return {
    data: new Uint8Array(await response.arrayBuffer()),
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  }
}

const old = await xrpc(oldPds, 'com.atproto.server.createSession', {
  body: { identifier: handle, password },
})
const did = old.did
console.log(`Signed in to ${oldPds} as ${old.handle} (${did})`)

if (!plcToken) {
  await xrpc(oldPds, 'com.atproto.identity.requestPlcOperationSignature', {
    token: old.accessJwt,
    body: null,
  })
  console.log('\nRequested a PLC operation token. Our PDSs send no mail; read it with')
  console.log(`  AWS_PROFILE=openreel-dev make aws-plc-token DID=${did}`)
  console.log(
    '(add SERVICE=pds2 if the account is on the second PDS), then rerun with PLC_TOKEN=...',
  )
  process.exit(0)
}

const server = await xrpc(newPds, 'com.atproto.server.describeServer')
const domain = server.availableUserDomains?.[0]
const newHandle = process.env.NEW_HANDLE ?? `${handle.split('.')[0]}${domain}`

// 1. An account on the new PDS with the same DID, authorized by the old PDS.
let fresh
try {
  fresh = await xrpc(newPds, 'com.atproto.server.createSession', {
    body: { identifier: did, password },
  })
  console.log(`Resuming: ${did} already exists on ${newPds}`)
} catch {
  const { token: serviceAuth } = await xrpc(oldPds, 'com.atproto.server.getServiceAuth', {
    token: old.accessJwt,
    query: { aud: server.did, lxm: 'com.atproto.server.createAccount' },
  })
  let inviteCode
  if (server.inviteCodeRequired) {
    const admin = required('NEW_PDS_ADMIN_PASSWORD')
    ;({ code: inviteCode } = await xrpc(newPds, 'com.atproto.server.createInviteCode', {
      headers: { authorization: `Basic ${Buffer.from(`admin:${admin}`).toString('base64')}` },
      body: { useCount: 1 },
    }))
  }
  fresh = await xrpc(newPds, 'com.atproto.server.createAccount', {
    token: serviceAuth,
    body: {
      did,
      handle: newHandle,
      email: process.env.NEW_EMAIL ?? old.email ?? `${did.replaceAll(':', '-')}@example.com`,
      password,
      ...(inviteCode ? { inviteCode } : {}),
    },
  })
  console.log(`Created ${newHandle} on ${newPds} (deactivated until the move completes)`)
}

// 2. The repository, then every blob it references that the new PDS lacks.
const repo = await bytes(oldPds, 'com.atproto.sync.getRepo', { did })
await xrpc(newPds, 'com.atproto.repo.importRepo', {
  token: fresh.accessJwt,
  headers: { 'content-type': 'application/vnd.ipld.car' },
  body: repo.data,
})
console.log(`Imported the repository (${repo.data.length} bytes)`)

let cursor
let copied = 0
do {
  const page = await xrpc(newPds, 'com.atproto.repo.listMissingBlobs', {
    token: fresh.accessJwt,
    query: { limit: '500', ...(cursor ? { cursor } : {}) },
  })
  for (const { cid } of page.blobs) {
    const blob = await bytes(oldPds, 'com.atproto.sync.getBlob', { did, cid })
    await xrpc(newPds, 'com.atproto.repo.uploadBlob', {
      token: fresh.accessJwt,
      headers: { 'content-type': blob.type },
      body: blob.data,
    })
    copied++
  }
  cursor = page.cursor
} while (cursor)
console.log(`Copied ${copied} blob(s)`)

try {
  const prefs = await xrpc(oldPds, 'app.bsky.actor.getPreferences', { token: old.accessJwt })
  await xrpc(newPds, 'app.bsky.actor.putPreferences', { token: fresh.accessJwt, body: prefs })
} catch (error) {
  // OpenReel keeps no preferences on the PDS; carry on without them.
  console.warn(`Skipped preferences: ${error.message}`)
}

// 3. Point the DID at the new PDS: the new PDS proposes its credentials, the
// old PDS (holding the current rotation key) signs, the new one submits.
const credentials = await xrpc(newPds, 'com.atproto.identity.getRecommendedDidCredentials', {
  token: fresh.accessJwt,
})
const { operation } = await xrpc(oldPds, 'com.atproto.identity.signPlcOperation', {
  token: old.accessJwt,
  body: { token: plcToken, ...credentials },
})
await xrpc(newPds, 'com.atproto.identity.submitPlcOperation', {
  token: fresh.accessJwt,
  body: { operation },
})
console.log('Updated the PLC document to name the new PDS')

// 4. Switch over.
await xrpc(newPds, 'com.atproto.server.activateAccount', { token: fresh.accessJwt, body: null })
await xrpc(oldPds, 'com.atproto.server.deactivateAccount', { token: old.accessJwt, body: {} })
console.log(`\nMoved ${did} to ${newPds} as ${newHandle}. Sign in there from now on.`)
