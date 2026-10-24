import 'server-only'
import { createAdminClient } from '@/lib/supabase-admin'
import type { AppUser } from '@/lib/users'

export type DocAction = 'read' | 'edit' | 'delete' | 'share'

export type AuthzResult =
  | { allowed: true; document: DocumentRow }
  | { allowed: false; reason: string }

export type DocumentRow = {
  id: string
  owner_id: string
  name: string
  category: string
  storage_key: string
  mime_type: string
  size_bytes: number
  sha256: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/**
 * The one function that decides access (decision D7).
 *
 * DEFAULT DENY: every path falls through to a denial unless a rule
 * explicitly allows it. If this file's checks were removed, no route
 * would grant access — the routes call this and nothing else.
 *
 * Rules:
 *  - owner passes all actions on their own document
 *  - an ACTIVE (revoked_at IS NULL) grant passes per its level
 *    (edit includes read)
 *  - admin has NO content access unless separately granted
 *    (decision D6) — being admin does not make you the owner
 *  - deleted documents: owner may still see metadata (soft delete,
 *    decision D9); everyone else is denied
 */
export async function authorize(
  user: AppUser | null,
  documentId: string,
  action: DocAction,
): Promise<AuthzResult> {
  if (!user) return { allowed: false, reason: 'no session' }

  const supabase = createAdminClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, owner_id, name, category, storage_key, mime_type, size_bytes, sha256, created_at, updated_at, deleted_at')
    .eq('id', documentId)
    .maybeSingle()

  if (!doc) return { allowed: false, reason: 'not found' }

  const isOwner = doc.owner_id === user.id

  // Soft-deleted: only the owner keeps a relationship with it.
  if (doc.deleted_at && !isOwner) {
    return { allowed: false, reason: 'not found' }
  }

  if (isOwner) {
    return { allowed: true, document: doc as DocumentRow }
  }

  // Explicit active grant only. Opening a link or guessing an id
  // creates no access.
  const { data: grant } = await supabase
    .from('document_permissions')
    .select('level')
    .eq('document_id', documentId)
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle()

  if (!grant) return { allowed: false, reason: 'no grant' }

  const level = grant.level as 'read' | 'edit'

  switch (action) {
    case 'read':
      return level === 'read' || level === 'edit'
        ? { allowed: true, document: doc as DocumentRow }
        : { allowed: false, reason: 'read requires read grant' }
    case 'edit':
      // edit includes read for viewing; rename needs 'edit'
      return level === 'edit'
        ? { allowed: true, document: doc as DocumentRow }
        : { allowed: false, reason: 'edit requires edit grant' }
    case 'delete':
    case 'share':
      // Only the owner (checked above) reaches here with isOwner.
      // Admins explicitly do NOT get these via role.
      return { allowed: false, reason: `${action} is owner only` }
  }
}
