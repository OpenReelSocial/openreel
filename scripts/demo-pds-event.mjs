#!/usr/bin/env node

const pdsUrl = process.env.PDS_URL ?? 'http://localhost:3000'
const consumerUrl = process.env.EVENT_CONSUMER_URL ?? 'http://localhost:3004'
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 8)
const handle = `sample-${suffix}.pds.example.com`
const password = `openreel-dev-${crypto.randomUUID()}`

async function jsonRequest(url, init = {}) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${url} failed (${response.status}): ${JSON.stringify(body)}`,
    )
  }
  return body
}

async function waitForConsumer() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const status = await jsonRequest(`${consumerUrl}/events/status`)
    if (status.connection === 'connected') return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('event consumer did not connect to Jetstream within 15 seconds')
}

async function waitForRecord(did) {
  const query = new URLSearchParams({
    did,
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
  })
  for (let attempt = 1; attempt <= 40; attempt += 1) {
    const result = await jsonRequest(`${consumerUrl}/events?${query.toString()}`)
    if (Array.isArray(result.events) && result.events.length > 0) return result.events.at(-1)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    'record was written to the PDS but not observed by the consumer within 20 seconds',
  )
}

await waitForConsumer()
console.log('1/3 Event consumer is connected to Jetstream')

const account = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.server.createAccount`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    handle,
    email: `sample-${suffix}@example.com`,
    password,
  }),
})
console.log(`2/3 Created ${account.handle} (${account.did}) on the local PDS`)

const record = {
  $type: 'app.bsky.actor.profile',
  displayName: 'OpenReel Sample User',
  description: 'Disposable record for the local PDS event-flow demonstration.',
}
const write = await jsonRequest(`${pdsUrl}/xrpc/com.atproto.repo.createRecord`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${account.accessJwt}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    repo: account.did,
    collection: 'app.bsky.actor.profile',
    rkey: 'self',
    record,
  }),
})

const observed = await waitForRecord(account.did)
console.log(`3/3 Observed ${write.uri} in the backend event consumer`)
console.log(JSON.stringify(observed, null, 2))
