import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireAdmin } from '@/lib/admin'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/admin/users — admin only, list users with doc counts.
 * PATCH /api/admin/users — change role or active flag.
 */
export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response

  const { data, error } = await admin.supabase
    .from('users')
    .select('id, email, name, role, active, created_at')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: 'query failed' }, { status: 500 })
  return NextResponse.json({ users: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body.user_id !== 'string') {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  const changed: Record<string, unknown> = {}

  if (body.role !== undefined) {
    if (body.role !== 'admin' && body.role !== 'member') {
      return NextResponse.json({ error: 'invalid role' }, { status: 400 })
    }
    patch.role = body.role
    changed.role = body.role
  }
  if (body.active !== undefined) {
    if (typeof body.active !== 'boolean') {
      return NextResponse.json({ error: 'active must be boolean' }, { status: 400 })
    }
    patch.active = body.active
    changed.active = body.active
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  // Don't allow locking yourself out: no self-demotion / self-deactivation.
  if (body.user_id === admin.admin.id && patch.active === false) {
    return NextResponse.json({ error: 'cannot deactivate yourself' }, { status: 400 })
  }
  if (body.user_id === admin.admin.id && patch.role === 'member') {
    return NextResponse.json({ error: 'cannot demote yourself' }, { status: 400 })
  }

  const { data, error } = await admin.supabase
    .from('users')
    .update(patch)
    .eq('id', body.user_id)
    .select('id, email, role, active')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }

  const hdrs = await headers()
  await logAudit({
    actorId: admin.admin.id,
    action: changed.role !== undefined ? 'role_change' : 'deactivate',
    documentId: null,
    outcome: 'allowed',
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent'),
    details: { target_user: data.id, ...changed },
  })

  return NextResponse.json(data)
}
