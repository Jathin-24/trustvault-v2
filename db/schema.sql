-- ============================================================
-- TrustVault schema (M2)
-- Run in the Supabase SQL editor, or:
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- Design notes live in THREATS.md. Order matters: later tables
-- reference earlier ones.
-- ============================================================

-- ---------- users ----------
create table if not exists users (
  id         uuid primary key default gen_random_uuid(),
  clerk_id   text unique not null,
  email      text not null,
  name       text,
  role       text not null default 'member' check (role in ('admin', 'member')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- documents ----------
create table if not exists documents (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references users (id),
  name        text not null check (length(name) between 1 and 255),
  category    text not null default 'general',
  storage_key text unique not null,           -- a random UUID, never the user's filename
  mime_type   text not null,
  size_bytes  bigint not null check (size_bytes > 0 and size_bytes <= 4194304), -- 4 MB (D4)
  sha256      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz                     -- null means not deleted (soft delete)
);

-- ---------- document_permissions ----------
-- Revoking sets revoked_at instead of deleting the row, so the history
-- survives. "Is the grant active?" means revoked_at IS NULL.
create table if not exists document_permissions (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id),
  user_id     uuid not null references users (id),
  level       text not null check (level in ('read', 'edit')),
  granted_by  uuid not null references users (id),
  granted_at  timestamptz not null default now(),
  revoked_at  timestamptz                     -- null means the grant is active
);

-- One ACTIVE grant per (document, user). Without this a double-click
-- creates two rows and a later revoke only closes one of them.
create unique index if not exists document_permissions_active_uniq
  on document_permissions (document_id, user_id)
  where revoked_at is null;

-- ---------- audit_log ----------
-- No foreign keys on purpose: an audit row must be written even for a
-- request from a user or document that doesn't exist (a denied attempt
-- by an unknown user), and a failed lookup must never block the write.
create table if not exists audit_log (
  id          bigserial primary key,          -- the order of the chain
  created_at  timestamptz not null,
  actor_id    uuid,                           -- nullable, no fk
  action      text not null,
  document_id uuid,                           -- nullable, no fk
  outcome     text not null check (outcome in ('allowed', 'denied')),
  ip          text,
  user_agent  text,
  details     jsonb,
  prev_hash   text not null,
  hash        text not null
);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists documents_owner_id_idx on documents (owner_id);
create index if not exists document_permissions_user_id_idx on document_permissions (user_id);
create index if not exists document_permissions_document_id_idx on document_permissions (document_id);
create index if not exists audit_log_created_at_idx on audit_log (created_at);
create index if not exists audit_log_document_id_idx on audit_log (document_id);

-- ============================================================
-- Protection 1: append-only (stops edits at the app's threat level)
-- ============================================================
create or replace function audit_log_block_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op
    using errcode = '42501';
end;
$$;

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function audit_log_block_mutation();

-- Row-level triggers do NOT fire on TRUNCATE, so the whole log could
-- otherwise be wiped with one statement. This is the classic miss.
drop trigger if exists audit_log_block_truncate on audit_log;
create trigger audit_log_block_truncate
  before truncate on audit_log
  for each statement execute function audit_log_block_mutation();

-- ============================================================
-- Protection 2: hash chain
--
-- hash = sha256(prev_hash | id | time | actor | action | doc |
--               outcome | details)
--
-- Traps handled here:
--   * timezone: timestamps are hashed as epoch seconds, never as
--     text, so the session timezone can't change the digest.
--   * nulls: concat_ws skips NULLs entirely; '||' with a NULL
--     would silently produce NULL.
-- ============================================================
create or replace function append_audit(
  p_actor      uuid,
  p_action     text,
  p_document   uuid,
  p_outcome    text,
  p_ip         text,
  p_user_agent text,
  p_details    jsonb
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev text;
  v_id   bigint;
  v_time timestamptz;
  v_hash text;
begin
  -- 1. transaction-level lock: two simultaneous requests can't both
  --    read the same "last hash" and fork the chain.
  perform pg_advisory_xact_lock(728374612094517);

  -- 2. previous hash, or 64 zeros if the chain is empty
  select coalesce(
           (select hash from audit_log order by id desc limit 1),
           repeat('0', 64)
         )
    into v_prev;

  -- 3-4. id and time are fixed before hashing so the stored row and
  --      the hashed string always agree
  v_id   := nextval('audit_log_id_seq');
  v_time := now();

  -- 5. the digest
  v_hash := encode(sha256(convert_to(
    concat_ws('|',
      v_prev,
      v_id::text,
      extract(epoch from v_time)::text,
      coalesce(p_actor::text, ''),
      p_action,
      coalesce(p_document::text, ''),
      p_outcome,
      coalesce(p_details::text, '')
    ),
  'UTF8')), 'hex');

  -- 6. insert
  insert into audit_log (id, created_at, actor_id, action, document_id,
                         outcome, ip, user_agent, details, prev_hash, hash)
  values (v_id, v_time, p_actor, p_action, p_document, p_outcome,
          p_ip, p_user_agent, p_details, v_prev, v_hash);

  -- 7. return the new id
  return v_id;
end;
$$;

-- The verifier recomputes each row's hash in id order and checks the
-- prev_hash link. Same rules as append_audit (epoch time, concat_ws).
create or replace function verify_audit_chain()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_expected_prev text := repeat('0', 64);
  v_computed text;
begin
  for r in select * from audit_log order by id loop
    v_computed := encode(sha256(convert_to(
      concat_ws('|',
        r.prev_hash,
        r.id::text,
        extract(epoch from r.created_at)::text,
        coalesce(r.actor_id::text, ''),
        r.action,
        coalesce(r.document_id::text, ''),
        r.outcome,
        coalesce(r.details::text, '')
      ),
    'UTF8')), 'hex');

    if r.prev_hash <> v_expected_prev then
      return r.id; -- link broken: someone removed or reordered rows
    end if;
    if r.hash <> v_computed then
      return r.id; -- content edited: hash no longer matches
    end if;

    v_expected_prev := r.hash;
  end loop;

  return null; -- chain is clean
end;
$$;

-- ============================================================
-- D2: Supabase exposes public-schema functions as /rest/v1/rpc/*.
-- By default EXECUTE is granted to PUBLIC, so anyone holding the
-- anon key could append forged audit rows. Close that.
-- ============================================================
revoke execute on function append_audit(uuid, text, uuid, text, text, text, jsonb) from public, anon, authenticated;
grant  execute on function append_audit(uuid, text, uuid, text, text, text, jsonb) to service_role;

revoke execute on function verify_audit_chain() from public, anon, authenticated;
grant  execute on function verify_audit_chain() to service_role;

-- ============================================================
-- D3: no direct writes to the log — only the function, so nobody
-- can insert a row with a made-up hash. service_role keeps SELECT
-- for the admin page.
-- ============================================================
revoke all on audit_log from public, anon, authenticated, service_role;
grant select on audit_log to service_role;

-- ============================================================
-- D1: RLS on everything, with NO policies.
-- With no policies, the public anon key sees nothing. The server
-- uses the service-role key (which bypasses RLS).
-- ============================================================
alter table users enable row level security;
alter table documents enable row level security;
alter table document_permissions enable row level security;
alter table audit_log enable row level security;

-- ============================================================
-- D4: storage bucket "documents", private, no policies.
-- Files are streamed through the server; no signed URLs.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- No storage policies on purpose: only the service role reaches the
-- objects, and every download goes through an authorized route.
