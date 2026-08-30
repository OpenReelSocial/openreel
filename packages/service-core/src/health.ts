import type { Express, Request, Response } from 'express'

/** Reported by `GET /health` on every OpenReel backend service. */
export interface HealthReport {
  status: 'ok'
  service: string
  version: string
  uptimeSeconds: number
}

/**
 * Mounts the health endpoint every OpenReel service is expected to expose.
 *
 * The contract is deliberately minimal: a 200 means the process is up and
 * serving. It does not assert that downstream dependencies are reachable, so it
 * stays usable as a container healthcheck and load-balancer probe.
 */
export function mountHealth(app: Express, serviceName: string): void {
  const startedAt = Date.now()

  app.get('/health', (_req: Request, res: Response) => {
    const report: HealthReport = {
      status: 'ok',
      service: serviceName,
      version: process.env['SERVICE_VERSION'] ?? '0.0.0',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    }
    res.status(200).json(report)
  })
}
