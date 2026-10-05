import { join } from 'node:path'

import type { Database } from '@openreel/db'
import type { AtprotoIdentity } from '@openreel/service-core'
import type { Kysely } from 'kysely'

import type { BlobFetcher } from './blob.ts'
import { claimJob, completeJob, failJob, type Job } from './jobs.ts'
import type { MediaStore } from './store.ts'
import type { TranscodeResult } from './transcode.ts'

export interface WorkerDeps {
  db: Kysely<Database>
  identity: { resolve(did: string): Promise<AtprotoIdentity> }
  blobs: Pick<BlobFetcher, 'download'>
  store: MediaStore
  transcode: (input: string, outDir: string) => Promise<TranscodeResult>
  maxAttempts: number
  pollIntervalMs: number
}

/**
 * Polls the `video_media` queue and turns each claimed blob into published
 * HLS renditions: resolve the author's PDS, download and verify the blob,
 * transcode, publish. One job at a time; ffmpeg already uses every core.
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
    const job = await claimJob(this.#deps.db, this.#deps.maxAttempts)
    if (job === undefined) return false
    await this.#process(job)
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
      const { pds } = await identity.resolve(job.authorDid)
      if (pds === undefined) throw new Error(`${job.authorDid} has no PDS endpoint`)

      const source = join(work, 'source')
      await blobs.download(pds, job.authorDid, job.videoCid, source)
      const result = await transcode(source, join(work, 'out'))
      await store.publish(join(work, 'out'), job.authorDid, job.videoCid)
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
}
