import type { Database } from '@openreel/db'
import type { SocialOpenreelVideoDefs } from '@openreel/lexicons'
import type { Kysely } from 'kysely'

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** Public URLs of a blob's renditions; layout matches the media service's store. */
export function mediaUrls(
  mediaPublicUrl: string,
  did: string,
  videoCid: string,
): { playlist: string; thumbnail: string } {
  const base = `${mediaPublicUrl}/${encodeURIComponent(did)}/${videoCid}`
  return { playlist: `${base}/playlist.m3u8`, thumbnail: `${base}/poster.jpg` }
}

/**
 * Turns post URIs into playable post views, preserving the given order. Posts
 * that are not indexed, or whose media is not ready, are left out: a client
 * cannot do anything useful with a video post it cannot play.
 */
export async function hydratePosts(
  db: Kysely<Database>,
  uris: string[],
  mediaPublicUrl: string,
): Promise<SocialOpenreelVideoDefs.PostView[]> {
  if (uris.length === 0) return []

  const rows = await db
    .selectFrom('video_post as p')
    .innerJoin('actor as a', 'a.did', 'p.author_did')
    .innerJoin('video_media as m', (join) =>
      join.onRef('m.author_did', '=', 'p.author_did').onRef('m.video_cid', '=', 'p.video_cid'),
    )
    .select([
      'p.uri',
      'p.cid',
      'p.author_did',
      'a.handle',
      'p.record',
      'p.video_cid',
      'p.aspect_width',
      'p.aspect_height',
      'p.indexed_at',
      'm.width',
      'm.height',
      'm.duration_ms',
    ])
    .where('p.uri', 'in', uris)
    .where('m.status', '=', 'ready')
    .execute()

  const byUri = new Map(rows.map((row) => [row.uri, row]))
  const views: SocialOpenreelVideoDefs.PostView[] = []
  for (const uri of uris) {
    const row = byUri.get(uri)
    if (row === undefined || row.record === null || row.video_cid === null) continue

    const view: SocialOpenreelVideoDefs.PostView = {
      uri: row.uri,
      cid: row.cid,
      author: { did: row.author_did, ...(row.handle === null ? {} : { handle: row.handle }) },
      record: row.record,
      ...mediaUrls(mediaPublicUrl, row.author_did, row.video_cid),
      indexedAt: row.indexed_at.toISOString(),
    }
    // The author's declared ratio wins; otherwise derive it from the rendition.
    if (row.aspect_width !== null && row.aspect_height !== null) {
      view.aspectRatio = { width: row.aspect_width, height: row.aspect_height }
    } else if (row.width !== null && row.height !== null) {
      const d = gcd(row.width, row.height)
      view.aspectRatio = { width: row.width / d, height: row.height / d }
    }
    if (row.duration_ms !== null && row.duration_ms > 0) view.durationMs = row.duration_ms
    views.push(view)
  }
  return views
}
