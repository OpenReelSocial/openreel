/** AppView settings, read once at startup. */
export interface AppViewConfig {
  databaseUrl: string
  /** Jetstream subscribe URL; the indexer adds `wantedCollections` and `cursor`. */
  jetstreamUrl: string
  plcUrl: string
  /** Base URL of the feed generator serving getFeedSkeleton. */
  feedgenUrl: string
  /** Feed used when getFeed is called without `feed`. */
  defaultFeedUri: string
  /** Public base URL the media pipeline's output is served from. */
  mediaPublicUrl: string
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') throw new Error(`${name} is not set`)
  return value.trim()
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppViewConfig {
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    jetstreamUrl: env['JETSTREAM_URL'] ?? 'ws://localhost:6008/subscribe',
    plcUrl: env['PLC_URL'] ?? 'http://localhost:2582',
    feedgenUrl: (env['FEEDGEN_URL'] ?? 'http://localhost:3002').replace(/\/+$/, ''),
    defaultFeedUri:
      env['DEFAULT_FEED_URI'] ?? 'at://openreel.social/social.openreel.feed.generator/recent',
    mediaPublicUrl: (env['MEDIA_PUBLIC_URL'] ?? 'http://localhost:3006').replace(/\/+$/, ''),
  }
}
