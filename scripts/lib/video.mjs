// ffmpeg/ffprobe helpers for generating and describing test clips.

import { execFileSync } from 'node:child_process'

/** Renders a vertical H.264/AAC clip from an ffmpeg lavfi source. */
export function generateClip(path, { source, frequency, seconds }) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    source,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=${frequency}`,
    '-t',
    String(seconds),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    path,
  ])
}

/** Duration and display aspect ratio, as the video.post record expects them. */
export function probe(path) {
  const out = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height:stream_side_data=rotation:format=duration',
    '-of',
    'json',
    path,
  ])
  const data = JSON.parse(out.toString())
  const stream = data.streams[0]
  const rotation = Math.abs(
    stream.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0,
  )
  const [width, height] =
    rotation % 180 === 90 ? [stream.height, stream.width] : [stream.width, stream.height]
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b))
  const d = gcd(width, height)
  return {
    durationMs: Math.round(Number(data.format.duration) * 1000),
    aspectRatio: { width: width / d, height: height / d },
  }
}

export const VIDEO_TYPES = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime' }
