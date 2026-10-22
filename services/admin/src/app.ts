import type { Database } from '@openreel/db'
import { createServiceApp } from '@openreel/service-core'
import { timingSafeEqual } from 'node:crypto'

import type { Express, NextFunction, Request, Response } from 'express'
import type { Kysely } from 'kysely'

import { collectStatus } from './checks.ts'
import { pipelineSnapshot, type QueryFeed } from './debug.ts'
import { renderDebugPage } from './debug-page.ts'
import { renderStatusPage } from './page.ts'
import { resolveTargets, type Target } from './targets.ts'

export const SERVICE_NAME = 'admin'
export const DEFAULT_PORT = 3003

const REFRESH_SECONDS = 10

/**
 * Internal status dashboard for local development and testing.
 *
 * The product's real client is the iOS app; this exists only so a human can see
 * at a glance whether the backend is up. It is not part of the public API and
 * must not be exposed publicly without authentication.
 */
/** Database access for the debug portal; without it `/debug` explains what is missing. */
export interface DebugDeps {
  db: Kysely<Database>
  queries: QueryFeed
  /**
   * When set, `/debug` requires HTTP Basic auth as `admin` with this password.
   * The shared host sets it, because nginx exposes `/debug` publicly there.
   */
  password?: string
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Basic auth for the debug portal, as `admin:<password>`. */
export function requireDebugPassword(password: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (password === undefined || password === '') {
      next()
      return
    }
    const header = req.get('authorization') ?? ''
    const decoded = header.startsWith('Basic ')
      ? Buffer.from(header.slice(6), 'base64').toString('utf8')
      : ''
    const separator = decoded.indexOf(':')
    if (
      separator > 0 &&
      decoded.slice(0, separator) === 'admin' &&
      sameSecret(decoded.slice(separator + 1), password)
    ) {
      next()
      return
    }
    res.set('WWW-Authenticate', 'Basic realm="OpenReel debug", charset="UTF-8"')
    res.status(401).send('Authentication required')
  }
}

export function createApp(
  targets: readonly Target[] = resolveTargets(),
  debug?: DebugDeps,
): Express {
  const app = createServiceApp(SERVICE_NAME)

  app.use('/debug', requireDebugPassword(debug?.password))

  app.get('/debug', (_req: Request, res: Response) => {
    res
      .status(200)
      .type('html')
      .send(renderDebugPage(debug !== undefined))
  })

  app.get('/debug/api/snapshot', async (_req: Request, res: Response) => {
    if (debug === undefined) {
      res.status(503).json({ error: 'NotConfigured', message: 'admin has no DATABASE_URL' })
      return
    }
    try {
      res.status(200).json(await pipelineSnapshot(debug.db))
    } catch (error) {
      console.error('[admin] snapshot failed:', error)
      res.status(500).json({ error: 'InternalServerError', message: (error as Error).message })
    }
  })

  app.get('/debug/api/queries', (_req: Request, res: Response) => {
    if (debug === undefined) {
      res.status(503).end()
      return
    }
    debug.queries.stream(res)
  })

  app.get('/', async (_req: Request, res: Response) => {
    const report = await collectStatus(targets)

    // A degraded backend is not an admin-service error, so this stays 200 and
    // lets the page itself convey the state. /api/status carries the signal for
    // scripts via allUp.
    res.status(200).type('html').send(renderStatusPage(report, REFRESH_SECONDS))
  })

  app.get('/api/status', async (_req: Request, res: Response) => {
    const report = await collectStatus(targets)
    res.status(report.allUp ? 200 : 503).json(report)
  })

  return app
}
