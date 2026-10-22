// Shared helpers for the scripts that talk to a running OpenReel deployment
// (seed-videos, smoke, e2e-upload): endpoint defaults, PDS sessions, posting.

import { Buffer } from 'node:buffer'

const trim = (url) => url.replace(/\/+$/, '')

/**
 * Endpoints from the environment. A deployed host serves the PDS at the origin
 * root and the other services under paths of it (ADR-0007); the local stack
 * (`make up`) serves each on its own port.
 */
export function endpoints(env = process.env) {
  const pdsUrl = trim(env.PUBLIC_URL ?? env.PDS_URL ?? 'http://localhost:3000')
  const deployed = pdsUrl.startsWith('https://')
  return {
    pdsUrl,
    appviewUrl: trim(env.APPVIEW_URL ?? (deployed ? `${pdsUrl}/appview` : 'http://localhost:3001')),
    plcUrl: trim(env.PLC_URL ?? (deployed ? `${pdsUrl}/plc` : 'http://localhost:2582')),
  }
}

export async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

export function xrpcPost(pdsUrl, method, body, token) {
  return jsonRequest(`${pdsUrl}/xrpc/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

/**
 * Signs in as SEED_HANDLE/SEED_PASSWORD, or creates a disposable demo account
 * (with an invite minted via PDS_ADMIN_PASSWORD when the PDS requires one).
 * The handle domain is HANDLE_DOMAIN, else the PDS's first available domain;
 * HANDLE_PREFIX replaces "demo" in the handle.
 */
export async function session(pdsUrl, env = process.env) {
  if (env.SEED_HANDLE && env.SEED_PASSWORD) {
    return xrpcPost(pdsUrl, 'com.atproto.server.createSession', {
      identifier: env.SEED_HANDLE,
      password: env.SEED_PASSWORD,
    })
  }

  let inviteCode
  if (env.PDS_ADMIN_PASSWORD) {
    const auth = Buffer.from(`admin:${env.PDS_ADMIN_PASSWORD}`).toString('base64')
    const invite = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.server.createInviteCode`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
      body: JSON.stringify({ useCount: 1 }),
    })
    inviteCode = invite.code
  }

  let handleDomain = env.HANDLE_DOMAIN
  if (!handleDomain) {
    const server = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.server.describeServer`)
    handleDomain = server.availableUserDomains?.[0] ?? '.pds.example.com'
  }

  const prefix = env.HANDLE_PREFIX ?? 'demo'
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 6)
  const password = `openreel-demo-${crypto.randomUUID()}`
  const account = await xrpcPost(pdsUrl, 'com.atproto.server.createAccount', {
    handle: `${prefix}-${suffix}${handleDomain}`,
    email: `${prefix}-${suffix}@example.com`,
    password,
    ...(inviteCode ? { inviteCode } : {}),
  })
  console.log(`Created ${account.handle} (password: ${password})`)
  return account
}

export async function uploadBlob(pdsUrl, { accessJwt }, bytes, mimeType) {
  const { blob } = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.repo.uploadBlob`, {
    method: 'POST',
    headers: { 'content-type': mimeType, authorization: `Bearer ${accessJwt}` },
    body: bytes,
  })
  return blob
}

/** Creates a social.openreel.video.post for an uploaded blob; returns its URI. */
export async function createVideoPost(pdsUrl, { did, accessJwt }, { blob, caption, tags, probe }) {
  const { uri } = await xrpcPost(
    pdsUrl,
    'com.atproto.repo.createRecord',
    {
      repo: did,
      collection: 'social.openreel.video.post',
      record: {
        $type: 'social.openreel.video.post',
        video: blob,
        caption,
        ...(tags?.length ? { tags } : {}),
        ...probe,
        createdAt: new Date().toISOString(),
      },
    },
    accessJwt,
  )
  return uri
}

export function getFeed(appviewUrl, limit) {
  return jsonRequest(`${appviewUrl}/xrpc/social.openreel.feed.getFeed?limit=${limit}`)
}
