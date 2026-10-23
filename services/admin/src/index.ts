import { createDb, listenToTrace } from '@openreel/db'
import { serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME, type DebugDeps } from './app.ts'
import { handleLookup, TraceFeed } from './debug.ts'
import { resolveTargets } from './targets.ts'

const RETRY_MS = 5_000

/**
 * The debug portal needs the database; the status page does not, so admin
 * still starts without DATABASE_URL.
 */
function debugDeps(databaseUrl: string | undefined): DebugDeps | undefined {
  if (databaseUrl === undefined || databaseUrl.trim() === '') return undefined
  const db = createDb(databaseUrl)
  const traces = new TraceFeed(handleLookup(db))

  let retryPending = false
  const retry = (): void => {
    if (retryPending) return
    retryPending = true
    setTimeout(() => {
      retryPending = false
      listen()
    }, RETRY_MS)
  }

  const listen = (): void => {
    listenToTrace(
      databaseUrl,
      (event) => traces.push(event),
      (error) => {
        console.error(`[admin] trace listener lost: ${error.message}; retrying`)
        retry()
      },
    )
      .then(() => {
        console.log('[admin] listening for trace events')
      })
      .catch((error: Error) => {
        console.error(`[admin] cannot listen for trace events: ${error.message}; retrying`)
        retry()
      })
  }
  listen()

  const password = process.env['DEBUG_PASSWORD']?.trim()
  return { db, traces, ...(password ? { password } : {}) }
}

serve(
  createApp(resolveTargets(), debugDeps(process.env['DATABASE_URL'])),
  SERVICE_NAME,
  DEFAULT_PORT,
)
