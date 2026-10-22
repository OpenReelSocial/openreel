import { createDb, queryTapOptions } from '@openreel/db'
import { serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'
import { DEFAULT_FEEDS_FILE, loadFeeds } from './config.ts'

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined || databaseUrl.trim() === '')
  throw new Error('DATABASE_URL is not set')

const feeds = loadFeeds(process.env['FEEDGEN_FEEDS_FILE']?.trim() || DEFAULT_FEEDS_FILE)
console.log(`[feedgen] serving feeds: ${feeds.map((f) => f.id).join(', ')}`)

serve(
  createApp({
    db: createDb(databaseUrl, queryTapOptions(SERVICE_NAME)),
    feeds,
    publisher: process.env['FEEDGEN_PUBLISHER']?.trim() || 'openreel.social',
  }),
  SERVICE_NAME,
  DEFAULT_PORT,
)
