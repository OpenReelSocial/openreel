// Fetches what a player would for one getFeed post: the multivariant
// playlist, a variant playlist, its init and first media segment, and the
// thumbnail. URLs come from the post, so any media host (the stack's own
// /media, or a CDN) is followed as-is.

import { Buffer } from 'node:buffer'

/** Fetches a URL, fails unless 200, and summarizes the caching headers. */
async function fetchOk(url, expectType) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  const body = Buffer.from(await response.arrayBuffer())
  if (response.status !== 200) throw new Error(`HTTP ${response.status} for ${url}`)
  const type = response.headers.get('content-type') ?? ''
  if (expectType && !type.toLowerCase().includes(expectType)) {
    throw new Error(`content-type "${type}" does not contain "${expectType}" for ${url}`)
  }
  const cache = [
    `${body.length} B`,
    type && `type: ${type}`,
    `cache-control: ${response.headers.get('cache-control') ?? '(none)'}`,
    response.headers.get('x-cache') && `x-cache: ${response.headers.get('x-cache')}`,
  ].filter(Boolean)
  return { body, summary: cache.join(', ') }
}

/** URIs in an HLS playlist: non-tag lines, plus EXT-X-MAP init segments. */
function playlistUris(text, base) {
  const uris = { variants: [], segments: [], init: undefined }
  let nextIsVariant = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('#EXT-X-STREAM-INF')) nextIsVariant = true
    const map = line.match(/^#EXT-X-MAP:.*URI="([^"]+)"/)
    if (map) uris.init ??= new URL(map[1], base).href
    if (!line || line.startsWith('#')) continue
    ;(nextIsVariant ? uris.variants : uris.segments).push(new URL(line, base).href)
    nextIsVariant = false
  }
  return uris
}

/** Runs the playback checks for a post through a report from report.mjs. */
export async function checkPlayback(report, post, label = 'post') {
  let variant
  await report.check(`${label} playlist`, async () => {
    if (!post.playlist) throw new Error('post has no playlist URL')
    const { body, summary } = await fetchOk(post.playlist, 'mpegurl')
    const { variants } = playlistUris(body.toString(), post.playlist)
    if (variants.length === 0) throw new Error('multivariant playlist lists no variants')
    variant = variants[0]
    return `${variants.length} variant(s), ${summary}`
  })

  let segment
  let init
  if (variant) {
    await report.check(`${label} variant playlist`, async () => {
      const { body, summary } = await fetchOk(variant, 'mpegurl')
      const uris = playlistUris(body.toString(), variant)
      segment = uris.segments.find((uri) => /\.(m4s|mp4)(\?|$)/.test(uri))
      init = uris.init
      if (!segment) throw new Error('variant playlist has no .m4s/.mp4 segment')
      return `${uris.segments.length} segment(s), ${new URL(variant).pathname.split('/').slice(-2).join('/')}, ${summary}`
    })
  } else {
    report.skip(`${label} variant playlist`, 'no variant to fetch')
  }

  if (init) await report.check(`${label} init segment`, async () => (await fetchOk(init)).summary)
  if (segment) {
    await report.check(`${label} media segment`, async () => (await fetchOk(segment)).summary)
  } else {
    report.skip(`${label} media segment`, 'no segment to fetch')
  }

  await report.check(`${label} thumbnail`, async () => {
    if (!post.thumbnail) throw new Error('post has no thumbnail URL')
    return (await fetchOk(post.thumbnail, 'image/jpeg')).summary
  })
}
