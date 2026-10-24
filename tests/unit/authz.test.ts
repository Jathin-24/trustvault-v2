/**
 * The default-deny matrix for authorize() — decision D7, the heart of the
 * app. The Supabase client is an in-memory test double (tests/helpers/
 * db-mock.ts): these tests prove the DECISION LOGIC; the same rules are
 * re-proven against the real database by tests/integration/gates.test.ts
 * and db/gate.sql.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authorize, type DocumentRow } from '@/lib/authz'
import type { AppUser } from '@/lib/users'

const h = vi.hoisted(() => ({ db: {} as Record<string, never[]> }))
vi.mock('@/lib/supabase-admin', async () => {
  const { createMockClient } = await import('../helpers/db-mock')
  return { createAdminClient: () => createMockClient(h.db as never) }
})

const OWNER = '11111111-1111-4111-8111-111111111111'
const STRANGER = '22222222-2222-4222-8222-222222222222'
const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function makeUser(id: string, role: 'admin' | 'member' = 'member'): AppUser {
  return { id, clerkId: `clerk_${id}`, email: `${id}@x.test`, name: null, role, active: true }
}

function makeDoc(over: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: DOC_ID,
    owner_id: OWNER,
    name: 'secret.pdf',
    category: 'general',
    storage_key: 'k',
    mime_type: 'application/pdf',
    size_bytes: 10,
    sha256: 'abc',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    ...over,
  }
}

type Grant = {
  document_id: string
  user_id: string
  level: 'read' | 'edit'
  revoked_at: string | null
}
const grant = (over: Partial<Grant> = {}): Grant => ({
  document_id: DOC_ID,
  user_id: STRANGER,
  level: 'read',
  revoked_at: null,
  ...over,
})

beforeEach(() => {
  h.db = { documents: [], document_permissions: [] } as never
})

describe('authorize — default deny (D7)', () => {
  it('denies a signed-out caller before touching the database', async () => {
    const res = await authorize(null, DOC_ID, 'read')
    expect(res).toEqual({ allowed: false, reason: 'no session' })
  })

  it('denies an id that does not exist — "not found", not a leak', async () => {
    const res = await authorize(makeUser(STRANGER), '99999999-9999-4999-8999-999999999999', 'read')
    expect(res).toEqual({ allowed: false, reason: 'not found' })
  })

  it('denies a stranger with no grant on every action', async () => {
    ;(h.db as never as { documents: DocumentRow[] }).documents.push(makeDoc())
    for (const action of ['read', 'edit', 'delete', 'share'] as const) {
      const res = await authorize(makeUser(STRANGER), DOC_ID, action)
      expect(res).toEqual({ allowed: false, reason: 'no grant' })
    }
  })

  it('denies a revoked grant — revocation applies to the very next check', async () => {
    ;(h.db as never as { documents: DocumentRow[] }).documents.push(makeDoc())
    ;(h.db as never as { document_permissions: Grant[] }).document_permissions.push(
      grant({ revoked_at: '2026-01-02T00:00:00Z' }),
    )
    const res = await authorize(makeUser(STRANGER), DOC_ID, 'read')
    expect(res).toEqual({ allowed: false, reason: 'no grant' })
  })
})

describe('authorize — the owner', () => {
  beforeEach(() => {
    ;(h.db as never as { documents: DocumentRow[] }).documents.push(makeDoc())
  })

  it('may read, edit, delete and share their own document', async () => {
    for (const action of ['read', 'edit', 'delete', 'share'] as const) {
      const res = await authorize(makeUser(OWNER), DOC_ID, action)
      expect(res.allowed).toBe(true)
    }
  })

  it('still reaches their soft-deleted document (metadata, D9)', async () => {
    h.db = { documents: [makeDoc({ deleted_at: '2026-01-03T00:00:00Z' })], document_permissions: [] } as never
    const res = await authorize(makeUser(OWNER), DOC_ID, 'read')
    expect(res.allowed).toBe(true)
  })
})

describe('authorize — grants', () => {
  beforeEach(() => {
    ;(h.db as never as { documents: DocumentRow[] }).documents.push(makeDoc())
  })

  it('read grant: may read, may NOT edit/delete/share', async () => {
    ;(h.db as never as { document_permissions: Grant[] }).document_permissions.push(grant({ level: 'read' }))
    const user = makeUser(STRANGER)

    expect((await authorize(user, DOC_ID, 'read')).allowed).toBe(true)

    const edit = await authorize(user, DOC_ID, 'edit')
    expect(edit).toEqual({ allowed: false, reason: 'edit requires edit grant' })
    const del = await authorize(user, DOC_ID, 'delete')
    expect(del).toEqual({ allowed: false, reason: 'delete is owner only' })
    const share = await authorize(user, DOC_ID, 'share')
    expect(share).toEqual({ allowed: false, reason: 'share is owner only' })
  })

  it('edit grant: may read AND edit, still may not delete or share', async () => {
    ;(h.db as never as { document_permissions: Grant[] }).document_permissions.push(grant({ level: 'edit' }))
    const user = makeUser(STRANGER)

    expect((await authorize(user, DOC_ID, 'read')).allowed).toBe(true)
    expect((await authorize(user, DOC_ID, 'edit')).allowed).toBe(true)
    expect((await authorize(user, DOC_ID, 'delete')).allowed).toBe(false)
    expect((await authorize(user, DOC_ID, 'share')).allowed).toBe(false)
  })
})

describe('authorize — admin has no content access (D6)', () => {
  it('admin without a grant is denied like any stranger', async () => {
    ;(h.db as never as { documents: DocumentRow[] }).documents.push(makeDoc())
    const admin = makeUser(STRANGER, 'admin')
    for (const action of ['read', 'edit', 'delete', 'share'] as const) {
      const res = await authorize(admin, DOC_ID, action)
      expect(res).toEqual({ allowed: false, reason: 'no grant' })
    }
  })

  it('being admin does not make delete/share pass — owner only', async () => {
    ;(h.db as never as { documents: DocumentRow[] }).documents.push(makeDoc())
    ;(h.db as never as { document_permissions: Grant[] }).document_permissions.push(grant({ level: 'read' }))
    const admin = makeUser(STRANGER, 'admin')
    expect((await authorize(admin, DOC_ID, 'read')).allowed).toBe(true) // via the grant, not the role
    expect((await authorize(admin, DOC_ID, 'share')).allowed).toBe(false)
  })
})

describe('authorize — soft-deleted documents hide from everyone but the owner (D9)', () => {
  it('a granted user hits "not found" once the document is deleted', async () => {
    h.db = {
      documents: [makeDoc({ deleted_at: '2026-01-03T00:00:00Z' })],
      document_permissions: [grant({ level: 'edit' })],
    } as never
    const res = await authorize(makeUser(STRANGER), DOC_ID, 'read')
    expect(res).toEqual({ allowed: false, reason: 'not found' })
  })
})
