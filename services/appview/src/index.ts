import { createDb } from '@openreel/db'
import { PlcResolver, serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'
import { readConfig } from './config.ts'
import { Indexer, VIDEO_POST_COLLECTION } from './indexer/indexer.ts'
import { JetstreamSubscription } from './indexer/subscription.ts'
import { HttpSkeletonSource } from './skeleton.ts'

const config = readConfig()
const db = createDb(config.databaseUrl)

const subscription = new JetstreamSubscription(
  config.jetstreamUrl,
  [VIDEO_POST_COLLECTION],
  db,
  new Indexer(db, new PlcResolver(config.plcUrl)),
)

serve(
  createApp({
    db,
    skeleton: new HttpSkeletonSource(config.feedgenUrl),
    defaultFeedUri: config.defaultFeedUri,
    mediaPublicUrl: config.mediaPublicUrl,
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
