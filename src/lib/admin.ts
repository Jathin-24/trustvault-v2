import 'server-only'
import { NextResponse } from 'next/server'
import { getCurrentUser, type AppUser } from '@/lib/users'
import { createAdminClient } from '@/lib/supabase-admin'
import type { SupabaseClient } from '@supabase/supabase-js'

export type AdminAccess =
  | { ok: true; admin: AppUser; supabase: SupabaseClient }
  | { ok: false; response: NextResponse }

/**
 * Admin gate for /api/admin/* routes.
 *
 * D6/D7: admin is a GLOBAL role for user management and audit only.
 * Being admin grants no document content access — that comes only
 * from ownership or an explicit grant, checked in authz.ts.
 *
 * Non-admins get 404 (D8: don't confirm the route exists).
 * The attempt is logged as denied (M7 gate).
 */
export async function requireAdmin(): Promise<AdminAccess> {
  const user = await getCurrentUser()

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  if (user.role !== 'admin') {
    // logged as a denied attempt with no document (actor + action only)
    const { logAudit } = await import('@/lib/audit')
    await logAudit({
      actorId: user.id,
      action: 'admin_access',
      documentId: null,
      outcome: 'denied',
      details: { route: 'admin' },
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'not found' }, { status: 404 }),
    }
  }

  return { ok: true, admin: user, supabase: createAdminClient() }
}
