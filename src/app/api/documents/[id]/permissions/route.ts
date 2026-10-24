import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireDocAccess } from '@/lib/require-doc-access'
import { createAdminClient } from '@/lib/supabase-admin'
import { logAudit } from '@/lib/audit'
import { getCurrentUser } from '@/lib/users'

/**
 * GET /api/documents/[id]/permissions — owner only (list grants).
 * POST  — owner only (grant by email or user id, level read|edit).
 */
async function getOwner(ctx: RouteContext<'/api/documents/[id]/permissions'>) {
  const { id } = await ctx.params
  const access = await requireDocAccess(id, 'share')
  return { id, access }
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]/permissions'>,
) {
  const { id, access } = await getOwner(ctx)
  if (!access.ok) return access.response

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('document_permissions')
    .select('id, user_id, level, granted_by, granted_at, revoked_at, users!document_permissions_user_id_fkey(email, name)')
    .eq('document_id', id)
    .order('granted_at', { ascending: false })

  return NextResponse.json({ permissions: data ?? [] })
}

export async function POST(
  req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]/permissions'>,
) {
  const { id, access } = await getOwner(ctx)
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const level = body.level
  if (level !== 'read' && level !== 'edit') {
    return NextResponse.json({ error: 'level must be read or edit' }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Resolve the target user by email or id.
  let targetId = typeof body.user_id === 'string' ? body.user_id : null
  if (!targetId && typeof body.email === 'string') {
    const { data: u } = await supabase
      .from('users')
      .select('id, active')
      .ilike('email', body.email.trim())
      .maybeSingle()
    targetId = u?.id ?? null
    if (u && !u.active) {
      return NextResponse.json({ error: 'user is inactive' }, { status: 400 })
    }
  }
  if (!targetId) {
    return NextResponse.json({ error: 'user not found' }, { status: 404 })
  }

  // No self-grants: you already own it.
  if (targetId === access.user.id) {
    return NextResponse.json({ error: 'cannot grant to yourself' }, { status: 400 })
  }

  const { data: target } = await supabase
    .from('users')
    .select('id, active')
    .eq('id', targetId)
    .maybeSingle()
  if (!target || !target.active) {
    return NextResponse.json({ error: 'user not found or inactive' }, { status: 404 })
  }

  // Duplicate active grant: the partial unique index would reject it
  // anyway — answer clearly instead of a 500.
  const { data: existing } = await supabase
    .from('document_permissions')
    .select('id, level, revoked_at')
    .eq('document_id', id)
    .eq('user_id', targetId)
    .is('revoked_at', null)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'user already has an active grant' },
      { status: 409 },
    )
  }

  const { data: perm, error } = await supabase
    .from('document_permissions')
    .insert({
      document_id: id,
      user_id: targetId,
      level,
      granted_by: access.user.id,
    })
    .select('id, document_id, user_id, level, granted_at')
    .single()

  if (error) {
    return NextResponse.json({ error: 'grant failed' }, { status: 500 })
  }

  const hdrs = await headers()
  await logAudit({
    actorId: access.user.id,
    action: 'grant',
    documentId: id,
    outcome: 'allowed',
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent'),
    details: { target_user: targetId, level },
  })

  return NextResponse.json(perm, { status: 201 })
}
