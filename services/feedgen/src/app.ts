import { createServiceApp } from '@openreel/service-core'
import type { Express } from 'express'

export const SERVICE_NAME = 'feedgen'
export const DEFAULT_PORT = 3002

/**
 * Builds the Feed Generator application. Routes beyond `GET /health` are added here as
 * the service grows.
 */
export function createApp(): Express {
  const app = createServiceApp(SERVICE_NAME)

  return app
}
