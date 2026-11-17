import { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'

/** Evicts a key's renditions from the CDN in front of the store, if there is one. */
export interface CdnInvalidator {
  invalidate(did: string, cid: string): Promise<void>
}

/** The one CloudFront call the invalidator makes; `CloudFrontClient` satisfies it. */
export interface CloudFrontSender {
  send(command: CreateInvalidationCommand): Promise<unknown>
}

/**
 * Invalidates `/<did>/<cid>/*` on the media distribution (ADR-0007).
 * Renditions are cached for a year as immutable, so a removed video would
 * otherwise keep playing from the edge. The AppView percent-encodes the DID
 * in media URLs, so both spellings of the path are invalidated.
 */
export class CloudFrontInvalidator implements CdnInvalidator {
  readonly #client: CloudFrontSender
  readonly #distributionId: string

  constructor(client: CloudFrontSender, distributionId: string) {
    this.#client = client
    this.#distributionId = distributionId
  }

  async invalidate(did: string, cid: string): Promise<void> {
    const paths = [...new Set([`/${did}/${cid}/*`, `/${encodeURIComponent(did)}/${cid}/*`])]
    await this.#client.send(
      new CreateInvalidationCommand({
        DistributionId: this.#distributionId,
        InvalidationBatch: {
          CallerReference: `${did}/${cid}/${Date.now()}`,
          Paths: { Quantity: paths.length, Items: paths },
        },
      }),
    )
  }
}
