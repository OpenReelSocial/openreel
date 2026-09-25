import { createServiceApp } from '@openreel/service-core'
import type { Express, Request, Response } from 'express'

import type { EventStore } from './events.ts'

export const SERVICE_NAME = 'event-consumer'
export const DEFAULT_PORT = 3004

export function createApp(store: EventStore): Express {
  const app = createServiceApp(SERVICE_NAME)

  app.get('/events/status', (_req: Request, res: Response) => {
    res.status(200).json(store.status())
  })

  app.get('/ready', (_req: Request, res: Response) => {
    const status = store.status()
    res.status(status.connection === 'connected' ? 200 : 503).json(status)
  })

  app.get('/events', (req: Request, res: Response) => {
    const did = typeof req.query['did'] === 'string' ? req.query['did'] : undefined
    const collection =
      typeof req.query['collection'] === 'string' ? req.query['collection'] : undefined
    const rkey = typeof req.query['rkey'] === 'string' ? req.query['rkey'] : undefined
    const events = store.find({
      ...(did === undefined ? {} : { did }),
      ...(collection === undefined ? {} : { collection }),
      ...(rkey === undefined ? {} : { rkey }),
    })
    res.status(200).json({ events })
  })

  return app
}
