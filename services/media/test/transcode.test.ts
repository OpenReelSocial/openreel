import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { probe, TranscodeError, transcode } from '../src/transcode.ts'
import { hasFfmpeg, makeClip, rotateClip } from './helpers.ts'

/** Real ffmpeg runs. Skipped where ffmpeg is not installed; the media image always has it. */
describe.skipIf(!hasFfmpeg)('transcode with ffmpeg', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'media-transcode-'))
  })

  it('writes a playable HLS ladder and poster for a portrait clip', async () => {
    const input = join(dir, 'portrait.mp4')
    makeClip(input, { width: 1080, height: 1920, seconds: 5 })
    const out = join(dir, 'portrait')

    const result = await transcode(input, out)

    expect(result).toMatchObject({ width: 720, height: 1280 })
    expect(result.durationMs).toBeGreaterThan(4_900)
    expect((await readdir(out)).sort()).toEqual([
      'avc_360',
      'avc_720',
      'hevc_720',
      'playlist.m3u8',
      'poster.jpg',
    ])

    const master = await readFile(join(out, 'playlist.m3u8'), 'utf8')
    expect(master).toMatch(
      /RESOLUTION=720x1280,CODECS="hvc1\.[^"]*,mp4a\.40\.2"\nhevc_720\/index\.m3u8/,
    )
    expect(master).toMatch(
      /RESOLUTION=720x1280,CODECS="avc1\.[^"]*,mp4a\.40\.2"\navc_720\/index\.m3u8/,
    )
    expect(master).toMatch(/RESOLUTION=360x640,CODECS="avc1\.[^"]*"?/)

    const media = await readFile(join(out, 'avc_720', 'index.m3u8'), 'utf8')
    expect(media).toContain('#EXT-X-PLAYLIST-TYPE:VOD')
    expect(media).toMatch(/#EXT-X-MAP:URI="init_\d+\.mp4"/)
    expect(media).toMatch(/#EXT-X-TARGETDURATION:4/)
    expect((await stat(join(out, 'poster.jpg'))).size).toBeGreaterThan(1_000)
  })

  it('honors phone rotation metadata', async () => {
    const landscape = join(dir, 'landscape.mp4')
    makeClip(landscape, { width: 1280, height: 720, seconds: 2, audio: false })
    const rotated = join(dir, 'rotated.mp4')
    rotateClip(landscape, rotated, 90)

    expect(await probe(rotated)).toMatchObject({ width: 720, height: 1280, hasAudio: false })
    const result = await transcode(rotated, join(dir, 'rotated'))
    expect(result).toMatchObject({ width: 720, height: 1280 })
    const master = await readFile(join(dir, 'rotated', 'playlist.m3u8'), 'utf8')
    expect(master).toContain('RESOLUTION=720x1280')
    expect(master).not.toContain('mp4a')
  })

  it('refuses an HLS playlist disguised as a video', async () => {
    const evil = join(dir, 'evil.mp4')
    await writeFile(
      evil,
      `#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nfile://${evil}\n#EXT-X-ENDLIST\n`,
    )

    await expect(transcode(evil, join(dir, 'evil'))).rejects.toThrow(TranscodeError)
  })
})
