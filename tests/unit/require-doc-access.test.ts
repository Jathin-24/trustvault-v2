/**
 * requireDocAccess — the wrapper every document route uses:
 * auth → authorize → log → 404.
 *
 * Proven here (D8): a denial answers 404, never 403 (a 403 would confirm
 * the document exists), and every denial is written to the audit log with
 * its reason. Signed-out requests are 401 and are not audited (no actor).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextResponse } from 'next/server'
import { requireDocAccess, type Access } from '@/lib/require-doc-access'
import type { AppUser } from '@/lib/users'
import type { DocumentRow } from '@/lib/authz'

const h = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  authorize: vi.fn(),
  logAudit: vi.fn(),
}))

vi.mock('@/lib/users', () => ({ getCurrentUser: h.getCurrentUser }))
vi.mock('@/lib/authz', () => ({ authorize: h.authorize }))
vi.mock('@/lib/audit', () => ({ logAudit: h.logAudit }))
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.7', 'user-agent': 'vitest-agent' })),
}))

const DOC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const user: AppUser = {
  id: '44444444-4444-4444-8444-444444444444',
  clerkId: 'user_1',
  email: 'meena@vaultdemo.com',
  name: null,
  role: 'member',
  active: true,
}

const document: DocumentRow = {
  id: DOC_ID,
  owner_id: '55555555-5555-4555-8555-555555555555',
  name: 'meeting-notes.pdf',
  category: 'general',
  storage_key: 'k',
  mime_type: 'application/pdf',
  size_bytes: 10,
  sha256: 'abc',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  deleted_at: null,
}

function denied(res: Access): NextResponse {
  if (res.ok) throw new Error('expected a denial, got access')
  return res.response
}

beforeEach(() => {
  h.getCurrentUser.mockReset()
  h.authorize.mockReset()
  h.logAudit.mockReset()
  h.logAudit.mockResolvedValue(undefined)
})

describe('requireDocAccess — signed out', () => {
  it('answers 401, never calls authorize, and writes no audit row', async () => {
    h.getCurrentUser.mockResolvedValue(null)

    const res = await requireDocAccess(DOC_ID, 'read')

    expect(res.ok).toBe(false)
    const out = denied(res)
    expect(out.status).toBe(401)
    expect(await out.json()).toEqual({ error: 'unauthorized' })
    expect(h.authorize).not.toHaveBeenCalled()
    expect(h.logAudit).not.toHaveBeenCalled()
  })
})

describe('requireDocAccess — denials are 404 + audited (D8)', () => {
  it.each([['no grant'], ['not found']])('reason %s → 404 (not 403) and one audit row', async (reason) => {
    h.getCurrentUser.mockResolvedValue(user)
    h.authorize.mockResolvedValue({ allowed: false, reason })

    const res = await requireDocAccess(DOC_ID, 'read')

    expect(res.ok).toBe(false)
    const out = denied(res)
    expect(out.status).toBe(404)
    expect(out.status).not.toBe(403)
    expect(await out.json()).toEqual({ error: 'not found' })

    expect(h.logAudit).toHaveBeenCalledTimes(1)
    expect(h.logAudit).toHaveBeenCalledWith({
      actorId: user.id,
      action: 'read',
      documentId: DOC_ID,
      outcome: 'denied',
      ip: '203.0.113.9',
      userAgent: 'vitest-agent',
      details: { reason },
    })
  })
})

describe('requireDocAccess — allowed', () => {
  it('returns the user and the document, and writes no audit row', async () => {
    h.getCurrentUser.mockResolvedValue(user)
    h.authorize.mockResolvedValue({ allowed: true, document })

    const res = await requireDocAccess(DOC_ID, 'read')

    if (!res.ok) throw new Error('expected access')
    expect(res.user).toBe(user)
    expect(res.document).toBe(document)
    expect(h.logAudit).not.toHaveBeenCalled() // routes log their own allowed actions
  })
})
