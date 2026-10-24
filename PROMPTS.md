# PROMPTS.md

running log of the prompts used to build this project, and — more important —
every time the AI got something wrong. log it the moment it happens, not on
sunday night. at least two mistakes must be about auth or audit.

---

## prompts

### step 6 — prove the connection (small and throwaway)
> Create a temporary server route that creates the Supabase server client and
> runs one trivial request, to confirm the keys work. Delete it afterwards.
> Create a page that shows "signed in as ..." using Clerk's server-side helper.
> This proves server code can see the session. dont create in this folder

what happened: both worked. supabase route returned `reachable: true`, clerk
page rendered "signed out (server code ran fine)" server side. the temp files
lived in `src/app/dev-check/` and got deleted after verification, like asked.

### deploy to vercel
> give me commands to deply this project to vercel in cli and also adding the
> env variables from .env.local

> are the names correct for the keys if yes then you run the commands

what happened: names were correct (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
`CLERK_SECRET_KEY`, `SERVICE_ROLE`, `DATABASE_URL`). deploy ran.

### forgot columns in the users table
> u forgot few in users table whyyy

what happened: the AI listed id, clerk_id and role then jumped straight to
documents, skipping email, name, active and created_at. the user caught it.
full table was re-listed. lesson for me: when the prompt says "full column
list", print the full column list.

### build the whole vault project
> i will send yout the conversation u understand it ... create a new folder
> named Vault in snovyses and buid the project in that and write prompts just
> as i wrote and follow that way of messaging and then build the complete
> project with all the mentioned requirements and the things that were
> discussed in the conversation as well so dont forget or miss anything and
> do one after another as mentioned in the chat so build it and dont make any
> mistakes and also make threates.md also sound the same as prompts.md like
> same usage of words and how i write things and how i commit things so do
> that complete it fast or use multiple agents to complete the project and
> remember the messages that i sent you and dont forget come to this when ever
> you think that you are doing wrong and after completing each module or phase
> check if you've done all the things that I've mentioned in it or not and if
> not, recheck what are the things that you have done and again redo it, don't
> make any mistakes

what happened: M0 decisions (D1-D11) confirmed from the blueprint chat, then
M1 -> M11 built in order, gates proven with real curl/psql output before
moving on.

---

## AI mistakes (log with the commit that fixed it)

### 1. corrupted env vars on vercel (not auth/audit, but expensive)
- what it said: a powershell loop piping `name` + newline + `value` into
  `vercel env add` would upload `.env.local` correctly.
- what was wrong: `vercel env add` reads the value from stdin, so three vars
  were stored literally as `CLERK_SECRET_KEY\nsk_test_...\r\n`. every request
  500'd in production with "Publishable key not valid".
- fix: re-added each with `vercel env add <name> production --value "..." --force`.
- commit: trustvault deploy (previous project), lesson carried into Vault —
  never pipe two lines into `vercel env add`.

### 2. force-dynamic export rejected by cacheComponents (auth related)
- what it said: add `export const dynamic = 'force-dynamic'` to the page that
  calls `currentUser()`.
- what was wrong: this Next 16 project has `cacheComponents: true`, and route
  segment config `dynamic` is not compatible with it — the build failed with
  "Route segment config dynamic is not compatible with nextConfig.cacheComponents".
- fix: wrapped the async session-reading component in `<Suspense>`, which is
  the pattern this Next version wants. same fix applies to every page in Vault
  that reads the session or DB during prerender.
- commit: see the M8 frontend commit in this repo.

### 3. merge with powershell corrupted a route file (broke auth routes)
- what it said: append one file into another with `Get-Content -Raw` +
  `Add-Content` (default ANSI encoding).
- what was wrong: `[id]/route.ts` contained UTF-8 characters (em dashes in
  comments); powershell wrote them as ANSI and turbopack then failed with
  "invalid utf-8 sequence of 1 bytes from index 2785". every request to
  `/api/documents/[id]` returned 500 — which meant get/patch/delete were all
  dead, i.e. the authorization checks were unreachable.
- fix: rewrote the file with the write tool (utf-8 safe) and added a check:
  any file merged or edited via shell gets a strict UTF-8 decode test first.
- commit: the M3-M7 commit.

### 4. sniffMime referenced a variable that didn't exist (audit upload path)
- what it said: the text-file fallback inside `sniffMime` should test
  `looksLikeText(head)`.
- what was wrong: `sniffMime(bytes)` has no `head` variable — `ReferenceError:
  head is not defined`, so EVERY upload 500'd instead of validating.
- fix: `looksLikeText(bytes)`.
- commit: the M3-M7 commit.

### 5. .test domain rejected by clerk backend api (auth)
- what it said: create test users with `admin@vault.test`.
- what was wrong: clerk rejects `.test` email domains ("Email address must be
  a valid email address"), and then required a `username` field this instance
  is configured with ("data doesn't match user requirements").
- fix: `scripts/mint-token.mjs` now uses `@vaultdemo.com` and generates a
  username. this is a test-harness issue, not app code.

### 6. curl signed-in tests failed until the dev-browser cookie existed (auth)
- what it said: send `__session=<jwt>` cookie and the API will see the user.
- what was wrong: clerk in development refuses requests with
  `x-clerk-auth-reason: dev-browser-missing`, and after that
  `session-token-iat-before-client-uat` because `__client_uat` was newer than
  the token's `iat`.
- fix: `scripts/get-cookie.ps1` mints the session, sets `__client_uat` to
  `iat - 5`, and reuses the `__clerk_db_jwt` from a handshake (cookie jar in
  %TEMP%). every signed-in curl test in this project goes through it.
- note: production (vercel) does not need the dev browser cookie, only
  development instances do.

### 7. "no prerender issues are expected" — next build actually failed
- what it said: the frontend agent's report said it did not run `next build`
  and "with Cache Components, no page reads cookies/headers/DB at request
  time... no Suspense/prerender issues are expected". i committed to
  verifying and ran the build myself — good thing.
- what was wrong: `next build` FAILED. Cache Components refuses to prerender
  client hooks that need request-time URL/session data:
  `useAuth()`/`usePathname()` in the header, `useParams()` in the document
  detail page, Clerk's `<SignIn/>` on the sign-in page —
  "URL data in a Client Component outside of <Suspense>" on 2 routes.
- fix: read `node_modules/next/dist/docs/` (the AGENTS.md rule — i had not
  been reading it before this) and used the docs' canonical `[stream]` fix:
  Suspense boundaries with skeleton fallbacks in `layout.tsx`,
  `documents/[id]/page.tsx`, `sign-in/page.tsx`. did NOT use the
  `instant = false` escape hatch. build is green now: 14/14 pages.
- lesson: "expected to build" is not "builds". run `next build` after every
  frontend change, and read the bundled docs before fighting a framework
  error.
- commit: `7f27bf2`

### 8. `<SignedIn>`/`<SignedOut>` don't exist in Clerk 7.9.20 — home page was 500ing since M1
- what it said: M1's landing page used `<SignedIn>`/`<SignedOut>` and i
  reported the page as done. i only ever curl'd `/api/*` after that, never
  opened `/`, so the 500 sat there for milestones.
- what was wrong: clerk 7.9.20 (Core 3) throws at runtime:
  `Clerk: <SignedIn> is not available in @clerk/nextjs Core 3`.
  `GET /` → 500 the whole time.
- fix: the M8 agent replaced them with the `useAuth()` hook + conditional
  rendering, the pattern this version wants.
- lesson: hitting the API is not hitting the app. after M1 i should have
  curled `/` once. every page gets opened at least once, signed out AND
  signed in, before i call it done.
- commit: `7f27bf2`

### 9. my own gate scripts kept breaking on PowerShell quoting (3 failed runs)
- what it said: one-liners with inline JSON for the concurrency test:
  `'{`"job`:$_}'` … then `'…'{"job":' + $_ + '}';`
- what was wrong: run 1 → `{"job:1}` (the `":` got eaten — backtick escaping
  in my own string), run 2 → missing closing `)` → `syntax error at or near
  ";"`. also `curl -d "<inline json>"` → `Empty or invalid json` (PGRST102)
  again, the same bug as the M6 gate earlier.
- fix: build SQL with pure single-quoted concatenation (no backticks), and
  for curl always write the body to a file + `--data-binary @file`.
  concurrency then passed: 5 parallel appends → ids 3-7, chain verifies
  clean. this is the third time PowerShell quoting bit me — the rule is now
  permanent: **no inline JSON through the shell, ever.**
- commit: gates re-proven after `7f27bf2`

---

## mid-build credential rotation (logged because it changed all the proof)

user sent new credentials mid-project: new Supabase project
`ljmdpojcwcqclluselmu` (+ password + service_role) and a new Clerk instance
`refined-pigeon-7807`. before switching i noticed the OLD database had been
reset by someone running the old trustvault project's `drop_all.sql` +
schema demo data (audit rows `{"job": N}`/`{"demo": "row 1"}` at 01:49-01:51
— not mine), so nothing of value was lost.

what i re-did, all re-proven from scratch on the new backend:
- `db/schema.sql` + `db/gate.sql` → chain works, UPDATE/DELETE/TRUNCATE all
  blocked, tamper → `first_bad_id = 1` → restore → `null`
- 5 concurrent `append_audit` via parallel psql → ids 3-7 interleaved,
  `verify_audit_chain()` → null
- anon key gates with the NEW publishable key: `/rest/v1/documents` 200 [],
  `/rest/v1/users` 200 [], `/rest/v1/audit_log` 401, `rpc/append_audit`
  401 permission denied for function, direct insert 401
- `.env.local` + all 6 Vercel env vars rotated (`--value --force`, no stdin
  piping), dev server restarted to load them
- test users recreated in the new Clerk instance (fresh dev-browser
  handshake), admin promoted **by hand in SQL** again (never automatic),
  `scripts/seed.mjs` → 5 docs + 3 grants
- full M3-M7 curl gates re-run: 401 anon ×6, 404 ungranted ×4 + denied audit
  rows, owner_id spoof ignored, guessed id 404, exe-as-pdf 400, 5MB 413,
  grant → 200 → revoke → **very next** 404, deactivate → 401, non-admin →
  404 on all admin routes + `admin_access/denied` rows, verify →
  `{"valid":true}`

every gate that was proven on the old database was re-proven on the new one.
no claim in this repo rests on the old backend.

---

## how commits are written

- `feat(m2): ...` — one commit per milestone, message says what was built
  AND what was proven (gates in the body).
- gates are proven with real output pasted into the commit body or this file,
  never "should work".
- no "all tested" anywhere there are no tests (item 10 of the brief is
  deliberately skipped — see THREATS.md).
