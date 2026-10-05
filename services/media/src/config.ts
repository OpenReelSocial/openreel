/** Media service settings, read once at startup. */
export interface MediaConfig {
  databaseUrl: string
  plcUrl: string
  /** Directory renditions are written under; served read-only by the media CDN. */
  mediaRoot: string
  /**
   * PDS origins to reach at a different address, e.g. `http://localhost:3000`
   * (what a local DID document says) at `http://pds:3000` (what a container
   * can reach). Aliased origins are operator-chosen, so they skip SSRF checks.
   */
  pdsAliases: Map<string, string>
  pollIntervalMs: number
  maxAttempts: number
  /** Matches the Lexicon's maxSize for `social.openreel.video.post#video`. */
  maxBlobBytes: number
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${name}: expected a positive integer, received "${raw}"`)
  }
  return value
}

/** Parses `PDS_ALIASES`: comma-separated `public=internal` origin pairs. */
export function parseAliases(raw: string | undefined): Map<string, string> {
  const aliases = new Map<string, string>()
  for (const pair of (raw ?? '').split(',')) {
    if (pair.trim() === '') continue
    const [from, to, ...rest] = pair.split('=')
    if (from === undefined || to === undefined || rest.length > 0) {
      throw new Error(`Invalid PDS_ALIASES entry "${pair}": expected public=internal`)
    }
    aliases.set(new URL(from.trim()).origin, new URL(to.trim()).origin)
  }
  return aliases
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): MediaConfig {
  const databaseUrl = env['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl.trim() === '')
    throw new Error('DATABASE_URL is not set')
  return {
    databaseUrl,
    plcUrl: env['PLC_URL'] ?? 'http://localhost:2582',
    mediaRoot: env['MEDIA_ROOT'] ?? '/media',
    pdsAliases: parseAliases(env['PDS_ALIASES']),
    pollIntervalMs: positiveInt(env, 'MEDIA_POLL_INTERVAL_MS', 2_000),
    maxAttempts: positiveInt(env, 'MEDIA_MAX_ATTEMPTS', 3),
    maxBlobBytes: positiveInt(env, 'MEDIA_MAX_BLOB_BYTES', 100_000_000),
  }
}
