# TrustVault

Secure document management: per-document read/edit sharing, role-based admin,
and a tamper-evident audit log (append-only + hash chain).

Built with Next.js 16 (App Router), Clerk (auth), Supabase Postgres +
Storage (data), deployed on Vercel.

## Demo accounts

| Account | Role | What it shows |
|---|---|---|
| `admin@vaultdemo.com` | admin | user management, audit log, chain verify. **Cannot read file contents** unless explicitly granted (D6) |
| `ravi@vaultdemo.com` | member / owner | owns several documents, grants and revokes |
| `meena@vaultdemo.com` | member / viewer | owns one document, has `read` + `edit` grants from ravi — the pure viewer |

Password for all three (dev instance): `Vault-Test-2026!`

> These are **Clerk development-instance** credentials on a `*.vercel.app`
> domain. See THREATS.md → accepted risks.

## Setup from a clean clone

```bash
git clone <repo>
cd vault
npm install
cp .env.example .env.local   # then fill in the values (see below)
psql "$DATABASE_URL" -f db/schema.sql   # or paste db/schema.sql into the
                                        # Supabase SQL editor
npm run dev
```

First admin: sign in once, then promote by hand —
`UPDATE users SET role='admin' WHERE email='you@example.com';`
(new users are always `member`, never admin)

Seed demo data (optional):

```bash
node scripts/seed.mjs
```

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | anon/publishable key — RLS means it sees nothing |
| `SERVICE_ROLE` | **server only** | never prefixed `NEXT_PUBLIC_`; all data access goes through Next.js server code |
| `DATABASE_URL` | server only | direct Postgres connection, used by `psql` for schema + gates |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public | Clerk publishable key |
| `CLERK_SECRET_KEY` | server only | Clerk secret key |

`.env*` is gitignored.

## How access is decided

```
request -> proxy.ts (clerkMiddleware: session exists?)   <- NOT authorization
        -> route handler
        -> requireDocAccess(id, action) / requireAdmin()
             -> getCurrentUser()   (re-reads role + active from DB every request)
             -> authorize(user, documentId, action)   <- THE decision, default deny
             -> logAudit(outcome allowed|denied)
             -> deny = 404 (never 403), deny is logged
```

- **owner** passes all actions on their document
- an **active grant** (`revoked_at IS NULL`) passes per its level; `edit` includes `read`
- **admin** gets no content access from the role alone (D6)
- everything else is **denied** — if this line were removed, no route would
  grant access, because routes call `authorize()` and nothing else

## The audit log

- `audit_log` is append-only: row trigger blocks UPDATE/DELETE, statement
  trigger blocks TRUNCATE
- `append_audit()` (SQL, `SECURITY DEFINER`) takes `pg_advisory_xact_lock`,
  reads the previous hash, computes `sha256(prev | id | epoch time | actor |
  action | doc | outcome | details)`, inserts, returns the id — so concurrent
  requests cannot fork the chain
- `verify_audit_chain()` recomputes every row in id order and returns the
  first bad id (or null)
- no direct INSERT/UPDATE/DELETE for anyone, including `service_role`;
  `EXECUTE` on both functions is revoked from `public`/`anon`/`authenticated`
- RLS enabled on all four tables **with no policies**: the public anon key
  sees nothing

Proven by `db/gate.sql` (edit blocked, truncate blocked, tamper detected,
5 concurrent appends, chain clean) — output recorded in PROMPTS.md.

## API

All routes are server-side; 401 = no session, 404 = denied or missing.

| Endpoint | Who |
|---|---|
| `POST/GET /api/documents` | signed in (upload: owner; list: filtered by access) |
| `GET/PATCH/DELETE /api/documents/[id]` | read: owner/grant·read · patch: owner/grant·edit · delete: owner only |
| `GET /api/documents/[id]/download` | owner/grant·read, streamed through the server (no signed URLs) |
| `GET/POST /api/documents/[id]/permissions` | owner only |
| `DELETE /api/documents/[id]/permissions/[permId]` | owner only |
| `GET /api/admin/audit`, `GET /api/admin/audit/verify` | admin only |
| `GET/PATCH /api/admin/users` | admin only |
| `GET /api/me` | signed in |

## Deliberately not built

folders and groups (categories only), version history, external sharing /
signed URLs, per-user quota, rate limiting, automated tests (see THREATS.md
→ accepted risks — this is a known gap, not an oversight).
