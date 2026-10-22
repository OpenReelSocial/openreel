import { describe, expect, it } from 'vitest'

import { readConfig, readStoreConfig } from '../src/config.ts'

describe('readStoreConfig', () => {
  it('defaults to the filesystem store under /media', () => {
    expect(readStoreConfig({})).toEqual({ kind: 'fs', root: '/media' })
  })

  it('uses MEDIA_ROOT for the filesystem store', () => {
    expect(readStoreConfig({ MEDIA_STORE: 'fs', MEDIA_ROOT: '/srv/media' })).toEqual({
      kind: 'fs',
      root: '/srv/media',
    })
  })

  it('selects S3 with a bucket', () => {
    expect(readStoreConfig({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: 'openreel-media' })).toEqual({
      kind: 's3',
      bucket: 'openreel-media',
    })
  })

  it.each([undefined, '', '  '])('requires MEDIA_S3_BUCKET for S3 (%j)', (bucket) => {
    expect(() => readStoreConfig({ MEDIA_STORE: 's3', MEDIA_S3_BUCKET: bucket })).toThrow(
      /MEDIA_S3_BUCKET is not set/,
    )
  })

  it('rejects an unknown store', () => {
    expect(() => readStoreConfig({ MEDIA_STORE: 'gcs' })).toThrow(/Invalid MEDIA_STORE/)
  })

  it('is part of readConfig', () => {
    const config = readConfig({
      DATABASE_URL: 'postgres://localhost/openreel',
      MEDIA_STORE: 's3',
      MEDIA_S3_BUCKET: 'openreel-media',
    })
    expect(config.store).toEqual({ kind: 's3', bucket: 'openreel-media' })
  })
})
