import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Server-only Supabase client using the service-role key.
// The browser never sees this key: all data access goes through
// Next.js server code (decision D1).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SERVICE_ROLE
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SERVICE_ROLE')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
