import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireDocAccess } from '@/lib/require-doc-access'
import { createAdminClient } from '@/lib/supabase-admin'
import { logAudit } from '@/lib/audit'

/**
 * DELETE /api/documents/[id]/permissions/[permId] — owner only.
 * Revoke sets revoked_at; the row stays so the history survives.
 * Changing a level = revoke old row + insert a new one.
 */
export async function DELETE(
  _req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]/permissions/[permId]'>,
) {
  const { id, permId } = await ctx.params
  const access = await requireDocAccess(id, 'share')
  if (!access.ok) return access.response

  const supabase = createAdminClient()

  const { data: perm } = await supabase
    .from('document_permissions')
    .select('id, user_id, level, revoked_at')
    .eq('id', permId)
    .eq('document_id', id)
    .maybeSingle()

  if (!perm) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (perm.revoked_at) {
    return NextResponse.json({ error: 'already revoked' }, { status: 409 })
  }

  const { error } = await supabase
    .from('document_permissions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', permId)
    .is('revoked_at', null)

  if (error) {
    return NextResponse.json({ error: 'revoke failed' }, { status: 500 })
  }

  const hdrs = await headers()
  await logAudit({
    actorId: access.user.id,
    action: 'revoke',
    documentId: id,
    outcome: 'allowed',
    ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: hdrs.get('user-agent'),
    details: { target_user: perm.user_id, level: perm.level },
  })

  return NextResponse.json({ ok: true })
}
