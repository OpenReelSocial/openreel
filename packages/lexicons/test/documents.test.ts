// Tests over the Lexicon documents themselves: they parse, their NSIDs match
// their paths, every ref resolves, and the ADR-0001 record set is present.

import { describe, expect, it } from 'vitest'

import { type LoadedLexicon, loadLexicons, ownedPrefix, validateLexicons } from '../scripts/lex.ts'
import { ids, lexicons, schemas } from '../src/index.ts'

const adr0001Nsids = [
  'social.openreel.video.post',
  'social.openreel.engagement.watchEvent',
  'social.openreel.engagement.completionRate',
  'social.openreel.feed.generator',
]

describe('lexicon documents', () => {
  const loaded = loadLexicons()

  it('are all valid Lexicon 1 documents with resolvable refs', () => {
    expect(validateLexicons(loaded)).toEqual([])
    for (const { doc } of loaded) expect(doc.lexicon).toBe(1)
  })

  it('define every record type named in ADR-0001', () => {
    const owned = loaded.map((l) => l.doc.id).filter((id) => id.startsWith(ownedPrefix))
    expect(owned).toEqual(expect.arrayContaining(adr0001Nsids))
  })

  it('use lowerCamelCase property names and knownValues rather than enums', () => {
    for (const { file, doc } of loaded.filter((l) => l.doc.id.startsWith(ownedPrefix))) {
      const seen: string[] = []
      walk(doc.defs, (node) => {
        if (node['type'] === 'object' && typeof node['properties'] === 'object') {
          for (const name of Object.keys(node['properties'] ?? {})) seen.push(name)
        }
        expect(node['enum'], `${file} uses a closed enum`).toBeUndefined()
      })
      for (const name of seen) expect(name, `${file}: ${name}`).toMatch(/^[a-z][A-Za-z0-9]*$/)
    }
  })

  it('match the generated bindings', () => {
    const fromDocs = loaded.map((l) => l.doc.id).sort()
    expect(schemas.map((s) => s.id).sort()).toEqual(fromDocs)
    expect(Object.values(ids).sort()).toEqual(fromDocs)
    for (const nsid of adr0001Nsids) expect(() => lexicons.getDefOrThrow(nsid)).not.toThrow()
  })
})

describe('validateLexicons', () => {
  it('reports an NSID that does not match its path', () => {
    const doc: LoadedLexicon = {
      file: 'social/openreel/video/post.json',
      doc: { lexicon: 1, id: 'social.openreel.video.clip', defs: {} },
    }
    expect(validateLexicons([doc]).join('\n')).toContain('does not match path')
  })

  it('reports a document outside the owned namespace that is not vendored', () => {
    const doc: LoadedLexicon = {
      file: 'app/bsky/feed/post.json',
      doc: { lexicon: 1, id: 'app.bsky.feed.post', defs: {} },
    }
    expect(validateLexicons([doc]).join('\n')).toContain('not a vendored')
  })

  it('reports an unresolved ref', () => {
    const doc: LoadedLexicon = {
      file: 'social/openreel/video/post.json',
      doc: {
        lexicon: 1,
        id: 'social.openreel.video.post',
        defs: {
          main: {
            type: 'object',
            properties: { subject: { type: 'ref', ref: 'com.atproto.repo.strongRef' } },
          },
        },
      },
    }
    expect(validateLexicons([doc]).join('\n')).toContain('unresolved ref')
  })

  it('reports a document the Lexicon parser rejects', () => {
    const doc = {
      file: 'social/openreel/video/post.json',
      doc: { lexicon: 1, id: 'social.openreel.video.post', defs: { main: { type: 'nope' } } },
    } as unknown as LoadedLexicon
    expect(validateLexicons([doc]).join('\n')).toContain('lexicon parse failed')
  })
})

function walk(node: unknown, visit: (node: Record<string, unknown>) => void) {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit)
  } else if (node !== null && typeof node === 'object') {
    visit(node as Record<string, unknown>)
    for (const value of Object.values(node)) walk(value, visit)
  }
}
