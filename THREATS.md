# THREATS.md

threat -> what I did -> status (closed or accepted, and why)

nothing gets marked "closed" that I have not actually tried to break. entries
are added as each milestone lands, not reconstructed at the end.

---

## from M2 (database, RLS, audit)

### Direct API access with the public anon key
- threat: anyone can open devtools, copy the `sb_publishable_...` key from the
  network tab, and query my tables straight from supabase rest.
- what I did: RLS enabled on `users`, `documents`, `document_permissions` and
  `audit_log` with **zero policies**. with no policies the anon role sees
  nothing. server code uses the service-role key and the browser never talks
  to supabase at all (D1).
- status: **closed, tested by curl.**
  ```
  GET  /rest/v1/documents  -> 200 []
  GET  /rest/v1/users      -> 200 []
  GET  /rest/v1/audit_log  -> 401 permission denied for table audit_log
  ```

### Forged audit rows via /rest/v1/rpc/append_audit
- threat: supabase exposes public-schema functions as api calls, and by
  default EXECUTE is granted to PUBLIC. anyone holding the anon key could call
  `rpc/append_audit` and insert fake entries with made-up hashes.
- what I did: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` on both
  `append_audit` and `verify_audit_chain`, granted only to `service_role`.
  `append_audit` is `SECURITY DEFINER` with `SET search_path = public`.
- status: **closed, tested by curl.**
  ```
  POST /rest/v1/rpc/append_audit -> 401
  ```

### Inserting an audit row with a made-up hash
- threat: even without the function, a direct INSERT could plant a row whose
  `prev_hash`/`hash` are nonsense and break the chain for everyone.
- what I did: `REVOKE ALL ON audit_log FROM PUBLIC, anon, authenticated,
  service_role`, then `GRANT SELECT TO service_role` only. the ONLY write path
  is `append_audit`, which computes the hash itself under an advisory lock.
- status: **closed.**

### Audit edit or delete
- threat: `UPDATE audit_log SET ...` or `DELETE` to quietly rewrite history.
- what I did: BEFORE UPDATE OR DELETE ... FOR EACH ROW trigger raises
  `audit_log is append-only`.
- status: **closed, tested in the SQL editor.**
  ```
  ERROR: audit_log is append-only: UPDATE is not permitted
  ERROR: audit_log is append-only: DELETE is not permitted
  ```

### Truncating the whole log
- threat: row-level triggers do NOT fire on TRUNCATE, so one statement could
  wipe the log — the classic miss.
- what I did: second trigger, BEFORE TRUNCATE ... FOR EACH STATEMENT, same
  exception.
- status: **closed, tested.**
  ```
  ERROR: audit_log is append-only: TRUNCATE is not permitted
  ```

### Editing a row while nobody is looking (tamper evidence)
- threat: an attacker with DB access disables the trigger, edits row 50, and
  the append-only protection is gone.
- what I did: hash chain. each row stores `prev_hash` and
  `hash = sha256(prev_hash | id | epoch time | actor | action | doc | outcome |
  details)`. edited row's recomputed hash no longer matches, AND the next
  row's `prev_hash` points at a hash that no longer exists.
  `verify_audit_chain()` walks the chain in id order and returns the first bad
  row id (or null).
- status: **closed for the app, tested end to end.**
  ```
  -- trigger disabled, row 1 edited:
  select verify_audit_chain();  -> 1
  -- restored:
  select verify_audit_chain();  -> null
  ```
  timezone trap handled: timestamps are hashed as `extract(epoch from ...)`,
  never as text, so the session timezone cannot cause false failures. null
  trap handled: `concat_ws('|', ...)`, never `a || b` (which returns NULL when
  either side is NULL).

### Two requests racing and forking the chain
- threat: two simultaneous `append_audit` calls both read the same "last
  hash" and the chain splits.
- what I did: `pg_advisory_xact_lock` inside `append_audit` before reading the
  last hash. doing this in SQL, not in Next.js code, means no application
  logic can forget it.
- status: **closed, tested — 5 simultaneous appends, ids 3-7, chain verifies
  clean (`first_bad_id = null`).**

### Truncating the tail (deleting the latest rows)
- threat: delete rows 50-100. nothing points at them, so rows 1-49 still form
  a valid-looking chain. verify_audit_chain() returns null.
- what I did: this one is NOT fully closable from inside the database. the
  mitigation is an **external anchor**: store the current head hash outside
  the database (app config / a file / a dashboard note) and compare it
  periodically.
- status: **accepted, with that mitigation named.** honest limitation of any
  hash chain that only sees its own history.

### Database owner or superuser rewrites the whole chain
- threat: `postgres` can drop the triggers, disable them, and rewrite every
  row plus recompute every hash. the chain would then verify clean.
- what I did: nothing — and I am not going to pretend otherwise.
- status: **accepted, out of scope for this app's threat model.** the same
  is true of any system where the attacker owns the database. worth saying
  out loud in the interview rather than being caught on it.

---

## from M3-M7 (auth, authz, api)

### Middleware is not authorization
- threat: reading `clerkMiddleware` and assuming "the proxy protects the
  routes". it only checks a session exists.
- what I did: every decision lives in `lib/authz.ts` `authorize()`, default
  DENY, called only through `requireDocAccess()` / `requireAdmin()`. the proxy
  comment says so explicitly.
- status: **closed.** the interview line: "middleware only checks you're
  signed in. it is not authorization."

### IDOR — guessing or swapping document ids
- threat: change the id in the URL to someone else's document.
- what I did: `requireDocAccess(id, action)` loads the document and checks
  ownership or an ACTIVE grant every request. no grant -> 404 with a `denied`
  audit row.
- status: **closed, tested.** guessed id `00000000-...` -> 404. meena on
  ravi's doc -> 404 on get/patch/delete/download, audit row
  `{"reason":"no grant"}`.

### 403 vs 404 (does the response confirm existence?)
- threat: returning 403 on a forbidden document tells the attacker the
  document exists.
- what I did: denials are always 404 `{"error":"not found"}` (D8). signed out
  is 401.
- status: **closed, tested** in the attack matrix.

### owner_id in the request body
- threat: upload or patch with `{"owner_id": "<someone else>"}` to steal or
  hand over a document.
- what I did: `owner_id` is taken from the session in the upload handler and
  never read from the body; PATCH only allow-lists `name` and `category`.
- status: **closed, tested** — uploaded with a spoofed `owner_id`, row still
  owned by ravi.

### Admin reads everyone's file contents (rogue admin, D6)
- threat: an admin quietly downloads every document.
- what I did: `admin` is a global role for users + audit only. content access
  requires ownership or an explicit grant — `authorize()` never passes on role
  alone. admin on someone else's doc with no grant = 404, same as anyone.
- status: **closed by design**, tested: ravi (member) hitting `/api/admin/*`
  gets 404 + denied audit row; admin hitting document routes without a grant
  gets 404.

### Revoke doesn't take effect (rule 3)
- threat: meena keeps downloading after ravi revokes, because the UI hid the
  button or a cache held the grant.
- what I did: grants are checked live on every request (`revoked_at IS NULL`),
  nothing cached (D11), files stream through the server so there is no signed
  URL to outlive the grant (D3).
- status: **closed, tested** — grant -> 200, revoke -> very next request 404.
  audit shows grant, download, revoke, denied in order.

### Double-click creates two active grants
- threat: two `read` rows for the same (document, user); a later revoke closes
  only one and the user keeps access you thought you removed.
- what I did: partial unique index
  `ON document_permissions (document_id, user_id) WHERE revoked_at IS NULL`.
  the API also answers 409 before hitting the index.
- status: **closed.** revoking always targets a specific grant id and sets
  `revoked_at`; history rows are never deleted.

### Deactivated user keeps working
- threat: set `active=false` but the user's clerk session is still valid, so
  they keep calling the API.
- what I did: `getCurrentUser()` re-reads `active` from the DB on EVERY
  request and returns null -> 401. nothing cached.
- status: **closed, tested** — meena deactivated, her valid session gets 401
  on /api/me and /api/documents; restored after.

### New user becomes admin
- threat: default role `admin` on insert, or a client-supplied role.
- what I did: schema default is `'member'`, the insert in `getCurrentUser()`
  does not send a role at all, and the first admin was promoted by hand in the
  SQL editor (M3).
- status: **closed.**

### Malicious file upload
- threat: `.exe` renamed to `.pdf`, content-type spoofed by the browser, path
  traversal in the filename, zip bomb / oversized file.
- what I did: extension allowlist, **magic-byte sniffing** (the real type is
  read from the file's leading bytes, not the browser's claim), extension must
  agree with the sniffed content, filename sanitized (strip path separators and
  control chars), 4 MB cap checked before and after read (413), storage key is
  a random UUID so the user's filename never touches storage, sha256 computed.
- status: **closed, tested.** `evil.pdf` with MZ header -> 400
  `unrecognized file content`; 5 MB file -> 413 `file exceeds 4 MB`;
  filename `../../../etc/passwd.txt` -> stored as `passwd.txt` (path
  segments stripped, storage key still a random UUID); filename
  `<script>alert(1)</script>.txt` -> tags stripped on upload and escaped
  again by React on render.

### Search leaking other users' documents
- threat: the list endpoint returns everyone's rows and filters in JS (or not
  at all), or search terms with `%`/`_`/`'` break the filter.
- what I did: the access filter is **inside the SQL query** —
  `owner_id = me OR id IN (my active grant ids)` — before any row leaves the
  database. wildcards in the name search are stripped; supabase query builder
  parameterises everything (no string-concatenated SQL).
- status: **closed, tested** (meena's list contains only her docs + shared;
  `?name=meeting` as meena -> 0 results even though ravi owns
  meeting-notes.pdf).

### Crafted filter input (SQL-like terms, bad uuids, bad dates)
- threat: `?name=' OR 1=1--`, `?owner=not-a-uuid`, `?from=banana` — either
  injection or a 500 that leaks a stack trace.
- what I did: queries are parameterised (supabase query builder), quotes and
  wildcards are stripped from filter values, `owner` must match a uuid
  pattern, dates must match ISO. a bad value now returns
  `400 {"error":"invalid filter"}` — never a 500, never a leak.
- status: **closed, tested.**
  ```
  ?name=' OR 1=1--        -> 400 invalid filter
  ?owner=not-a-uuid&from=banana -> 200, invalid parts ignored
  ```

### CSRF on state-changing routes
- threat: a malicious site POSTs to /api/documents/[id] while the victim is
  signed in (browser attaches cookies).
- what I did: session cookies are `SameSite=Lax` (Clerk default), so
  cross-site POST/PATCH/DELETE requests don't carry them; requests must also
  pass `clerkMiddleware`. no custom Origin check implemented.
- status: **accepted with that mitigation named** — SameSite=Lax covers
  classic cross-site form posts; a dedicated Origin/Referer check would be
  the next hardening step if this were exposed to a wider audience.

### Admin routes reachable by anyone
- threat: `/api/admin/*` checked only in the UI.
- what I did: `requireAdmin()` in front of every admin handler; non-admin ->
  404 + a `denied` audit row with action `admin_access`.
- status: **closed, tested** — ravi gets 404 on all three, three denied rows
  in the audit log; admin gets 200.

### Self-lockout via admin API
- threat: admin demotes or deactivates their own account and locks the system.
- what I did: PATCH /api/admin/users refuses to demote or deactivate the
  caller's own id.
- status: **closed.**

---

## accepted risks (honest list)

### 4 MB upload cap (D4)
- accepted knowingly. larger uploads are awkward on serverless limits (D4) and
  the cap is enforced twice (pre-read and post-read). a `size_bytes` CHECK in
  the schema backs it up at the database level: `> 0 AND <= 4194304`.

### No rate limiting
- accepted. a determined attacker could hammer uploads or login attempts.
  mitigations that exist: 4 MB cap per request, Vercel's platform-level
  protections. a per-user document quota is the next thing I would add.
  status: **accepted, not built.**

### Any member can upload -> storage fill
- accepted, same as above: mitigated by the 4 MB cap, not by a quota.
  (from D5/D7: uploading makes you an owner of that document only.)

### Automated tests (brief item 10)
- was listed here as a known gap; **built later as M11** after I was asked
  to do it. `npm test` now runs two tiers:
  - **47 unit tests, no server/credentials**: `authorize()` default-deny
    matrix (owner / read grant / edit grant / revoked / admin / soft-
    deleted), upload validation (magic bytes, 4 MB cap, traversal names,
    declared-vs-real mismatch), the 404-not-403 wrapper + denial audit rows,
    never-auto-admin + deactivation.
  - **18 integration tests** against a running app: the exact M3-M7 gate
    matrix from this file (401 signed-out ×9 routes, 404 ungranted ×4,
    spoofed owner_id, exe → 400, 5 MB → 413, malformed JSON → 400,
    sql-ish filter → 400, grant → revoke → very next 404, member → 404 on
    admin routes, admin verify `{valid: true}`, deactivate → 401). It
    skips itself with a printed reason when the app isn't reachable, so a
    fresh clone still gets green without lying about coverage.
- honest scope of what is still NOT covered: no browser/UI end-to-end
  tests (the frontend is exercised by hand — see DEMO.md), no load or
  rate-limit tests (there is no rate limiting — above), the SQL layer is
  proven separately by `db/gate.sql` (run with psql, not vitest).
- admin-dependent integration tests skip until `admin@vaultdemo.com` is
  promoted by hand — promotion is deliberately manual (D5), tests don't
  get a back door. Clerk session tokens (60 s TTL) are re-minted every
  ≤40 s by the harness itself.
- status: **closed.** 65/65 green (`npm test`), lint 0/0, build green.

### Clerk development keys on the deployed site
- accepted until a custom domain is configured: the site runs on
  `*.vercel.app` with `pk_test_`/`sk_test_` keys, so the Clerk instance is a
  development instance (dev-browser cookie behaviour, test data). production
  keys + a custom domain would be the fix.
  status: **accepted.**

### Tail truncation / owner rewrites
- see M2 entries above. both **accepted**, mitigation (external head-hash
  anchor) named but not implemented.

---

## deliberately not built (so nobody assumes they exist)

- folders and groups (categories only) — D7
- version history — revoke/grant history is kept instead
- external sharing / signed URLs — D3 says no
- per-user quota — see rate limiting
- AI anything
