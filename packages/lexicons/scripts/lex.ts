// Lexicon toolchain entrypoint, run through the package scripts (`pnpm run lex`,
// `pnpm run lex:check`, `pnpm run lex:validate`) and from the root Makefile.
//
//   validate  load every lexicons/**/*.json into an @atproto/lexicon collection,
//             check that each NSID matches its file path and every ref resolves
//   generate  validate, then regenerate src/generated with @atproto/lex-cli
//   check     validate, then regenerate into a temp dir and fail if it differs
//             from the committed src/generated (never touches the tree)

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { Lexicons, type LexiconDoc, parseLexiconDoc } from '@atproto/lexicon'

export const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const lexiconsDir = path.join(packageDir, 'lexicons')
export const generatedDir = path.join(packageDir, 'src', 'generated')

/** Namespaces OpenReel authors. Anything else under lexicons/ is vendored upstream. */
export const ownedPrefix = 'social.openreel.'

export interface LoadedLexicon {
  /** Path relative to the package's lexicons/ directory, e.g. social/openreel/video/post.json */
  file: string
  doc: LexiconDoc
}

/** Every Lexicon JSON file, sorted by path so generation is deterministic. */
export function listLexiconFiles(dir: string = lexiconsDir): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

export function loadLexicons(dir: string = lexiconsDir): LoadedLexicon[] {
  return listLexiconFiles(dir).map((full) => ({
    file: path.relative(dir, full),
    doc: JSON.parse(readFileSync(full, 'utf8')) as LexiconDoc,
  }))
}

/**
 * Validates a set of Lexicon documents. Returns a list of human-readable
 * problems; an empty list means the set is valid.
 */
export function validateLexicons(loaded: LoadedLexicon[]): string[] {
  const problems: string[] = []

  for (const { file, doc } of loaded) {
    const expectedId = file
      .replace(/\.json$/, '')
      .split(path.sep)
      .join('.')
    if (doc.id !== expectedId) {
      problems.push(
        `${file}: id "${String(doc.id)}" does not match path (expected "${expectedId}")`,
      )
    }
    if (!doc.id.startsWith(ownedPrefix) && !file.startsWith(`com${path.sep}atproto${path.sep}`)) {
      problems.push(
        `${file}: "${doc.id}" is outside ${ownedPrefix}* but is not a vendored com.atproto document`,
      )
    }
  }

  // The collection constructor stores documents without checking them, so run
  // each through the Lexicon schema parser explicitly.
  const parsed: LexiconDoc[] = []
  for (const { file, doc } of loaded) {
    try {
      parsed.push(parseLexiconDoc(doc))
    } catch (err) {
      problems.push(`${file}: lexicon parse failed: ${describeError(err)}`)
    }
  }
  if (problems.length > 0) return problems
  const collection = new Lexicons(parsed)

  // The parser does not resolve references, so check every ref/union target
  // exists; otherwise a missing vendored document only surfaces at runtime.
  for (const { file, doc } of loaded) {
    for (const ref of collectRefs(doc.defs)) {
      const absolute = ref.startsWith('#') ? `${doc.id}${ref}` : ref
      try {
        collection.getDefOrThrow(absolute)
      } catch {
        problems.push(`${file}: unresolved ref "${ref}"`)
      }
    }
  }

  return problems
}

/** Zod errors stringify as a JSON blob; flatten them to one line per issue. */
function describeError(err: unknown): string {
  if (err !== null && typeof err === 'object' && 'issues' in err && Array.isArray(err.issues)) {
    return (err.issues as { path: (string | number)[]; message: string }[])
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
  }
  return err instanceof Error ? err.message : String(err)
}

function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, out)
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>
    if (record['type'] === 'ref' && typeof record['ref'] === 'string') out.push(record['ref'])
    if (record['type'] === 'union' && Array.isArray(record['refs'])) {
      for (const ref of record['refs']) if (typeof ref === 'string') out.push(ref)
    }
    for (const value of Object.values(record)) collectRefs(value, out)
  }
  return out
}

function runValidate(): LoadedLexicon[] {
  const loaded = loadLexicons()
  const problems = validateLexicons(loaded)
  if (problems.length > 0) {
    console.error(`Lexicon validation failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exit(1)
  }
  console.log(`Validated ${loaded.length} Lexicon documents.`)
  return loaded
}

function runLexCli(outDir: string): void {
  const bin = path.join(packageDir, 'node_modules', '.bin', 'lex')
  execFileSync(bin, ['gen-api', '--yes', outDir, ...listLexiconFiles()], {
    cwd: packageDir,
    stdio: ['ignore', 'ignore', 'inherit'],
  })
}

function listFilesRelative(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  if (!existsSync(dir)) return out
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = path.join(current, entry)
      if (statSync(full).isDirectory()) walk(full)
      else out.set(path.relative(dir, full), readFileSync(full))
    }
  }
  walk(dir)
  return out
}

function runGenerate(): void {
  runValidate()
  runLexCli(generatedDir)
  console.log(`Generated bindings in ${path.relative(process.cwd(), generatedDir)}.`)
}

function runCheck(): void {
  runValidate()
  const tmp = mkdtempSync(path.join(tmpdir(), 'openreel-lex-'))
  try {
    runLexCli(tmp)
    const expected = listFilesRelative(tmp)
    const actual = listFilesRelative(generatedDir)
    const stale: string[] = []
    for (const [file, contents] of expected) {
      const current = actual.get(file)
      if (!current) stale.push(`missing: ${file}`)
      else if (!current.equals(contents)) stale.push(`differs: ${file}`)
    }
    for (const file of actual.keys()) {
      if (!expected.has(file)) stale.push(`unexpected: ${file}`)
    }
    if (stale.length > 0) {
      console.error(
        `Generated Lexicon bindings are stale:\n${stale.map((s) => `  - ${s}`).join('\n')}\n\n` +
          `Run 'make lex' and commit the result.`,
      )
      process.exit(1)
    }
    console.log('Generated bindings are up to date.')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  const command = process.argv[2]
  switch (command) {
    case 'validate':
      runValidate()
      break
    case 'generate':
      runGenerate()
      break
    case 'check':
      runCheck()
      break
    default:
      console.error('usage: lex.ts <validate|generate|check>')
      process.exit(2)
  }
}
