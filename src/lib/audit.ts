import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'

export type AuditInput = {
  actorId?: string | null
  action: 'upload' | 'download' | 'update' | 'delete' | 'grant' | 'revoke'
       | 'role_change' | 'deactivate' | 'login' | string
  documentId?: string | null
  outcome: 'allowed' | 'denied'
  ip?: string | null
  userAgent?: string | null
  details?: Record<string, unknown> | null
}

/**
 * Writes one audit row through the append_audit SQL function, so the
 * hash chain and the advisory lock live in the database (two
 * simultaneous requests can't fork the chain).
 *
 * Denied attempts are logged too — that's the point (requirement 6).
 */
export async function logAudit(input: AuditInput): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc('append_audit', {
    p_actor: input.actorId ?? null,
    p_action: input.action,
    p_document: input.documentId ?? null,
    p_outcome: input.outcome,
    p_ip: input.ip ?? null,
    p_user_agent: input.userAgent ?? null,
    p_details: input.details ?? null,
  })
  if (error) {
    // An audit write failure must be visible — never swallow it.
    console.error('audit write failed:', error.message)
  }
}
