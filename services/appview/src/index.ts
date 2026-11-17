import { createDb, queryTapOptions } from '@openreel/db'
import { PlcResolver, serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'
import { readConfig } from './config.ts'
import {
  COMMENT_COLLECTION,
  Indexer,
  LIKE_COLLECTION,
  VIDEO_POST_COLLECTION,
  WATCH_EVENT_COLLECTION,
} from './indexer/indexer.ts'
import { JetstreamSubscription } from './indexer/subscription.ts'
import { feedAuthority, RoutingSkeletonSource } from './feed-routing.ts'
import { createPublicJsonFetch } from './public-http.ts'
import { HttpSkeletonSource } from './skeleton.ts'

const config = readConfig()
const db = createDb(config.databaseUrl, queryTapOptions(SERVICE_NAME))

const indexer = new Indexer(db, new PlcResolver(config.plcUrl))
const subscription = new JetstreamSubscription(
  config.jetstreamUrl,
  [VIDEO_POST_COLLECTION, WATCH_EVENT_COLLECTION, LIKE_COLLECTION, COMMENT_COLLECTION],
  db,
  indexer,
)

serve(
  createApp({
    db,
    skeleton: new RoutingSkeletonSource(new HttpSkeletonSource(config.feedgenUrl), {
      localAuthorities: [feedAuthority(config.defaultFeedUri) ?? 'openreel.social'],
      external: config.externalFeeds ? createPublicJsonFetch() : undefined,
    }),
    defaultFeedUri: config.defaultFeedUri,
    mediaPublicUrl: config.mediaPublicUrl,
    takedowns: indexer,
    ...(config.adminPassword === undefined ? {} : { adminPassword: config.adminPassword }),
  }),
  SERVICE_NAME,
  DEFAULT_PORT,
)
await subscription.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void subscription
      .stop()
      .then(() => db.destroy())
      .finally(() => process.exit(0))
  })
}
