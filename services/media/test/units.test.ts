import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseAliases } from '../src/config.ts'
import { FileMediaStore, keyPath } from '../src/store.ts'
import { hlsArgs, LADDER, planRenditions } from '../src/transcode.ts'

const did = 'did:plc:ri7muaelw3trwgd2eda7tuf2'
const cid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'

describe('parseAliases', () => {
  it('maps public origins to internal ones', () => {
    const aliases = parseAliases(
      'http://localhost:3000=http://pds:3000, https://a.example/=http://b:1',
    )
    expect([...aliases]).toEqual([
      ['http://localhost:3000', 'http://pds:3000'],
      ['https://a.example', 'http://b:1'],
    ])
  })

  it('is empty when unset', () => {
    expect(parseAliases(undefined).size).toBe(0)
    expect(parseAliases('').size).toBe(0)
  })

  it('rejects malformed entries', () => {
    expect(() => parseAliases('http://a')).toThrow(/expected public=internal/)
    expect(() => parseAliases('a=b')).toThrow()
  })
})

describe('planRenditions', () => {
  const probe = (width: number, height: number) => ({
    width,
    height,
    durationMs: 1,
    hasAudio: true,
  })

  it('uses the full ladder for 1080p sources in either orientation', () => {
    expect(planRenditions(probe(1080, 1920))).toEqual(LADDER)
    expect(planRenditions(probe(1920, 1080))).toEqual(LADDER)
  })

  it('never upscales', () => {
    expect(planRenditions(probe(480, 854)).map((r) => r.name)).toEqual(['avc_360'])
  })

  it('shrinks the smallest H.264 rendition to a tiny source, keeping it even', () => {
    expect(planRenditions(probe(241, 427))).toEqual([
      { name: 'avc_360', codec: 'h264', shortSide: 240, maxrate: '700k' },
    ])
  })
})

describe('hlsArgs', () => {
  it('maps audio into every variant when there is audio', () => {
    const args = hlsArgs('in', 'out', [...LADDER], true)
    expect(args.filter((a) => a === '0:a:0')).toHaveLength(3)
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe(
      'v:0,a:0,name:hevc_720 v:1,a:1,name:avc_720 v:2,a:2,name:avc_360',
    )
  })

  it('omits audio for silent sources', () => {
    const args = hlsArgs('in', 'out', [...LADDER], false)
    expect(args).not.toContain('0:a:0')
    expect(args).not.toContain('-c:a')
    expect(args[args.indexOf('-var_stream_map') + 1]).toBe(
      'v:0,name:hevc_720 v:1,name:avc_720 v:2,name:avc_360',
    )
  })

  it('restricts the input to plain container formats on local files', () => {
    const args = hlsArgs('in', 'out', [...LADDER], true)
    expect(args.slice(args.indexOf('-protocol_whitelist'), args.indexOf('-i'))).toEqual([
      '-protocol_whitelist',
      'file',
      '-format_whitelist',
      'mov,mp4,matroska,webm',
    ])
  })
})

describe('FileMediaStore', () => {
  it('rejects keys that could escape the media root', () => {
    expect(() => keyPath('/m', '../etc', cid)).toThrow(/unsafe/)
    expect(() => keyPath('/m', did, '../../x')).toThrow(/unsafe/)
    expect(keyPath('/m', did, cid)).toBe(`/m/${did}/${cid}`)
  })

  it('publishes a work directory under its key, replacing an older copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'media-store-'))
    const store = new FileMediaStore(root)

    for (const version of ['v1', 'v2']) {
      const work = await store.workDir()
      await mkdir(join(work, 'out'))
      await writeFile(join(work, 'out', 'playlist.m3u8'), version)
      await store.publish(join(work, 'out'), did, cid)
      await store.discard(work)
    }

    expect(await readFile(join(root, did, cid, 'playlist.m3u8'), 'utf8')).toBe('v2')
  })
})
