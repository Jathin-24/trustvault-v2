/* eslint-disable @typescript-eslint/no-explicit-any --
 * The integration suite parses arbitrary API JSON bodies; this is test
 * glue, not app code. App code itself stays any-free (lint is 0/0). */
/**
 * M3-M7 gate matrix, run against a REAL running app (dev server + real
 * Clerk + real Supabase) — the same matrix proven by hand with curl in
 * PROMPTS.md, now executable.
 *
 * Skips itself (with an explanation) when:
 *   - no dev server is reachable at VAULT_BASE_URL (default http://localhost:3001)
 *   - .env.local is missing CLERK_SECRET_KEY
 *   - the dev-browser handshake fails
 * Admin-role-dependent tests skip individually until admin@vaultdemo.com
 * has been promoted by hand (promotion is deliberately manual — D5).
 *
 * Point it elsewhere with VAULT_BASE_URL=https://vault-rangammas-projects.vercel.app
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { devBrowserHandshake, freshCookie, mintSession, readEnvLocal, type Session } from '../helpers/clerk'

// Vite reserves process.env.BASE_URL (its config base = "/"), so the
// override variable is deliberately named VAULT_BASE_URL. Anything that
// is not an absolute http(s) URL falls back to the local dev server.
const candidate = (process.env.VAULT_BASE_URL ?? '').trim()
const BASE = /^https?:\/\//i.test(candidate) ? candidate.replace(/\/+$/, '') : 'http://localhost:3001'
const FAKE_ID = '00000000-0000-4000-8000-000000000000'

// ---------- availability probe (top level, decides skip vs run) ----------

async function probe(): Promise<string | null> {
  try {
    // generous: a cold dev server compiles on the first request
    const r = await fetch(`${BASE}/api/me`, { signal: AbortSignal.timeout(45000) })
    return r.status === 200 || r.status === 401 ? null : `unexpected status ${r.status}`
  } catch (e) {
    return `unreachable (${e instanceof Error ? e.message : String(e)})`
  }
}

const secret = readEnvLocal('CLERK_SECRET_KEY')
const skipReason = secret ? await probe() : 'CLERK_SECRET_KEY not found in .env.local'
let dbCookie: string | null = null
if (!skipReason) {
  dbCookie = devBrowserHandshake(BASE)
  if (!dbCookie) {
    console.warn(
      `[integration] warning: no __clerk_db_jwt from handshake on ${BASE} — ` +
        'signed-in requests may be rejected by the Clerk dev instance',
    )
  }
}
if (skipReason) {
  console.warn(
    `\n[integration] SKIPPED: ${BASE} → ${skipReason}\n` +
      '  start the app first:  npm run dev -- -p 3001\n' +
      '  (needs .env.local with Clerk + Supabase keys — see README)\n',
  )
}

// ---------- tiny client ----------

type Reply = { status: number; body: any }

async function call(
  method: string,
  path: string,
  cookie?: string,
  body?: { json?: unknown; raw?: string },
): Promise<Reply> {
  const headers: Record<string, string> = {}
  if (cookie) headers.Cookie = cookie
  if (body?.json !== undefined) headers['Content-Type'] = 'application/json'
  const r = await fetch(BASE + path, {
    method,
    headers,
    body: body?.json !== undefined ? JSON.stringify(body.json) : body?.raw,
    signal: AbortSignal.timeout(30000),
  })
  let parsed: unknown = null
  try {
    parsed = await r.json()
  } catch {
    /* binary or empty */
  }
  return { status: r.status, body: parsed }
}

async function upload(cookie: string, name: string, content: Uint8Array, extra?: { owner_id?: string }) {
  const form = new FormData()
  form.append('file', new File([content as BlobPart], name, { type: 'application/pdf' }))
  if (extra?.owner_id) form.append('owner_id', extra.owner_id)
  const r = await fetch(`${BASE}/api/documents`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
    signal: AbortSignal.timeout(30000),
  })
  let parsed: unknown = null
  try {
    parsed = await r.json()
  } catch {
    /* non-json error body */
  }
  return { status: r.status, body: parsed as any }
}

async function download(cookie: string, id: string) {
  const r = await fetch(`${BASE}/api/documents/${id}/download`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(30000),
  })
  const buf = r.status === 200 ? await r.arrayBuffer() : null
  return { status: r.status, bytes: buf?.byteLength ?? 0 }
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.4\nvitest fixture\n')
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
const BIG_BYTES = new Uint8Array(5 * 1024 * 1024)

// ---------- the suite ----------

describe.skipIf(skipReason !== null)(`gate matrix against ${BASE}`, () => {
  let ravi: Session
  let meena: Session
  let admin: Session
  let raviId: string
  let meenaId: string
  let adminIsAdmin = false
  const createdDocs: string[] = []
  const cookieFor = (s: Session) => freshCookie(s, secret as string, dbCookie)

  beforeAll(async () => {
    ravi = await mintSession('ravi@vaultdemo.com', secret as string)
    meena = await mintSession('meena@vaultdemo.com', secret as string)
    admin = await mintSession('admin@vaultdemo.com', secret as string)

    raviId = (await call('GET', '/api/me', await cookieFor(ravi))).body.id
    meenaId = (await call('GET', '/api/me', await cookieFor(meena))).body.id
    const adminMe = await call('GET', '/api/me', await cookieFor(admin))
    adminIsAdmin = adminMe.body.role === 'admin'
    if (!adminIsAdmin) {
      console.warn(
        '[integration] admin@vaultdemo.com is not an admin — admin tests will skip.\n' +
          "  promote by hand: UPDATE users SET role='admin' WHERE email='admin@vaultdemo.com';",
      )
    }
  })

  afterAll(async () => {
    for (const id of createdDocs) {
      await call('DELETE', `/api/documents/${id}`, await cookieFor(ravi)).catch(() => {})
    }
  })

  describe('signed out — 401 everywhere, no document probe happens (M3/M5)', () => {
    const routes: Array<[string, string, { json?: unknown } | undefined]> = [
      ['GET', '/api/me', undefined],
      ['GET', '/api/documents', undefined],
      ['GET', `/api/documents/${FAKE_ID}`, undefined],
      ['PATCH', `/api/documents/${FAKE_ID}`, { json: { name: 'x' } }],
      ['DELETE', `/api/documents/${FAKE_ID}`, undefined],
      ['GET', `/api/documents/${FAKE_ID}/download`, undefined],
      ['GET', '/api/admin/audit', undefined],
      ['GET', '/api/admin/audit/verify', undefined],
      ['GET', '/api/admin/users', undefined],
    ]

    it('every protected route answers 401 {"error":"unauthorized"}', async () => {
      for (const [method, path, body] of routes) {
        const r = await call(method, path, undefined, body)
        expect(r.status, `${method} ${path}`).toBe(401)
        expect(r.body?.error, `${method} ${path}`).toBe('unauthorized')
      }
    })

    it('an anonymous multipart upload is refused before anything is stored', async () => {
      const form = new FormData()
      form.append('file', new File([PDF_BYTES as BlobPart], 'anon.pdf', { type: 'application/pdf' }))
      const r = await fetch(`${BASE}/api/documents`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(30000),
      })
      expect(r.status).toBe(401) // 201 here would mean an unauthenticated store
    })
  })

  describe('upload security (M5)', () => {
    it('stores the document under the session user — spoofed owner_id is ignored', async () => {
      const up = await upload(await cookieFor(ravi), 'vitest-spoof.pdf', PDF_BYTES, { owner_id: meenaId })
      expect(up.status).toBe(201)
      createdDocs.push(up.body.id)

      const list = await call('GET', '/api/documents?name=vitest-spoof', await cookieFor(ravi))
      expect(list.status).toBe(200)
      const row = list.body.documents.find((d: { id: string }) => d.id === up.body.id)
      expect(row.owner_id).toBe(raviId)
      expect(row.owner_id).not.toBe(meenaId)
    })

    it('rejects an exe renamed to .pdf → 400', async () => {
      const up = await upload(await cookieFor(ravi), 'invoice.pdf', EXE_BYTES)
      expect(up.status).toBe(400)
      expect(up.body.error).toBe('unrecognized file content')
    })

    it('rejects a file over 4 MB → 413', async () => {
      const up = await upload(await cookieFor(ravi), 'huge.pdf', BIG_BYTES)
      expect(up.status).toBe(413)
      expect(up.body.error).toBe('file exceeds 4 MB')
    })

    it('rejects a disallowed extension → 400', async () => {
      const form = new FormData()
      form.append('file', new File([EXE_BYTES as BlobPart], 'run.exe', { type: 'application/octet-stream' }))
      const r = await fetch(`${BASE}/api/documents`, {
        method: 'POST',
        headers: { Cookie: await cookieFor(ravi) },
        body: form,
        signal: AbortSignal.timeout(30000),
      })
      expect(r.status).toBe(400)
      expect((await r.json()).error).toBe('file type not allowed')
    })
  })

  describe('per-document access — default deny (M4/M6)', () => {
    let privateDoc = ''

    beforeAll(async () => {
      const up = await upload(await cookieFor(ravi), 'vitest-private.pdf', PDF_BYTES)
      expect(up.status).toBe(201)
      privateDoc = up.body.id
      createdDocs.push(privateDoc)
    })

    it('the owner can read and download their own document', async () => {
      const meta = await call('GET', `/api/documents/${privateDoc}`, await cookieFor(ravi))
      expect(meta.status).toBe(200)
      expect(meta.body.name).toBe('vitest-private.pdf')

      const dl = await download(await cookieFor(ravi), privateDoc)
      expect(dl.status).toBe(200)
      expect(dl.bytes).toBeGreaterThan(0)
    })

    it('a stranger without a grant gets 404 on read/patch/delete/download — never 403', async () => {
      const stranger = await cookieFor(meena)
      const got = await call('GET', `/api/documents/${privateDoc}`, stranger)
      const patch = await call('PATCH', `/api/documents/${privateDoc}`, stranger, { json: { name: 'stolen.pdf' } })
      const del = await call('DELETE', `/api/documents/${privateDoc}`, stranger)
      const dl = await download(stranger, privateDoc)

      for (const [label, r] of [
        ['GET', got],
        ['PATCH', patch],
        ['DELETE', del],
        ['download', dl],
      ] as const) {
        expect(r.status, label).toBe(404)
        expect(r.status, label).not.toBe(403)
      }
      // the document is untouched
      const meta = await call('GET', `/api/documents/${privateDoc}`, await cookieFor(ravi))
      expect(meta.body.name).toBe('vitest-private.pdf')
    })

    it('a guessed id answers 404 — existence is not confirmed', async () => {
      const r = await call('GET', `/api/documents/${FAKE_ID}`, await cookieFor(ravi))
      expect(r.status).toBe(404)
      expect(r.body.error).toBe('not found')
    })

    it('the list is access-filtered: ravi sees it, meena does not', async () => {
      const mine = await call('GET', '/api/documents?name=vitest-private', await cookieFor(ravi))
      expect(mine.body.documents.map((d: { id: string }) => d.id)).toContain(privateDoc)

      const theirs = await call('GET', '/api/documents?name=vitest-private', await cookieFor(meena))
      expect(theirs.status).toBe(200)
      expect(theirs.body.documents.map((d: { id: string }) => d.id)).not.toContain(privateDoc)
    })

    it('grant → download works → revoke → the very next request is 404 (rule 3)', async () => {
      const grant = await call('POST', `/api/documents/${privateDoc}/permissions`, await cookieFor(ravi), {
        json: { email: 'meena@vaultdemo.com', level: 'read' },
      })
      expect(grant.status).toBe(201)

      const whileGranted = await download(await cookieFor(meena), privateDoc)
      expect(whileGranted.status).toBe(200)

      const revoke = await call('DELETE', `/api/documents/${privateDoc}/permissions/${grant.body.id}`, await cookieFor(ravi))
      expect(revoke.status).toBe(200)

      const afterRevoke = await download(await cookieFor(meena), privateDoc)
      expect(afterRevoke.status).toBe(404)
    })

    it('a read grant does not allow renaming', async () => {
      const grant = await call('POST', `/api/documents/${privateDoc}/permissions`, await cookieFor(ravi), {
        json: { email: 'meena@vaultdemo.com', level: 'read' },
      })
      expect(grant.status).toBe(201)
      try {
        const patch = await call('PATCH', `/api/documents/${privateDoc}`, await cookieFor(meena), {
          json: { name: 'mine-now.pdf' },
        })
        expect(patch.status).toBe(404)
      } finally {
        await call('DELETE', `/api/documents/${privateDoc}/permissions/${grant.body.id}`, await cookieFor(ravi))
      }
    })
  })

  describe('hostile input (M9)', () => {
    it('malformed JSON body → 400, not a crash', async () => {
      const up = await upload(await cookieFor(ravi), 'vitest-json.pdf', PDF_BYTES)
      expect(up.status).toBe(201)
      createdDocs.push(up.body.id)
      const r = await call('PATCH', `/api/documents/${up.body.id}`, await cookieFor(ravi), { raw: '{"name":' })
      expect(r.status).toBe(400)
    })

    it("sql-ish search term → 400 'invalid filter', not 500", async () => {
      const term = encodeURIComponent("' OR 1=1--")
      const r = await call('GET', `/api/documents?name=${term}`, await cookieFor(ravi))
      expect(r.status).toBe(400)
      expect(r.body.error).toBe('invalid filter')
    })

    it('xss-ish search term is handled with 200 and a normal payload', async () => {
      const term = encodeURIComponent('"><img src=x onerror=alert(1)>')
      const r = await call('GET', `/api/documents?name=${term}`, await cookieFor(ravi))
      expect(r.status).toBe(200)
      expect(Array.isArray(r.body.documents)).toBe(true)
    })
  })

  describe('admin (M7)', () => {
    it('a member gets 404 on every admin route (+ denied audit row)', async () => {
      for (const path of ['/api/admin/audit', '/api/admin/audit/verify', '/api/admin/users']) {
        const r = await call('GET', path, await cookieFor(ravi))
        expect(r.status, path).toBe(404)
      }
    })

    it('the admin gets 200 and the hash chain verifies {valid: true}', async ({ skip }) => {
      if (!adminIsAdmin) return skip()
      const audit = await call('GET', '/api/admin/audit', await cookieFor(admin))
      expect(audit.status).toBe(200)
      expect(Array.isArray(audit.body.entries)).toBe(true)

      const verify = await call('GET', '/api/admin/audit/verify', await cookieFor(admin))
      expect(verify.status).toBe(200)
      expect(verify.body).toEqual({ valid: true, first_bad_id: null })
    })

    it('deactivation kills a valid session on the very next request (D11)', async ({ skip }) => {
      if (!adminIsAdmin) return skip()

      const off = await call('PATCH', '/api/admin/users', await cookieFor(admin), {
        json: { user_id: meenaId, active: false },
      })
      expect(off.status).toBe(200)
      try {
        const victim = await call('GET', '/api/me', await cookieFor(meena))
        expect(victim.status).toBe(401)
      } finally {
        await call('PATCH', '/api/admin/users', await cookieFor(admin), { json: { user_id: meenaId, active: true } })
      }
      const restored = await call('GET', '/api/me', await cookieFor(meena))
      expect(restored.status).toBe(200)
    })
  })
})
