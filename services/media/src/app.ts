import type { Database } from '@openreel/db'
import { createServiceApp } from '@openreel/service-core'
import type { Express, Request, Response } from 'express'
import type { Kysely } from 'kysely'

import { queueStats } from './jobs.ts'

export const SERVICE_NAME = 'media'
export const DEFAULT_PORT = 3005

/** Health plus queue depth; the media itself is served by the media CDN, not here. */
export function createApp(db: Kysely<Database>): Express {
  const app = createServiceApp(SERVICE_NAME)

  app.get('/status', async (_req: Request, res: Response) => {
    try {
      res.status(200).json({ jobs: await queueStats(db) })
    } catch (error) {
      res.status(503).json({ error: (error as Error).message })
    }
  })

  return app
}
