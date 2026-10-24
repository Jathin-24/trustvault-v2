import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireDocAccess } from '@/lib/require-doc-access'
import { createAdminClient } from '@/lib/supabase-admin'
import { logAudit } from '@/lib/audit'

/** GET /api/documents/[id] — owner, or a user with read or edit. */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]'>,
) {
  const { id } = await ctx.params
  const access = await requireDocAccess(id, 'read')
  if (!access.ok) return access.response

  const d = access.document
  return NextResponse.json({
    id: d.id,
    owner_id: d.owner_id,
    name: d.name,
    category: d.category,
    mime_type: d.mime_type,
    size_bytes: d.size_bytes,
    sha256: d.sha256,
    created_at: d.created_at,
    updated_at: d.updated_at,
    deleted_at: d.deleted_at,
  })
}

/**
 * PATCH /api/documents/[id] — rename / recategorise.
 * Requires 'edit'. Only allow-listed fields can change; owner_id and
 * storage_key are never writable from here.
 */
export async function PATCH(
  req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]'>,
) {
  const { id } = await ctx.params
  const access = await requireDocAccess(id, 'edit')
  if (!access.ok) return access.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  const changed: Record<string, unknown> = {}

  if (typeof body.name === 'string') {
    const name = body.name.trim()
    if (name.length < 1 || name.length > 255) {
      return NextResponse.json({ error: 'invalid name' }, { status: 400 })
    }
    patch.name = name
    changed.name = name
  }
  if (typeof body.category === 'string') {
    const category = body.category.trim().slice(0, 100) || 'general'
    patch.category = category
    changed.category = category
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  patch.updated_at = new Date().toISOString()

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('documents')
    .update(patch)
    .eq('id', id)
    .select('id, name, category, updated_at')
    .single()

  if (error) {
    return NextResponse.json({ error: 'update failed' }, { status: 500 })
  }

  const hdrs = await headers()
  await logAudit({
    actorId: access.user.id,
    action: 'update',
    documentId: id,
    outcome: 'allowed',
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent'),
    details: changed,
  })

  return NextResponse.json(data)
}

/**
 * DELETE /api/documents/[id] — owner only, soft delete (D9).
 * The file stays in storage and the record is hidden.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]'>,
) {
  const { id } = await ctx.params
  const access = await requireDocAccess(id, 'delete')
  if (!access.ok) return access.response

  // requireDocAccess allowed only the owner for 'delete' (authz.ts
  // denies everyone else, admin included).
  const supabase = createAdminClient()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('documents')
    .update({ deleted_at: now, updated_at: now })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const hdrs = await headers()
  await logAudit({
    actorId: access.user.id,
    action: 'delete',
    documentId: id,
    outcome: 'allowed',
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent'),
    details: { name: access.document.name },
  })

  return NextResponse.json({ ok: true })
}
