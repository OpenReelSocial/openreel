import { traceRequests, type Database } from '@openreel/db'
import { ids, lexicons } from '@openreel/lexicons'
import { createServiceApp } from '@openreel/service-core'
import type { Express, Request, Response } from 'express'
import type { Kysely } from 'kysely'

import { hydratePosts } from './hydrate.ts'
import { SkeletonError, type SkeletonSource } from './skeleton.ts'

export const SERVICE_NAME = 'appview'
export const DEFAULT_PORT = 3001

export interface AppViewDeps {
  db: Kysely<Database>
  skeleton: SkeletonSource
  defaultFeedUri: string
  mediaPublicUrl: string
}

function xrpcError(res: Response, status: number, error: string, message: string): void {
  res.status(status).json({ error, message })
}

/** Query-string values arrive as strings; coerce the integer ones before validating. */
function readParams(req: Request): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const name of ['feed', 'cursor', 'limit']) {
    const value = req.query[name]
    if (typeof value !== 'string') continue
    params[name] = name === 'limit' && /^\d+$/.test(value) ? Number(value) : value
  }
  return params
}

/** Builds the AppView application: firehose-indexed reads over XRPC. */
export function createApp(deps: AppViewDeps): Express {
  const app = createServiceApp(SERVICE_NAME)
  app.use(traceRequests())

  app.get(`/xrpc/${ids.SocialOpenreelFeedGetFeed}`, async (req: Request, res: Response) => {
    let params: { feed?: string; limit?: number; cursor?: string }
    try {
      params = lexicons.assertValidXrpcParams(ids.SocialOpenreelFeedGetFeed, readParams(req)) as {
        feed?: string
        limit?: number
        cursor?: string
      }
    } catch (error) {
      xrpcError(res, 400, 'InvalidRequest', (error as Error).message)
      return
    }

    try {
      const skeleton = await deps.skeleton.getFeedSkeleton({
        feed: params.feed ?? deps.defaultFeedUri,
        limit: params.limit ?? 30,
        ...(params.cursor === undefined ? {} : { cursor: params.cursor }),
      })
      const feed = await hydratePosts(
        deps.db,
        skeleton.feed.map((item) => item.post),
        deps.mediaPublicUrl,
      )
      res.status(200).json({
        feed,
        ...(skeleton.cursor === undefined ? {} : { cursor: skeleton.cursor }),
      })
    } catch (error) {
      if (error instanceof SkeletonError) {
        xrpcError(res, error.status, error.error, error.message)
        return
      }
      console.error('[appview] getFeed failed:', error)
      xrpcError(res, 500, 'InternalServerError', 'failed to load feed')
    }
  })

  app.get(
    `/xrpc/${ids.SocialOpenreelFeedGetSuggestedFeeds}`,
    async (_req: Request, res: Response) => {
      try {
        const feeds = await deps.skeleton.describeFeeds()
        // The default feed leads, so a client that shows the first tab selected
        // starts where getFeed without a `feed` parameter would.
        const index = feeds.findIndex((feed) => feed.uri === deps.defaultFeedUri)
        if (index > 0) feeds.unshift(...feeds.splice(index, 1))
        res.status(200).json({ feeds })
      } catch (error) {
        if (error instanceof SkeletonError) {
          xrpcError(res, error.status, error.error, error.message)
          return
        }
        console.error('[appview] getSuggestedFeeds failed:', error)
        xrpcError(res, 500, 'InternalServerError', 'failed to list feeds')
      }
    },
  )

  return app
}
