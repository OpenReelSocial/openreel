import { readFileSync } from 'node:fs'

/** Signals a weighted feed can score by; see `social.openreel.feed.defs#rankingWeight`. */
export const SIGNALS = ['views', 'likes', 'recency'] as const
export type Signal = (typeof SIGNALS)[number]

export interface SignalWeight {
  signal: Signal
  /** Share of the score, 0-1. A feed's weights sum to 1. */
  weight: number
  /** Required for `recency`: hours for the signal to fall by half. */
  halfLifeHours?: number
}

export type Ranking = { type: 'chronological' } | { type: 'weighted'; weights: SignalWeight[] }

/** One feed this generator serves, as declared in the feeds file. */
export interface FeedDefinition {
  /** The generator record's rkey, so the feed URI ends in `/<id>`. */
  id: string
  displayName: string
  description?: string
  /** `social.openreel.feed.generator#rankingCriteria`, disclosed to clients. */
  rankingCriteria: string
  ranking: Ranking
}

/** The feeds file shipped with the service, used unless FEEDGEN_FEEDS_FILE names another. */
export const DEFAULT_FEEDS_FILE = new URL('../feeds.json', import.meta.url)

/** Reads and validates a feeds file. Throws with every problem found, so startup fails loudly. */
export function loadFeeds(file: string | URL = DEFAULT_FEEDS_FILE): FeedDefinition[] {
  let json: unknown
  try {
    json = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`cannot read feeds file ${String(file)}: ${(error as Error).message}`)
  }
  return parseFeeds(json)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Record keys may hold more, but feed IDs end up in URLs and logs; keep them plain.
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export function parseFeeds(json: unknown): FeedDefinition[] {
  const problems: string[] = []
  const feeds: FeedDefinition[] = []
  const rawFeeds = isObject(json) ? json['feeds'] : undefined
  if (!Array.isArray(rawFeeds) || rawFeeds.length === 0) {
    throw new Error('feeds file: "feeds" must be a non-empty array')
  }

  const seen = new Set<string>()
  rawFeeds.forEach((raw: unknown, index) => {
    const at = `feeds[${index}]`
    if (!isObject(raw)) {
      problems.push(`${at}: must be an object`)
      return
    }
    const { id, displayName, description, rankingCriteria, ranking } = raw
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      problems.push(`${at}.id: must be lowercase letters, digits, and hyphens`)
    } else if (seen.has(id)) {
      problems.push(`${at}.id: duplicate feed "${id}"`)
    } else {
      seen.add(id)
    }
    // Lexicon limit is 24 graphemes; length is close enough for config text.
    if (typeof displayName !== 'string' || displayName.length === 0 || displayName.length > 24) {
      problems.push(`${at}.displayName: must be 1-24 characters`)
    }
    if (
      description !== undefined &&
      (typeof description !== 'string' || description.length > 300)
    ) {
      problems.push(`${at}.description: must be at most 300 characters`)
    }
    if (typeof rankingCriteria !== 'string' || rankingCriteria === '') {
      problems.push(`${at}.rankingCriteria: required`)
    }
    const parsed = parseRanking(ranking, `${at}.ranking`, problems)
    if (problems.length === 0 && parsed !== undefined) {
      feeds.push({
        id: id as string,
        displayName: displayName as string,
        ...(description === undefined ? {} : { description: description as string }),
        rankingCriteria: rankingCriteria as string,
        ranking: parsed,
      })
    }
  })

  if (problems.length > 0) throw new Error(`invalid feeds file:\n  ${problems.join('\n  ')}`)
  return feeds
}

function parseRanking(raw: unknown, at: string, problems: string[]): Ranking | undefined {
  if (!isObject(raw)) {
    problems.push(`${at}: must be an object`)
    return undefined
  }
  if (raw['type'] === 'chronological') return { type: 'chronological' }
  if (raw['type'] !== 'weighted') {
    problems.push(`${at}.type: must be "chronological" or "weighted"`)
    return undefined
  }

  const rawWeights = raw['weights']
  if (!Array.isArray(rawWeights) || rawWeights.length === 0) {
    problems.push(`${at}.weights: must be a non-empty array`)
    return undefined
  }
  const weights: SignalWeight[] = []
  const signals = new Set<string>()
  rawWeights.forEach((w: unknown, index) => {
    const wat = `${at}.weights[${index}]`
    if (!isObject(w)) {
      problems.push(`${wat}: must be an object`)
      return
    }
    const { signal, weight, halfLifeHours } = w
    if (!SIGNALS.includes(signal as Signal)) {
      problems.push(`${wat}.signal: must be one of ${SIGNALS.join(', ')}`)
      return
    }
    if (signals.has(signal as string)) problems.push(`${wat}.signal: "${String(signal)}" repeated`)
    signals.add(signal as string)
    if (typeof weight !== 'number' || !(weight > 0 && weight <= 1)) {
      problems.push(`${wat}.weight: must be a number in (0, 1]`)
    }
    if (signal === 'recency') {
      if (!Number.isInteger(halfLifeHours) || (halfLifeHours as number) < 1) {
        problems.push(`${wat}.halfLifeHours: required for recency, a whole number of hours >= 1`)
      }
    } else if (halfLifeHours !== undefined) {
      problems.push(`${wat}.halfLifeHours: only applies to recency`)
    }
    weights.push({
      signal: signal as Signal,
      weight: weight as number,
      ...(signal === 'recency' ? { halfLifeHours: halfLifeHours as number } : {}),
    })
  })

  const total = weights.reduce((sum, w) => sum + (typeof w.weight === 'number' ? w.weight : 0), 0)
  if (Math.abs(total - 1) > 1e-6) problems.push(`${at}.weights: must sum to 1 (got ${total})`)
  return { type: 'weighted', weights }
}
