import type { Database } from '@openreel/db'
import { ids, lexicons } from '@openreel/lexicons'
import { createServiceApp } from '@openreel/service-core'
import type { Express, Request, Response } from 'express'
import type { Kysely } from 'kysely'

import { FEEDS, InvalidCursorError, type Feed } from './feeds.ts'

export const SERVICE_NAME = 'feedgen'
export const DEFAULT_PORT = 3002

const GENERATOR_COLLECTION = 'social.openreel.feed.generator'

export interface FeedgenDeps {
  db: Kysely<Database>
  feeds?: Record<string, Feed>
}

function xrpcError(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message })
}

/**
 * Feeds are matched on the generator record's collection and rkey. The
 * publishing account is not checked yet: no generator record has been
 * published, so there is no DID to pin to.
 */
function feedFor(feeds: Record<string, Feed>, feedUri: string): Feed | undefined {
  const [, , , collection, rkey] = feedUri.split('/')
  if (collection !== GENERATOR_COLLECTION || rkey === undefined) return undefined
  return Object.hasOwn(feeds, rkey) ? feeds[rkey] : undefined
}

/** Builds the feed generator: ranked post URIs only; the AppView hydrates them. */
export function createApp(deps: FeedgenDeps): Express {
  const app = createServiceApp(SERVICE_NAME)
  const feeds = deps.feeds ?? FEEDS

  app.get(`/xrpc/${ids.SocialOpenreelFeedGetFeedSkeleton}`, async (req: Request, res: Response) => {
    const raw: Record<string, unknown> = {}
    for (const name of ['feed', 'cursor', 'limit']) {
      const value = req.query[name]
      if (typeof value === 'string') {
        raw[name] = name === 'limit' && /^\d+$/.test(value) ? Number(value) : value
      }
    }

    let params: { feed: string; limit?: number; cursor?: string }
    try {
      params = lexicons.assertValidXrpcParams(ids.SocialOpenreelFeedGetFeedSkeleton, raw) as {
        feed: string
        limit?: number
        cursor?: string
      }
    } catch (error) {
      xrpcError(res, 400, 'InvalidRequest', (error as Error).message)
      return
    }

    const feed = feedFor(feeds, params.feed)
    if (feed === undefined) {
      xrpcError(res, 400, 'UnknownFeed', `unknown feed: ${params.feed}`)
      return
    }

    try {
      res.status(200).json(await feed.page(deps.db, params.limit ?? 30, params.cursor))
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        xrpcError(res, 400, 'InvalidRequest', error.message)
        return
      }
      console.error('[feedgen] getFeedSkeleton failed:', error)
      xrpcError(res, 500, 'InternalServerError', 'failed to build feed')
    }
  })

  return app
}
