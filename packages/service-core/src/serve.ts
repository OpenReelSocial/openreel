import type { Express } from 'express'

import { readPort } from './config.ts'

/** Binds a service app to its configured port and logs where it is listening. */
export function serve(app: Express, serviceName: string, defaultPort: number): void {
  const port = readPort(process.env['PORT'], defaultPort)

  app.listen(port, () => {
    console.log(`[${serviceName}] listening on http://0.0.0.0:${port}`)
  })
}
