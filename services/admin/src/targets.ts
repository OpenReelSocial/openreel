/** A dependency the status page reports on. */
export interface Target {
  readonly name: string
  /** How to probe it. HTTP targets must return 2xx; TCP targets must accept a connection. */
  readonly probe: { kind: 'http'; url: string } | { kind: 'tcp'; host: string; port: number }
  /** Shown when a target is down, to say what breaks. */
  readonly role: string
}

/**
 * Reads the monitored targets from the environment.
 *
 * Defaults use Compose service names, which is what resolves inside the network.
 * Running the admin service on the host instead needs the *_URL overrides.
 */
export function resolveTargets(env: NodeJS.ProcessEnv = process.env): Target[] {
  return [
    {
      name: 'appview',
      role: 'Indexing, aggregation, and hydration',
      probe: { kind: 'http', url: env['APPVIEW_HEALTH_URL'] ?? 'http://appview:3001/health' },
    },
    {
      name: 'feedgen',
      role: 'Feed ranking and selection',
      probe: { kind: 'http', url: env['FEEDGEN_HEALTH_URL'] ?? 'http://feedgen:3002/health' },
    },
    {
      name: 'pds',
      role: 'Repositories, identity, and blobs',
      probe: { kind: 'http', url: env['PDS_HEALTH_URL'] ?? 'http://pds:3000/xrpc/_health' },
    },
    {
      name: 'postgres',
      role: 'AppView and feed generator index',
      probe: {
        kind: 'tcp',
        host: env['POSTGRES_HOST'] ?? 'postgres',
        port: Number(env['POSTGRES_INTERNAL_PORT'] ?? 5432),
      },
    },
    {
      name: 'redis',
      role: 'Cache and job queues',
      probe: {
        kind: 'tcp',
        host: env['REDIS_HOST'] ?? 'redis',
        port: Number(env['REDIS_INTERNAL_PORT'] ?? 6379),
      },
    },
  ]
}
