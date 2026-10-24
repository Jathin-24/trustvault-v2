# API.md

All endpoints are Next.js route handlers under `/api`. Authentication is the
Clerk session cookie (`clerkMiddleware` in `src/proxy.ts` only checks a
session exists — **that is not authorization**; every real decision is made in
`src/lib/authz.ts`).

Status codes:

- `401` — no session (or deactivated user)
- `404` — denied **or** missing (never 403: a 403 would confirm the document exists)
- `400` — bad input
- `409` — conflicting state (e.g. duplicate active grant)
- `413` — file over 4 MB

Every document-related denial is written to `audit_log` with
`outcome='denied'` and a reason in `details`.

---

## Sessions

### GET /api/me
Signed in → `200 {id, email, name, role}` · otherwise `401`.
Also rejects when `users.active = false` (re-checked on every request).

---

## Documents

### POST /api/documents — upload
`multipart/form-data`: `file` (required), `category` (optional).

- 4 MB cap checked twice (pre-read → `413`, and `size_bytes` CHECK in SQL)
- extension allowlist + **magic bytes** sniffing; extension must match real content
- filename sanitized (path segments and control chars stripped)
- `storage_key` = random UUID — the user's filename never touches storage
- `sha256` computed server-side; `owner_id` from the session, **never from the body**
- audit: `upload / allowed`

`201 {id, name, category, mime_type, size_bytes, created_at}`

### GET /api/documents — list + search
Query: `name`, `owner` (`me` | `other` | uuid), `category`, `from`, `to`.

Access filter is **inside the SQL query**: `owner_id = me OR id IN (my active
grant ids)`, and `deleted_at IS NULL`. Filter values are sanitised (quotes,
wildcards stripped; owner must be a uuid; dates must be ISO) → `400` on junk.

`200 {documents: [{id, owner_id, name, category, mime_type, size_bytes,
created_at, updated_at, deleted_at, users: {email, name}}]}`

### GET /api/documents/[id]
`read` access → `200` metadata incl. `sha256`. Denied → `404` + audit.

### GET /api/documents/[id]/download
`read` access → file bytes, streamed through the server:
`Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`,
`Cache-Control: no-store`. **No signed URLs ever** — a revoked user's next
request fails at the auth check even if they still hold a URL.
Audit: `download / allowed` (denials logged by the wrapper).

### PATCH /api/documents/[id]
`edit` access. Body: `{name?, category?}` only — allow-listed; `owner_id` and
`storage_key` are not writable here. Audit: `update / allowed` with the
changed fields.

### DELETE /api/documents/[id]
**Owner only.** Soft delete (`deleted_at = now()`); file stays in storage.
Audit: `delete / allowed`.

---

## Permissions (all owner-only — enforced by `authorize(..., 'share')`)

### GET /api/documents/[id]/permissions
`200 {permissions: [{id, user_id, level, granted_by, granted_at, revoked_at,
users: {email, name}}]}` — includes revoked rows, so history is visible.

### POST /api/documents/[id]/permissions
`{email? | user_id?, level: "read" | "edit"}` → `201`.

- self-grant → `400`
- inactive or unknown user → `404`
- duplicate active grant → `409` (backed by the partial unique index
  `WHERE revoked_at IS NULL`)
- Audit: `grant / allowed` with target + level.

### DELETE /api/documents/[id]/permissions/[permId]
Sets `revoked_at` — the row is never deleted. Already-revoked → `409`.
Audit: `revoke / allowed`.

Changing a level = revoke the old row + insert a new one.

---

## Admin (all `requireAdmin()`; non-admin → `404` + `admin_access / denied` audit row)

### GET /api/admin/audit
Query: `actor`, `action`, `document`, `outcome` (`allowed`|`denied`), `from`,
`to`. → `200 {entries: [...]}` (latest 200).

### GET /api/admin/audit/verify
Runs `verify_audit_chain()` → `200 {valid: boolean, first_bad_id: number|null}`.

### GET /api/admin/users
`200 {users: [{id, email, name, role, active, created_at}]}`

### PATCH /api/admin/users
`{user_id, role?: "admin"|"member", active?: boolean}` → `200`.
Cannot demote or deactivate yourself → `400`.
Audit: `role_change` or `deactivate / allowed` with target + change.

---

## The audit write path (why it's a SQL function)

```
route -> requireDocAccess() / requireAdmin()
      -> authorize()            decision, default deny
      -> logAudit()             supabase.rpc('append_audit', ...)
                                -> pg_advisory_xact_lock   (no forked chains)
                                -> read previous hash (or 64 zeros)
                                -> sha256(prev | id | epoch | actor | action |
                                          doc | outcome | details)
                                -> insert, return id
```

`EXECUTE` on `append_audit` / `verify_audit_chain` is revoked from
`public`, `anon`, `authenticated` — only `service_role` (the server) can call
them. `audit_log` itself has no INSERT/UPDATE/DELETE grant for anyone.
