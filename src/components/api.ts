// Shared client-side helpers for talking to the TrustVault API.
//
// The API uses:
//   401 -> signed out (redirect to /sign-in)
//   404 -> not found OR access denied (never 403)
//   other errors -> { error: "<message>" }

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024 // 4 MB (server re-validates)

export const CATEGORIES = [
  'general',
  'contracts',
  'finance',
  'hr',
  'legal',
  'identity',
  'other',
] as const

export type Me = {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
}

export type DocSummary = {
  id: string
  owner_id: string
  name: string
  category: string
  mime_type: string
  size_bytes: number
  created_at: string
  updated_at: string
  deleted_at: string | null
  users: { email: string; name: string | null } | null
}

export type DocDetail = {
  id: string
  owner_id: string
  name: string
  category: string
  mime_type: string
  size_bytes: number
  sha256: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type Grant = {
  id: string
  user_id: string
  level: 'read' | 'edit'
  granted_by: string | null
  granted_at: string
  revoked_at: string | null
  users: { email: string; name: string | null } | null
}

export type AuditEntry = {
  id: number
  created_at: string
  actor_id: string | null
  action: string
  document_id: string | null
  outcome: string
  ip: string | null
  user_agent: string | null
  details: unknown
}

export type AdminUser = {
  id: string
  email: string
  name: string | null
  role: 'admin' | 'member'
  active: boolean
  created_at: string
}

export function goToSignIn(): void {
  // Full page load is intentional: on 401 we want a clean state for the
  // Clerk sign-in page. useRouter() isn't available in this plain helper.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  if (typeof window !== 'undefined') window.location.assign('/sign-in')
}

/**
 * fetch() wrapper that handles the shared 401 policy: the user is signed
 * out (or the session is unusable), so send them to /sign-in.
 * Every other response is returned untouched — callers use readError().
 */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) goToSignIn()
  return res
}

/** Pull the human-readable message out of an error response body. */
export async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {
    // non-JSON body (e.g. an HTML error page) — fall through
  }
  return `${fallback} (HTTP ${res.status})`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function shortId(id: string | null | undefined, len = 8): string {
  if (!id) return '—'
  return id.length > len ? `${id.slice(0, len)}…` : id
}

export function jsonHeaders(): HeadersInit {
  return { 'Content-Type': 'application/json' }
}
