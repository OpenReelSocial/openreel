import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * HLS packaging per the project plan (sections 4.3 and 5.7): H.265 first, with
 * H.264 fallbacks, in fMP4 segments. AVPlayer picks the HEVC variant on devices
 * that decode it and falls back to H.264 otherwise; the 360p variant covers
 * poor networks and fast-scroll startup.
 */
export interface Rendition {
  name: string
  codec: 'hevc' | 'h264'
  /** Target length of the shorter side; output keeps the source orientation. */
  shortSide: number
  maxrate: string
}

export const LADDER: readonly Rendition[] = [
  { name: 'hevc_720', codec: 'hevc', shortSide: 720, maxrate: '1800k' },
  { name: 'avc_720', codec: 'h264', shortSide: 720, maxrate: '2800k' },
  { name: 'avc_360', codec: 'h264', shortSide: 360, maxrate: '700k' },
]

/** 2-6 s is the plan's range; 4 s balances startup time against request count. */
export const SEGMENT_SECONDS = 4
/** Keyframe interval; aligned across renditions so players can switch at any segment. */
const KEYFRAME_SECONDS = 2

/** Only container formats phones and editors produce. Anything else (HLS, concat) is refused. */
const INPUT_FORMATS = 'mov,mp4,matroska,webm'
const INPUT_GUARD = ['-protocol_whitelist', 'file', '-format_whitelist', INPUT_FORMATS]

export interface Probe {
  width: number
  height: number
  durationMs: number
  hasAudio: boolean
}

export class TranscodeError extends Error {}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
    child.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4_000)))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new TranscodeError(`${cmd} exited ${signal ?? code}: ${stderr.trim()}`))
    })
  })
}

/** Reads dimensions (after rotation), duration, and whether there is audio. */
export async function probe(input: string): Promise<Probe> {
  const out = await run(
    'ffprobe',
    [
      '-v',
      'error',
      ...INPUT_GUARD,
      '-show_entries',
      'stream=codec_type,width,height:stream_side_data=rotation:format=duration',
      '-of',
      'json',
      input,
    ],
    60_000,
  )
  const data = JSON.parse(out) as {
    streams?: {
      codec_type?: string
      width?: number
      height?: number
      side_data_list?: { rotation?: number }[]
    }[]
    format?: { duration?: string }
  }
  const video = data.streams?.find((s) => s.codec_type === 'video')
  if (video?.width === undefined || video.height === undefined) {
    throw new TranscodeError('no video stream')
  }
  const durationMs = Math.round(Number(data.format?.duration ?? NaN) * 1000)
  if (!Number.isFinite(durationMs) || durationMs <= 0) throw new TranscodeError('unknown duration')

  const rotation = Math.abs(
    video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
  )
  const sideways = rotation % 180 === 90
  return {
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    durationMs,
    hasAudio: data.streams?.some((s) => s.codec_type === 'audio') ?? false,
  }
}

/**
 * The renditions worth producing for a source: never upscale, but always keep
 * at least the smallest H.264 rendition (shrunk to the source if it is tiny).
 */
export function planRenditions(source: Probe, ladder: readonly Rendition[] = LADDER): Rendition[] {
  const shortSide = Math.min(source.width, source.height)
  const fits = ladder.filter((r) => r.shortSide <= shortSide)
  if (fits.some((r) => r.codec === 'h264')) return fits
  const smallest = ladder.filter((r) => r.codec === 'h264').at(-1)
  if (smallest === undefined) throw new Error('ladder has no H.264 rendition')
  // Even dimensions: 4:2:0 chroma subsampling requires them.
  return [...fits, { ...smallest, shortSide: shortSide - (shortSide % 2) }]
}

function scale(shortSide: number): string {
  return `scale=w='if(gt(iw,ih),-2,${shortSide})':h='if(gt(iw,ih),${shortSide},-2)',format=yuv420p`
}

/** The single ffmpeg invocation that encodes every rendition and writes the HLS tree. */
export function hlsArgs(
  input: string,
  outDir: string,
  renditions: Rendition[],
  hasAudio: boolean,
): string[] {
  const n = renditions.length
  const split = `[0:v]split=${n}${renditions.map((_, i) => `[s${i}]`).join('')}`
  const scales = renditions.map((r, i) => `[s${i}]${scale(r.shortSide)}[v${i}]`)
  const args = ['-v', 'error', '-y', ...INPUT_GUARD, '-i', input]
  args.push('-filter_complex', [split, ...scales].join(';'))
  for (let i = 0; i < n; i++) args.push('-map', `[v${i}]`)
  if (hasAudio) for (let i = 0; i < n; i++) args.push('-map', '0:a:0')

  args.push('-force_key_frames', `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`)
  renditions.forEach((r, i) => {
    const bufsize = `${parseInt(r.maxrate, 10) * 2}k`
    if (r.codec === 'hevc') {
      args.push(
        `-c:v:${i}`,
        'libx265',
        `-preset:v:${i}`,
        'faster',
        `-crf:v:${i}`,
        '26',
        // hvc1 (parameter sets in the init segment) is what Apple players require.
        `-tag:v:${i}`,
        'hvc1',
        `-x265-params:v:${i}`,
        'scenecut=0:open-gop=0:log-level=error',
      )
    } else {
      args.push(
        `-c:v:${i}`,
        'libx264',
        `-preset:v:${i}`,
        'veryfast',
        `-crf:v:${i}`,
        '23',
        `-profile:v:${i}`,
        r.shortSide >= 720 ? 'high' : 'main',
        `-sc_threshold:v:${i}`,
        '0',
      )
    }
    args.push(`-maxrate:v:${i}`, r.maxrate, `-bufsize:v:${i}`, bufsize)
  })
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2')

  const streamMap = renditions
    .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
    .join(' ')
  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_segment_type',
    'fmp4',
    '-hls_flags',
    'independent_segments',
    '-hls_fmp4_init_filename',
    'init.mp4', // ffmpeg suffixes the variant index
    '-hls_segment_filename',
    join(outDir, '%v', 'seg_%03d.m4s'),
    '-master_pl_name',
    'playlist.m3u8',
    '-var_stream_map',
    streamMap,
    join(outDir, '%v', 'index.m3u8'),
  )
  return args
}

export interface TranscodeResult {
  /** Pixel dimensions of the largest rendition. */
  width: number
  height: number
  durationMs: number
}

/**
 * Writes `playlist.m3u8` (multivariant), one directory per rendition, and
 * `poster.jpg` into `outDir`.
 */
export async function transcode(input: string, outDir: string): Promise<TranscodeResult> {
  const source = await probe(input)
  const renditions = planRenditions(source)
  await mkdir(outDir, { recursive: true })

  // Generous: a 100 MB upload on a shared 4-core host can take minutes.
  await run('ffmpeg', hlsArgs(input, outDir, renditions, source.hasAudio), 20 * 60_000)

  const posterAt = Math.min(1, source.durationMs / 2000).toFixed(3)
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      ...INPUT_GUARD,
      '-ss',
      posterAt,
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      scale(renditions[0]?.shortSide ?? 720),
      '-q:v',
      '3',
      join(outDir, 'poster.jpg'),
    ],
    60_000,
  )

  const largest = renditions.reduce((a, b) => (b.shortSide > a.shortSide ? b : a))
  const shortSide = largest.shortSide
  const portrait = source.height >= source.width
  const longSide =
    Math.round(
      (shortSide * Math.max(source.width, source.height)) /
        Math.min(source.width, source.height) /
        2,
    ) * 2
  return {
    width: portrait ? shortSide : longSide,
    height: portrait ? longSide : shortSide,
    durationMs: source.durationMs,
  }
}
