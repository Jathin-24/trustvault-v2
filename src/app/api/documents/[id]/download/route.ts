import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { requireDocAccess } from '@/lib/require-doc-access'
import { createAdminClient } from '@/lib/supabase-admin'
import { logAudit } from '@/lib/audit'

/**
 * GET /api/documents/[id]/download — streams through the server.
 * No signed URLs are ever handed out (D3): a revoked user's very
 * next request fails at requireDocAccess, even if they still have a
 * browser tab open.
 */
export async function GET(
  _req: NextRequest,
  ctx: RouteContext<'/api/documents/[id]/download'>,
) {
  const { id } = await ctx.params
  const access = await requireDocAccess(id, 'read')
  if (!access.ok) return access.response

  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent')

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from('documents')
    .download(access.document.storage_key)

  if (error || !data) {
    return NextResponse.json({ error: 'file missing' }, { status: 404 })
  }

  await logAudit({
    actorId: access.user.id,
    action: 'download',
    documentId: id,
    outcome: 'allowed',
    ip,
    userAgent,
    details: { name: access.document.name },
  })

  return new NextResponse(data.stream(), {
    status: 200,
    headers: {
      'Content-Type': access.document.mime_type,
      'Content-Disposition': `attachment; filename="${access.document.name.replace(/"/g, '')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  })
}
