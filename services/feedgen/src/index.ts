import { serve } from '@openreel/service-core'

import { createApp, DEFAULT_PORT, SERVICE_NAME } from './app.ts'

serve(createApp(), SERVICE_NAME, DEFAULT_PORT)
