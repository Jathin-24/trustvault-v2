import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'

/**
 * GET /api/admin/audit/verify — admin only.
 * Runs verify_audit_chain() and reports the first broken row, if any.
 */
export async function GET() {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response

  const { data, error } = await admin.supabase.rpc('verify_audit_chain')

  if (error) {
    return NextResponse.json({ error: 'verify failed' }, { status: 500 })
  }

  return NextResponse.json({
    valid: data === null,
    first_bad_id: data,
  })
}
