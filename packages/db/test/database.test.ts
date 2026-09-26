import { describe, expect, it } from 'vitest'

import { closeDb, createDb } from '../src/database.ts'

describe('createDb', () => {
  it('rejects an empty connection string', () => {
    expect(() => createDb('')).toThrow(/connection string is empty/)
    expect(() => createDb('   ')).toThrow(/connection string is empty/)
  })

  it('does not connect until a query runs', async () => {
    // An unroutable host: constructing and closing must still succeed without I/O.
    const db = createDb('postgres://nobody:nothing@203.0.113.1:1/none')
    await expect(closeDb(db)).resolves.toBeUndefined()
  })
})
