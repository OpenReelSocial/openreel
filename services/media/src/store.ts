import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Where finished renditions go. Keys are (author DID, blob CID), so objects
 * are immutable and can be cached forever. The filesystem store suits one
 * host behind nginx (ADR-0006); an S3 store implementing the same interface
 * replaces it when media moves to object storage and a CDN.
 */
export interface MediaStore {
  /** Gives the worker a scratch directory to build renditions in. */
  workDir(): Promise<string>
  /** Publishes a finished scratch directory under its key, replacing any old copy. */
  publish(workDir: string, did: string, cid: string): Promise<void>
  discard(workDir: string): Promise<void>
}

/** Path of a key under the media root; the layout the media CDN and AppView URLs assume. */
export function keyPath(root: string, did: string, cid: string): string {
  if (!/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(did) || !/^[a-z0-9]+$/.test(cid)) {
    throw new Error(`refusing unsafe media key ${did}/${cid}`)
  }
  return join(root, did, cid)
}

export class FileMediaStore implements MediaStore {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  async workDir(): Promise<string> {
    // Inside the root so publishing is a same-filesystem rename. The leading
    // dot keeps it out of what the CDN serves.
    const scratch = join(this.#root, '.work')
    await mkdir(scratch, { recursive: true })
    return mkdtemp(join(scratch, 'job-'))
  }

  async publish(workDir: string, did: string, cid: string): Promise<void> {
    const target = keyPath(this.#root, did, cid)
    await mkdir(join(target, '..'), { recursive: true })
    // Readers see either the old tree or the new one, never a partial one.
    const old = `${workDir}.old`
    await rename(target, old).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    await rename(workDir, target)
    await rm(old, { recursive: true, force: true })
  }

  async discard(workDir: string): Promise<void> {
    await rm(workDir, { recursive: true, force: true })
  }
}
