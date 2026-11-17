import type { CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { describe, expect, it } from 'vitest'

import { CloudFrontInvalidator } from '../src/cdn.ts'

describe('CloudFrontInvalidator', () => {
  it("invalidates the key's paths, with the DID raw and percent-encoded", async () => {
    const sent: CreateInvalidationCommand[] = []
    const cdn = new CloudFrontInvalidator(
      {
        send: (command) => {
          sent.push(command)
          return Promise.resolve({})
        },
      },
      'E123EXAMPLE',
    )

    await cdn.invalidate('did:plc:abc123', 'bafkreione')

    expect(sent).toHaveLength(1)
    expect(sent[0]?.input.DistributionId).toBe('E123EXAMPLE')
    expect(sent[0]?.input.InvalidationBatch?.Paths).toEqual({
      Quantity: 2,
      Items: ['/did:plc:abc123/bafkreione/*', '/did%3Aplc%3Aabc123/bafkreione/*'],
    })
  })
})
