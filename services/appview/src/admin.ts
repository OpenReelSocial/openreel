import { timingSafeEqual } from 'node:crypto'

import type { Express, Request, Response } from 'express'

export const UPDATE_SUBJECT_STATUS = 'com.atproto.admin.updateSubjectStatus'

/** What the admin route needs from the indexer. */
export interface Takedowns {
  takedown(subject: string, ref: string): Promise<void>
  liftTakedown(subject: string): Promise<void>
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** HTTP Basic auth as `admin:<password>`, as the PDS's admin methods use. */
function isAdmin(req: Request, password: string): boolean {
  const header = req.get('authorization') ?? ''
  if (!header.startsWith('Basic ')) return false
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  const separator = decoded.indexOf(':')
  return (
    separator > 0 &&
    decoded.slice(0, separator) === 'admin' &&
    sameSecret(decoded.slice(separator + 1), password)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The subject of an updateSubjectStatus call: a DID for
 * `com.atproto.admin.defs#repoRef`, an AT-URI for `com.atproto.repo.strongRef`.
 * Blob subjects are not supported; take down the record that uses the blob.
 */
function readSubject(subject: unknown): string | undefined {
  if (!isRecord(subject)) return undefined
  if (typeof subject['did'] === 'string' && /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(subject['did'])) {
    return subject['did']
  }
  if (
    typeof subject['uri'] === 'string' &&
    /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9.-]+\/[a-zA-Z0-9._:~-]+$/.test(subject['uri'])
  ) {
    return subject['uri']
  }
  return undefined
}

/**
 * Mounts `com.atproto.admin.updateSubjectStatus` (#120): the operator's
 * takedown tool calls it here as well as on the PDS, because a record
 * takedown on the PDS emits nothing on the firehose. Takedowns apply at once.
 * Without an admin password the method is not offered.
 */
export function mountAdmin(app: Express, takedowns: Takedowns, password: string | undefined): void {
  app.post(`/xrpc/${UPDATE_SUBJECT_STATUS}`, async (req: Request, res: Response) => {
    if (password === undefined || password === '') {
      res.status(501).json({ error: 'MethodNotImplemented', message: 'admin is not configured' })
      return
    }
    if (!isAdmin(req, password)) {
      res.status(401).json({ error: 'AuthRequired', message: 'admin credentials required' })
      return
    }

    const body: unknown = req.body
    const subject = isRecord(body) ? readSubject(body['subject']) : undefined
    const takedown = isRecord(body) && isRecord(body['takedown']) ? body['takedown'] : undefined
    if (
      subject === undefined ||
      takedown === undefined ||
      typeof takedown['applied'] !== 'boolean'
    ) {
      res.status(400).json({
        error: 'InvalidRequest',
        message: 'expected { subject: { did } | { uri, cid }, takedown: { applied, ref? } }',
      })
      return
    }

    try {
      if (takedown['applied']) {
        const ref = typeof takedown['ref'] === 'string' ? takedown['ref'] : new Date().toISOString()
        await takedowns.takedown(subject, ref)
      } else {
        await takedowns.liftTakedown(subject)
      }
      console.log(
        `[appview] takedown ${takedown['applied'] ? 'applied to' : 'lifted from'} ${subject}`,
      )
      res.status(200).json({ subject: (body as Record<string, unknown>)['subject'], takedown })
    } catch (error) {
      console.error('[appview] updateSubjectStatus failed:', error)
      res.status(500).json({ error: 'InternalServerError', message: 'failed to apply takedown' })
    }
  })
}
