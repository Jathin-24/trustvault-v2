import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin'

/**
 * GET /api/admin/audit — admin only.
 * Filters: actor, action, document, outcome, date range.
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin.ok) return admin.response

  const { searchParams } = new URL(req.url)
  const actor = searchParams.get('actor')
  const action = searchParams.get('action')
  const document = searchParams.get('document')
  const outcome = searchParams.get('outcome')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const supabase = admin.supabase

  let query = supabase
    .from('audit_log')
    .select('id, created_at, actor_id, action, document_id, outcome, ip, user_agent, details')

  if (actor) query = query.eq('actor_id', actor)
  if (action) query = query.eq('action', action)
  if (document) query = query.eq('document_id', document)
  if (outcome === 'allowed' || outcome === 'denied') query = query.eq('outcome', outcome)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error } = await query
    .order('id', { ascending: false })
    .limit(200)

  if (error) {
    return NextResponse.json({ error: 'query failed' }, { status: 500 })
  }

  return NextResponse.json({ entries: data ?? [] })
}
