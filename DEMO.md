# DEMO.md — 5-minute video script + shot list

I can't record this for you. Here's a timed script; every claim is something
you can point at on screen. Rehearse once, record once.

**Before you record:** sign out of everything, use a fresh private window,
have the three accounts written on paper (see README). Live site:
https://vault-rangammas-projects.vercel.app

---

## 0:00 — The problem (30 s)

> "This is TrustVault: documents with per-document sharing, and an audit log
> you can't quietly edit. Anyone with the public anon key can usually just
> query your database directly — I'll show you why they can't here, and why
> editing the audit trail is detectable."

**Shot:** home page, signed out → Sign in.

## 0:30 — Sign in as Ravi, the owner (30 s)

Sign in `ravi@vaultdemo.com`. Show the documents list with his 4 seed docs.

> "Ravi owns these. Sharing is per-document: opening a link or guessing an id
> gives you nothing."

**Shot:** documents list, click `rental-agreement.pdf`.

## 1:00 — Share with Meena (45 s)

In the sharing panel: grant `meena@vaultdemo.com` read on this document.

> "Ravi grants Meena read. The row is recorded — revoking never deletes it,
> it sets revoked_at, so the history stays honest."

**Shot:** grant appears in the list. Copy the document URL.

## 1:45 — The denial (60 s) — *rule 3, the money shot*

Open a **private window**, sign in as `meena@vaultdemo.com`, paste the URL of
a document Ravi did NOT share (`meeting-notes.pdf`).

> "404 — not 403. A 403 would confirm the document exists. And look at the
> audit log —"

Open the admin audit view (or run the psql query): a `denied` row with
`{"reason":"no grant"}`.

**Shot:** 404 on screen + the denied audit row side by side.

## 2:45 — Revoke and watch it die instantly (45 s)

Back as Ravi: revoke Meena's grant on `rental-agreement.pdf`. In Meena's
already-open private window, hit download again.

> "Her session is still valid, her tab was open, the URL is unchanged — but
> every request re-checks the database, and the file streams through my
> server, so there's no signed URL to outlive the grant. Next request:
> 404. Audit shows grant, download, revoke, denied — in that order."

**Shot:** the four audit rows in sequence.

## 3:30 — Tamper evidence (60 s) — *the demo moment*

SQL editor:

```sql
select id, action, hash from audit_log order by id desc limit 3;

alter table audit_log disable trigger audit_log_append_only;
update audit_log set action = 'x' where id = 1;
alter table audit_log enable trigger audit_log_append_only;

select verify_audit_chain();   -- returns 1
```

> "Triggers block UPDATE, DELETE and TRUNCATE — I disabled this one to play
> the attacker. The hash chain still catches it: row 1 was edited, the
> recomputed hash doesn't match, and row 2's prev_hash now points at a hash
> that doesn't exist. The function returns the first bad row: 1."

Restore:

```sql
alter table audit_log disable trigger audit_log_append_only;
update audit_log set action = 'upload' where id = 1;
alter table audit_log enable trigger audit_log_append_only;
select verify_audit_chain();   -- returns null, chain is clean
```

**Shot:** `1` then `null`.

## 4:30 — Admin sees everything, reads nothing (30 s)

Sign in as `admin@vaultdemo.com`. Audit filters, Verify button, user list
(deactivate is one click).

> "Admin manages users and reads the audit trail — but cannot open a document
> unless Ravi grants them like anybody else. Same 404 as a stranger."

**Shot:** admin audit table + verify green.

## 4:45 — The suite (15 s)

```bash
npm test
```

> "47 unit tests cover the decision logic without a server; the 18
> integration tests are this exact gate matrix running against the app —
> the same 401/404/revoke checks I showed you, executable. On a fresh
> clone without credentials they skip themselves with a reason instead of
> pretending to pass."

**Shot:** terminal: `65 passed`, exit 0.

## 5:00 — Close

> "Closed: anon-key table access (RLS, no policies), forged audit rows (no
> insert grant, function execute revoked), edits and truncation (triggers +
> hash chain). Accepted and documented: tail truncation needs an external
> head-hash anchor, and a database owner can rewrite everything — I say so in
> THREATS.md rather than claiming otherwise."

---

## Shot list (files to have open)

1. Home page signed out → sign in
2. Documents list (Ravi)
3. Sharing panel: grant Meena
4. Private window: Meena → 404 on unshared doc
5. Admin audit: the `denied` row
6. Revoke → Meena's next download 404 → four audit rows in order
7. SQL editor: disable trigger → edit → `verify_audit_chain() = 1` → restore → `null`
8. Admin: audit filters, verify green, user list
9. Terminal: `npm test` → 65 passed
10. `THREATS.md` on screen for the honest-accepted-risks line

## Backup lines (if a judge asks)

- **"Where is the decision made?"** → `lib/authz.ts`, default deny; removing
  the line fails closed, because routes call `requireDocAccess` and nothing else.
- **"Why SQL and not app code for the audit hash?"** → two requests reading
  the same last hash would fork the chain; the advisory lock lives in the
  function so no application path can skip it.
- **"What if middleware is removed?"** → sessions wouldn't be checked at the
  edge, but `getCurrentUser()` still 401s every route — defense in depth.
