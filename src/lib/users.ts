import 'server-only'
import { auth, currentUser } from '@clerk/nextjs/server'
import { createAdminClient } from '@/lib/supabase-admin'

export type AppUser = {
  id: string // users.id (uuid)
  clerkId: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  active: boolean
}

/**
 * Reads the Clerk session, finds or creates the users row, and
 * rejects if active = false. The new-user default is 'member' —
 * never admin (decision D5, M3).
 *
 * Returns null when there is no session.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const { userId } = await auth()
  if (!userId) return null

  const clerkUser = await currentUser()
  if (!clerkUser) return null

  const supabase = createAdminClient()
  const email = clerkUser.primaryEmailAddress?.emailAddress
    ?? clerkUser.emailAddresses[0]?.emailAddress
    ?? ''

  // find by clerk_id, insert if missing
  let { data: row } = await supabase
    .from('users')
    .select('id, clerk_id, email, name, role, active')
    .eq('clerk_id', userId)
    .maybeSingle()

  if (!row) {
    const { data: inserted, error } = await supabase
      .from('users')
      .insert({
        clerk_id: userId,
        email,
        name: clerkUser.fullName,
        role: 'member', // default must never be admin
      })
      .select('id, clerk_id, email, name, role, active')
      .single()
    if (error) throw new Error(`Failed to create user row: ${error.message}`)
    row = inserted
  }

  // Deactivation is checked on EVERY request, nothing cached (D11).
  if (!row.active) return null

  return {
    id: row.id,
    clerkId: row.clerk_id,
    email: row.email,
    name: row.name,
    role: row.role,
    active: row.active,
  }
}
