import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { traceRoot, traceStep, type Database } from '@openreel/db'
import type { AtprotoIdentity } from '@openreel/service-core'
import type { Kysely } from 'kysely'

import type { BlobFetcher } from './blob.ts'
import type { CdnInvalidator } from './cdn.ts'
import {
  claimJob,
  claimRemoval,
  completeJob,
  completeRemoval,
  failJob,
  type Job,
  type Removal,
} from './jobs.ts'
import type { MediaStore } from './store.ts'
import type { TranscodeResult } from './transcode.ts'

export interface WorkerDeps {
  db: Kysely<Database>
  identity: { resolve(did: string): Promise<AtprotoIdentity> }
  blobs: Pick<BlobFetcher, 'download'>
  store: MediaStore
  /** The CDN in front of `store`, if any; removed renditions are evicted from it. */
  cdn?: CdnInvalidator
  transcode: (input: string, outDir: string) => Promise<TranscodeResult>
  maxAttempts: number
  pollIntervalMs: number
}

/**
 * Polls the `video_media` queue and turns each claimed blob into published
 * HLS renditions: resolve the author's PDS, download and verify the blob,
 * transcode, publish. One job at a time; ffmpeg already uses every core.
 * Removals (deleted or taken-down posts) go first: they are quick, and a
 * takedown should not wait behind a transcode backlog.
 */
export class Worker {
  readonly #deps: WorkerDeps
  #running = false
  #idle: Promise<void> = Promise.resolve()
  #wake: (() => void) | undefined

  constructor(deps: WorkerDeps) {
    this.#deps = deps
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#idle = this.#loop()
  }

  async stop(): Promise<void> {
    this.#running = false
    this.#wake?.()
    await this.#idle
  }

  /** Claims and processes one job; returns false when the queue was empty. */
  async runOnce(): Promise<boolean> {
    const removal = await claimRemoval(this.#deps.db)
    if (removal !== undefined) {
      await traceRoot(
        { kind: 'job', name: 'remove', did: removal.authorDid, subject: removal.videoCid },
        () => this.#remove(removal),
      )
      return true
    }

    const job = await claimJob(this.#deps.db, this.#deps.maxAttempts)
    if (job === undefined) return false
    await traceRoot(
      { kind: 'job', name: 'transcode', did: job.authorDid, subject: job.videoCid },
      () => this.#process(job),
    )
    return true
  }

  async #loop(): Promise<void> {
    while (this.#running) {
      let worked = false
      try {
        worked = await this.runOnce()
      } catch (error) {
        console.error('[media] queue error:', error)
      }
      if (!worked && this.#running) {
        await new Promise<void>((resolve) => {
          this.#wake = resolve
          setTimeout(resolve, this.#deps.pollIntervalMs)
        })
      }
    }
  }

  async #process(job: Job): Promise<void> {
    const { identity, blobs, store, transcode, db } = this.#deps
    const label = `${job.authorDid}/${job.videoCid}`
    const started = Date.now()
    let work: string | undefined
    try {
      work = await store.workDir()
      const { pds } = await traceStep(
        'Resolve author PDS via PLC',
        { kind: 'call', target: 'plc', method: 'GET', path: `/${job.authorDid}` },
        () => identity.resolve(job.authorDid),
      )
      if (pds === undefined) throw new Error(`${job.authorDid} has no PDS endpoint`)

      const source = join(work, 'source')
      await traceStep(
        'Fetch source blob from PDS',
        { kind: 'call', target: 'pds', method: 'GET', path: '/xrpc/com.atproto.sync.getBlob' },
        async (note) => {
          await blobs.download(pds, job.authorDid, job.videoCid, source)
          note({ bytes: (await stat(source)).size })
        },
      )
      const out = join(work, 'out')
      const result = await traceStep(
        'Transcode to HLS renditions',
        { kind: 'work', what: 'ffmpeg → HLS' },
        () => transcode(source, out),
      )
      await traceStep(
        'Publish HLS renditions',
        { kind: 'store', target: store.name },
        async (note) => {
          note(await sizeOf(out))
          await store.publish(out, job.authorDid, job.videoCid)
        },
      )
      await completeJob(db, job, result)
      console.log(`[media] ready ${label} in ${((Date.now() - started) / 1000).toFixed(1)}s`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[media] attempt ${job.attempts} failed for ${label}: ${message}`)
      await failJob(db, job, message)
    } finally {
      if (work !== undefined) await store.discard(work)
    }
  }

  /**
   * Deletes a blob's renditions from the store, then from the CDN cache. On
   * failure the claim lapses and the removal is retried.
   */
  async #remove(removal: Removal): Promise<void> {
    const { store, cdn, db } = this.#deps
    const label = `${removal.authorDid}/${removal.videoCid}`
    try {
      await traceStep('Delete renditions', { kind: 'store', target: store.name }, () =>
        store.remove(removal.authorDid, removal.videoCid),
      )
      if (cdn !== undefined) {
        await traceStep(
          'Invalidate CDN cache',
          { kind: 'call', target: 'cdn', method: 'POST', path: `/${label}/*` },
          () => cdn.invalidate(removal.authorDid, removal.videoCid),
        )
      }
      await completeRemoval(db, removal)
      console.log(`[media] removed ${label}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[media] removing ${label} failed, will retry: ${message}`)
    }
  }
}

/** File count and total size of a rendition directory. */
async function sizeOf(dir: string): Promise<{ objects: number; bytes: number }> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile())
  const sizes = await Promise.all(
    files.map(async (entry) => (await stat(join(entry.parentPath, entry.name))).size),
  )
  return { objects: files.length, bytes: sizes.reduce((a, b) => a + b, 0) }
}
