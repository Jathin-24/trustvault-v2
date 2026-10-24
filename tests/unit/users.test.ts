/**
 * getCurrentUser() — identity and the never-automatic-admin rule (D5),
 * deactivation checked on every request (D11), and the seeded-row claim
 * that lets demo accounts link on first sign-in (M3).
 *
 * Clerk and Supabase are mocked; what is proven here is the code path:
 * what the function looks up, what it inserts, and what it refuses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getCurrentUser } from '@/lib/users'
import type { Row } from '../helpers/db-mock'

const h = vi.hoisted(() => ({
  db: {} as Record<string, never[]>,
  auth: vi.fn(),
  currentUser: vi.fn(),
}))

vi.mock('@clerk/nextjs/server', () => ({ auth: h.auth, currentUser: h.currentUser }))
vi.mock('@/lib/supabase-admin', async () => {
  const { createMockClient } = await import('../helpers/db-mock')
  return { createAdminClient: () => createMockClient(h.db as never) }
})

const CLERK_ID = 'user_3L7dVdSRNziXmmXjeOzCoM95G3h'

function clerkUser(email: string) {
  return {
    primaryEmailAddress: { emailAddress: email },
    emailAddresses: [{ emailAddress: email }],
    fullName: 'Demo Person',
  }
}

function seedUser(over: Partial<Row> = {}): Row {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    clerk_id: CLERK_ID,
    email: 'admin@vaultdemo.com',
    name: 'Admin',
    role: 'admin',
    active: true,
    ...over,
  }
}

const users = () => (h.db as Record<string, Row[]>).users ?? []

beforeEach(() => {
  h.db = { users: [] } as never
  h.auth.mockReset()
  h.currentUser.mockReset()
})

describe('getCurrentUser — session handling', () => {
  it('returns null with no session', async () => {
    h.auth.mockResolvedValue({ userId: null })
    expect(await getCurrentUser()).toBeNull()
    expect(h.currentUser).not.toHaveBeenCalled()
  })

  it('returns null when clerk has no user for the session', async () => {
    h.auth.mockResolvedValue({ userId: CLERK_ID })
    h.currentUser.mockResolvedValue(null)
    expect(await getCurrentUser()).toBeNull()
  })
})

describe('getCurrentUser — the new-user default is member, never admin (D5)', () => {
  it('inserts a fresh row as member', async () => {
    h.auth.mockResolvedValue({ userId: CLERK_ID })
    h.currentUser.mockResolvedValue(clerkUser('newbie@vaultdemo.com'))

    const user = await getCurrentUser()

    expect(user).toMatchObject({
      clerkId: CLERK_ID,
      email: 'newbie@vaultdemo.com',
      role: 'member', // literal from code, not from the row that did not exist
    })
    expect(users()).toHaveLength(1)
    expect(users()[0].role).toBe('member')
  })
})

describe('getCurrentUser — seeded rows link on first sign-in', () => {
  it('claims a row that matches by email and updates its clerk_id', async () => {
    const seeded = seedUser({ clerk_id: 'seed:ravi@vaultdemo.com', email: 'ravi@vaultdemo.com', role: 'member' })
    h.db = { users: [seeded] } as never
    h.auth.mockResolvedValue({ userId: CLERK_ID })
    h.currentUser.mockResolvedValue(clerkUser('ravi@vaultdemo.com'))

    const user = await getCurrentUser()

    expect(user?.id).toBe(seeded.id)
    expect(user?.clerkId).toBe(CLERK_ID)
    expect(users()[0].clerk_id).toBe(CLERK_ID) // the claim is persisted
    expect(users()).toHaveLength(1) // no duplicate row created
  })
})

describe('getCurrentUser — deactivation is checked on every request (D11)', () => {
  it('returns null for an inactive row even with a valid session', async () => {
    h.db = { users: [seedUser({ active: false })] } as never
    h.auth.mockResolvedValue({ userId: CLERK_ID })
    h.currentUser.mockResolvedValue(clerkUser('admin@vaultdemo.com'))

    expect(await getCurrentUser()).toBeNull()
    // still null on an immediate second request — nothing is cached
    expect(await getCurrentUser()).toBeNull()
  })

  it('a reactivated user passes again', async () => {
    const row = seedUser({ active: false })
    h.db = { users: [row] } as never
    h.auth.mockResolvedValue({ userId: CLERK_ID })
    h.currentUser.mockResolvedValue(clerkUser('admin@vaultdemo.com'))

    expect(await getCurrentUser()).toBeNull()
    row.active = true
    expect((await getCurrentUser())?.email).toBe('admin@vaultdemo.com')
  })
})

describe('getCurrentUser — maps the existing row faithfully', () => {
  it('keeps an admin an admin (role comes from the database, not the token)', async () => {
    h.db = { users: [seedUser({ role: 'admin' })] } as never
    h.auth.mockResolvedValue({ userId: CLERK_ID })
    h.currentUser.mockResolvedValue(clerkUser('admin@vaultdemo.com'))

    const user = await getCurrentUser()
    expect(user).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      clerkId: CLERK_ID,
      email: 'admin@vaultdemo.com',
      name: 'Admin',
      role: 'admin',
      active: true,
    })
  })
})
