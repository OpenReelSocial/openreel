import type { SocialOpenreelFeedGetFeedSkeleton } from '@openreel/lexicons'

/** An XRPC error from the feed generator, relayed to the AppView's caller. */
export class SkeletonError extends Error {
  readonly status: number
  readonly error: string

  constructor(status: number, error: string, message: string) {
    super(message)
    this.status = status
    this.error = error
  }
}

export interface SkeletonSource {
  getFeedSkeleton(
    params: SocialOpenreelFeedGetFeedSkeleton.QueryParams,
  ): Promise<SocialOpenreelFeedGetFeedSkeleton.OutputSchema>
}

/** Calls a feed generator's `social.openreel.feed.getFeedSkeleton` over HTTP. */
export class HttpSkeletonSource implements SkeletonSource {
  readonly #baseUrl: string

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl
  }

  async getFeedSkeleton(
    params: SocialOpenreelFeedGetFeedSkeleton.QueryParams,
  ): Promise<SocialOpenreelFeedGetFeedSkeleton.OutputSchema> {
    const url = new URL(`${this.#baseUrl}/xrpc/social.openreel.feed.getFeedSkeleton`)
    url.searchParams.set('feed', params.feed)
    if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit))
    if (params.cursor !== undefined) url.searchParams.set('cursor', params.cursor)

    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) {
      // Client errors (UnknownFeed, bad cursor) pass through; anything else is
      // the generator failing, which is the AppView's upstream problem.
      if (res.status >= 400 && res.status < 500 && typeof body['error'] === 'string') {
        const message = typeof body['message'] === 'string' ? body['message'] : body['error']
        throw new SkeletonError(400, body['error'], message)
      }
      throw new SkeletonError(502, 'UpstreamFailure', `feed generator returned HTTP ${res.status}`)
    }
    return body as unknown as SocialOpenreelFeedGetFeedSkeleton.OutputSchema
  }
}
