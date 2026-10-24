/**
 * Signed-in test sessions for the integration suite — the vitest port of
 * scripts/mint-token.mjs + scripts/get-cookie.ps1 (the flow proven by hand
 * in M3-M7): mint a Clerk session token, do the dev-browser handshake for
 * the target origin, and send __client_uat 5s behind the token's iat
 * (Clerk rejects a uat newer than iat).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const CURL = process.platform === 'win32' ? 'curl.exe' : 'curl'
const NULL_DEV = process.platform === 'win32' ? 'NUL' : '/dev/null'

/** Read a var out of .env.local (same convention as scripts/*.mjs). */
export function readEnvLocal(name: string): string | null {
  try {
    const text = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    const m = text.match(new RegExp(`^${name}=(.*)$`, 'm'))
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const b64 = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  return JSON.parse(Buffer.from(b64 + '='.repeat((4 - pad) % 4), 'base64').toString('utf8'))
}

export type Session = { cookie: string; userId: string; sessionId: string; mintedAt: number }

/**
 * Clerk session tokens live ~60s. mintSession creates the session ONCE;
 * freshCookie() mints a new token from that same session whenever the
 * current one is older than 40s, so no request ever runs on an expired
 * token (this is what a browser's silent refresh does for you).
 */
export async function mintSession(email: string, secret: string): Promise<Session> {
  const auth = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }

  const find = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, { headers: auth })
  const list = await find.json()
  let user = Array.isArray(list) ? list[0] : null

  if (!user) {
    const r = await fetch('https://api.clerk.com/v1/users', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        email_address: [email],
        username: email.split('@')[0].replace(/[^a-z0-9_]/gi, '') + Math.floor(Math.random() * 900 + 100),
        password: 'Vault-Test-2026!',
        skip_password_checks: true,
        skip_password_verification: true,
      }),
    })
    if (!r.ok) throw new Error(`create user: ${r.status} ${await r.text()}`)
    user = await r.json()
  }

  const sr = await fetch('https://api.clerk.com/v1/sessions', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ user_id: user.id, name: `vitest-${Date.now()}` }),
  })
  if (!sr.ok) throw new Error(`create session: ${sr.status} ${await sr.text()}`)
  const session = await sr.json()

  const jwt = await mintToken(session.id, auth)
  return {
    cookie: cookieFrom(jwt),
    userId: user.id,
    sessionId: session.id,
    mintedAt: Number(decodeJwtPayload(jwt).iat) * 1000,
  }
}

async function mintToken(sessionId: string, auth: Record<string, string>): Promise<string> {
  const tr = await fetch(`https://api.clerk.com/v1/sessions/${sessionId}/tokens`, { method: 'POST', headers: auth })
  if (!tr.ok) throw new Error(`token: ${tr.status} ${await tr.text()}`)
  const { jwt } = await tr.json()
  return jwt
}

function cookieFrom(jwt: string): string {
  const iat = Number(decodeJwtPayload(jwt).iat)
  return `__session=${jwt}; __client_uat=${iat - 5}`
}

/** Fresh cookie for this session (re-mints when older than 40s) + dev-browser. */
export async function freshCookie(s: Session, secret: string, db: string | null): Promise<string> {
  if (Date.now() - s.mintedAt > 40_000) {
    const auth = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }
    const jwt = await mintToken(s.sessionId, auth)
    s.cookie = cookieFrom(jwt)
    s.mintedAt = Number(decodeJwtPayload(jwt).iat) * 1000
  }
  return db ? `${s.cookie}; __clerk_db_jwt=${db}` : s.cookie
}

/**
 * One handshake per target origin: clerkMiddleware's dev-browser redirect
 * flow sets __clerk_db_jwt for that domain (proven with curl -L -c/-b in
 * the manual gates). Returns the value, or null if none was set.
 */
export function devBrowserHandshake(base: string): string | null {
  const jar = path.join(mkdtempSync(path.join(tmpdir(), 'vitest-clerk-')), 'jar.txt')
  try {
    execFileSync(CURL, ['-s', '-L', '-c', jar, '-b', jar, '-H', 'Accept: text/html', '-o', NULL_DEV, `${base}/api/me`], {
      timeout: 30000,
      stdio: 'pipe',
    })
  } catch {
    return null
  }
  const lines = readFileSync(jar, 'utf8').split(/\r?\n/).filter((l) => l.includes('__clerk_db_jwt'))
  if (lines.length === 0) return null
  const fields = lines[lines.length - 1].split('\t')
  return fields[fields.length - 1] || null
}
