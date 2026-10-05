import { createDb } from '@openreel/db'
import { serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'

const databaseUrl = process.env['DATABASE_URL']
if (databaseUrl === undefined || databaseUrl.trim() === '')
  throw new Error('DATABASE_URL is not set')

serve(createApp({ db: createDb(databaseUrl) }), SERVICE_NAME, DEFAULT_PORT)
