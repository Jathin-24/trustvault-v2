/* eslint-disable @typescript-eslint/no-explicit-any --
 * A deliberately loose test double: it replays the small subset of the
 * supabase-js query builder that src/lib uses, against in-memory fixture
 * rows. It proves DECISION LOGIC only; real DB behaviour is proven by
 * db/gate.sql and the integration suite. */

export type Row = Record<string, any>
export type Db = Record<string, Row[]>

const DEFAULTS: Record<string, Row> = {
  users: { active: true }, // schema default
}

type Filter = (r: Row) => boolean

export function createMockClient(db: Db) {
  function from(table: string) {
    const rows = (db[table] ??= [])
    const filters: Filter[] = []
    let op: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}

    const matches = (r: Row) => filters.every((f) => f(r))

    const api = {
      select() {
        return api
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val)
        return api
      },
      ilike(col: string, val: unknown) {
        const needle = String(val).toLowerCase()
        filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle))
        return api
      },
      is(col: string, val: unknown) {
        filters.push((r) => r[col] === val)
        return api
      },
      insert(row: Row) {
        op = 'insert'
        payload = row
        return api
      },
      update(patch: Row) {
        op = 'update'
        payload = patch
        return api
      },
      maybeSingle() {
        return settle(false)
      },
      single() {
        return settle(true)
      },
    }

    function settle(strict: boolean): Promise<{ data: Row | null; error: { message: string } | null }> {
      if (op === 'insert') {
        const row = { id: crypto.randomUUID(), ...DEFAULTS[table], ...payload }
        rows.push(row)
        return Promise.resolve({ data: row, error: null })
      }
      if (op === 'update') {
        const matched = rows.filter(matches)
        for (const r of matched) Object.assign(r, payload)
        if (matched.length === 0) return Promise.resolve({ data: null, error: { message: 'no rows returned' } })
        return Promise.resolve({ data: matched[0], error: null })
      }
      const found = rows.find(matches) ?? null
      if (strict && !found) return Promise.resolve({ data: null, error: { message: 'no rows returned' } })
      return Promise.resolve({ data: found, error: null })
    }

    return api
  }

  return { from }
}
