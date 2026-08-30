import express, { type Express } from 'express'

import { mountHealth } from './health.ts'

/**
 * Builds a service's Express application with the conventions shared by every
 * OpenReel backend service, without binding a port so tests can drive it
 * in-process.
 *
 * Callers add their own routes to the returned app.
 */
export function createServiceApp(serviceName: string): Express {
  const app = express()

  // Do not advertise the framework and version to clients.
  app.disable('x-powered-by')
  app.use(express.json())

  mountHealth(app, serviceName)

  return app
}
