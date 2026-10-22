import { S3Client } from '@aws-sdk/client-s3'
import { createDb } from '@openreel/db'
import { PlcResolver, serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'
import { BlobFetcher } from './blob.ts'
import { readConfig } from './config.ts'
import { S3MediaStore } from './s3-store.ts'
import { FileMediaStore } from './store.ts'
import { transcode } from './transcode.ts'
import { Worker } from './worker.ts'

const config = readConfig()
const db = createDb(config.databaseUrl)
const store =
  config.store.kind === 's3'
    ? new S3MediaStore(new S3Client({}), config.store.bucket)
    : new FileMediaStore(config.store.root)

const worker = new Worker({
  db,
  identity: new PlcResolver(config.plcUrl),
  blobs: new BlobFetcher({ aliases: config.pdsAliases, maxBytes: config.maxBlobBytes }),
  store,
  transcode,
  maxAttempts: config.maxAttempts,
  pollIntervalMs: config.pollIntervalMs,
})

serve(createApp(db), SERVICE_NAME, DEFAULT_PORT)
worker.start()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // An interrupted job stays 'processing' and is retried once its claim goes stale.
    void worker
      .stop()
      .then(() => db.destroy())
      .finally(() => process.exit(0))
  })
}
