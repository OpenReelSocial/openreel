import { createServiceApp } from '@openreel/service-core'
import type { Express, Request, Response } from 'express'

import { collectStatus } from './checks.ts'
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
export function createApp(targets: readonly Target[] = resolveTargets()): Express {
  const app = createServiceApp(SERVICE_NAME)

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
