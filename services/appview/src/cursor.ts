/** A cursor this AppView did not issue. */
export class InvalidCursorError extends Error {}

/**
 * Keyset cursor over (sort_at, uri): `<epoch ms>::<uri>`, as the feed
 * generator's. The URI breaks ties between rows with the same timestamp.
 */
export function encodeCursor(sortAt: Date, uri: string): string {
  return `${sortAt.getTime()}::${uri}`
}

export function decodeCursor(cursor: string): { sortAt: Date; uri: string } {
  const sep = cursor.indexOf('::')
  const ms = Number(cursor.slice(0, sep))
  const uri = cursor.slice(sep + 2)
  if (sep < 1 || !Number.isSafeInteger(ms) || !uri.startsWith('at://')) {
    throw new InvalidCursorError('malformed cursor')
  }
  return { sortAt: new Date(ms), uri }
}
