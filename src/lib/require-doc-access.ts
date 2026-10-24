import 'server-only'
import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { authorize, type DocAction, type DocumentRow } from '@/lib/authz'
import { logAudit } from '@/lib/audit'
import { getCurrentUser, type AppUser } from '@/lib/users'

export type Access =
  | { ok: true; user: AppUser; document: DocumentRow }
  | { ok: false; response: NextResponse }

/**
 * The wrapper every document route uses: auth → check → log → 404.
 *
 * Denied requests are logged with outcome 'denied' and answered with
 * 404, not 403 — a 403 would confirm the document exists (D8).
 */
export async function requireDocAccess(
  documentId: string,
  action: DocAction,
): Promise<Access> {
  const user = await getCurrentUser()
  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent')

  if (!user) {
    // Signed out: 401, no audit row needed (there's no actor and the
    // route is rejected before any document lookup).
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    }
  }

  const result = await authorize(user, documentId, action)

  if (!result.allowed) {
    await logAudit({
      actorId: user.id,
      action,
      documentId,
      outcome: 'denied',
      ip,
      userAgent,
      details: { reason: result.reason },
    })
    return {
      ok: false,
      response: NextResponse.json({ error: 'not found' }, { status: 404 }),
    }
  }

  return { ok: true, user, document: result.document }
}
