import { createDb, listenToQueryTap } from '@openreel/db'
import { serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME, type DebugDeps } from './app.ts'
import { QueryFeed } from './debug.ts'
import { resolveTargets } from './targets.ts'

const RETRY_MS = 5_000

/**
 * The debug portal needs the database; the status page does not, so admin
 * still starts without DATABASE_URL.
 */
function debugDeps(databaseUrl: string | undefined): DebugDeps | undefined {
  if (databaseUrl === undefined || databaseUrl.trim() === '') return undefined
  const queries = new QueryFeed()

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
    listenToQueryTap(
      databaseUrl,
      (query) => queries.push(query),
      (error) => {
        console.error(`[admin] query tap lost: ${error.message}; retrying`)
        retry()
      },
    )
      .then(() => {
        console.log('[admin] listening to the query tap')
      })
      .catch((error: Error) => {
        console.error(`[admin] cannot listen to the query tap: ${error.message}; retrying`)
        retry()
      })
  }
  listen()

  return { db: createDb(databaseUrl), queries }
}

serve(
  createApp(resolveTargets(), debugDeps(process.env['DATABASE_URL'])),
  SERVICE_NAME,
  DEFAULT_PORT,
)
