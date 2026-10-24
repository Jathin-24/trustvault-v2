-- M2 gate: run with psql -v ON_ERROR_STOP=0 -f db/gate.sql
-- Expected results are in comments.

\echo '=== 1. Chain works: append twice ==='
select append_audit(null, 'upload', null, 'allowed', '127.0.0.1', 'gate', '{"step":1}'::jsonb) as id1;
select append_audit(null, 'download', null, 'denied', '127.0.0.1', 'gate', '{"step":2}'::jsonb) as id2;

\echo '--- row 1 prev_hash must be 64 zeros, row 2 prev_hash must equal row 1 hash ---'
select id, left(prev_hash, 16) as prev_prefix, left(hash, 16) as hash_prefix
from audit_log order by id desc limit 2;

select (select prev_hash = repeat('0', 64) from audit_log order by id asc limit 1) as row1_prev_is_zeros,
       (select a.prev_hash = b.hash
          from audit_log a, audit_log b
         where a.id = (select max(id) from audit_log)
           and b.id = a.id - 1) as row2_prev_is_row1_hash;

\echo '=== 2. Edit blocked ==='
update audit_log set action = 'x' where id = 1;
delete from audit_log where id = 1;
truncate audit_log;

\echo '=== 3. Tamper detected ==='
alter table audit_log disable trigger audit_log_append_only;
update audit_log set action = 'tampered' where id = 1;
alter table audit_log enable trigger audit_log_append_only;

\echo '--- verify_audit_chain() must return 1 (the edited row) ---'
select verify_audit_chain() as first_bad_id;

-- restore the test data so the chain is clean again
alter table audit_log disable trigger audit_log_append_only;
update audit_log set action = 'upload' where id = 1;
alter table audit_log enable trigger audit_log_append_only;

\echo '--- after restore, verify must return null (clean) ---'
select verify_audit_chain() as first_bad_id;
