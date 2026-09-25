import { serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'
import { JetstreamConsumer } from './consumer.ts'
import { EventStore } from './events.ts'

function readBufferSize(value: string | undefined): number {
  if (value === undefined || value === '') return 100
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid EVENT_BUFFER_SIZE: expected a positive integer, received "${value}"`)
  }
  return parsed
}

const store = new EventStore(readBufferSize(process.env['EVENT_BUFFER_SIZE']))
const consumer = new JetstreamConsumer(
  process.env['JETSTREAM_URL'] ?? 'ws://localhost:6008/subscribe',
  store,
)

consumer.start()
serve(createApp(store), SERVICE_NAME, DEFAULT_PORT)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    consumer.stop()
    process.exit(0)
  })
}
