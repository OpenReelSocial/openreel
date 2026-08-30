import { createConnection } from 'node:net'

import type { Target } from './targets.ts'

export type Status = 'up' | 'down'

export interface CheckResult {
  readonly name: string
  readonly role: string
  readonly status: Status
  readonly latencyMs: number
  /** Version string when the target reports one, otherwise a short reason. */
  readonly detail: string
}

export interface StatusReport {
  readonly checkedAt: string
  readonly allUp: boolean
  readonly results: readonly CheckResult[]
}

const TIMEOUT_MS = 3000

async function probeHttp(url: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` }

    // Health payloads are small and self-describing; surface the useful field.
    const body: unknown = await res.json().catch(() => null)
    if (body !== null && typeof body === 'object') {
      const record = body as Record<string, unknown>
      const version = record['version']
      if (typeof version === 'string') return { ok: true, detail: `v${version.replace(/^v/, '')}` }
    }
    return { ok: true, detail: `HTTP ${res.status}` }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, detail: message.includes('timed out') ? 'timed out' : 'unreachable' }
  }
}

function probeTcp(host: string, port: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    const finish = (ok: boolean, detail: string) => {
      socket.destroy()
      resolve({ ok, detail })
    }

    socket.setTimeout(TIMEOUT_MS)
    socket.once('connect', () => finish(true, `${host}:${port}`))
    socket.once('timeout', () => finish(false, 'timed out'))
    socket.once('error', () => finish(false, 'connection refused'))
  })
}

async function check(target: Target): Promise<CheckResult> {
  const startedAt = performance.now()
  const outcome =
    target.probe.kind === 'http'
      ? await probeHttp(target.probe.url)
      : await probeTcp(target.probe.host, target.probe.port)

  return {
    name: target.name,
    role: target.role,
    status: outcome.ok ? 'up' : 'down',
    latencyMs: Math.round(performance.now() - startedAt),
    detail: outcome.detail,
  }
}

/** Probes every target concurrently; one slow target does not delay the rest. */
export async function collectStatus(targets: readonly Target[]): Promise<StatusReport> {
  const results = await Promise.all(targets.map(check))

  return {
    checkedAt: new Date().toISOString(),
    allUp: results.every((r) => r.status === 'up'),
    results,
  }
}
