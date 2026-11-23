-- pgTAP cross-cutting tests for the family-shared-care functions (task 8.7).
-- Requirements 14.4 (audit trail is append-only for client roles), 15.3 (no free
-- text, amounts, names, or titles in audit payloads), 16.3 (service-only access).
--
--   1. Every public function and private helper of the feature: anon, authenticated,
--      and PUBLIC cannot execute; service_role can; search_path is empty. A name
--      pattern check fails if a new function is added without being listed here.
--   2. A representative sequence of every audit-writing function runs with distinctive
--      sensitive sentinel strings. None may appear in audit_events.payload or
--      feed_items.params, every payload key is on the design allow-list, and every
--      string value is an ID, code, ISO time, or zone name.
--   3. Table-driven: each state-changing call writes exactly one primary audit event
--      (plus only approval.reset and reminder.sent as consequences).
--   4. audit_events cannot be inserted, updated, or deleted by client roles.
--
-- Uses the demo household from seed.sql (Haruko ..01 care_recipient, Misa ..02 the
-- only active primary_caregiver, Kenta ..03 finance_coordinator, Yui ..04
-- transport_coordinator, Aiko ..05 professional_caregiver) plus a fake outsider
-- household. All new rows are fake and rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(282);

-- ---------------------------------------------------------------------------
-- 1. Grants and search_path (programmatic, over the exact signatures)
-- ---------------------------------------------------------------------------
create temp table fn_list (sig text primary key);
insert into fn_list (sig) values
  -- public Action_Guard functions
  ('public.claim_part(uuid, uuid, text)'),
  ('public.release_part(uuid, uuid, text)'),
  ('public.request_assignment(uuid, uuid, uuid)'),
  ('public.request_handover(uuid, uuid, text, uuid)'),
  ('public.request_backup(uuid, uuid, uuid)'),
  ('public.volunteer_backup(uuid, uuid)'),
  ('public.respond_to_request(uuid, uuid, boolean)'),
  ('public.expire_care_requests(uuid, timestamptz)'),
  ('public.decide_approval(uuid, uuid, text)'),
  ('public.resubmit_part(uuid, uuid, text, uuid[])'),
  ('public.complete_part(uuid, uuid)'),
  ('public.report_part_failed(uuid, uuid, text)'),
  ('public.reopen_part(uuid, uuid)'),
  ('public.record_evidence(uuid, uuid, text, text, text, text)'),
  ('public.confirm_part_time(uuid, uuid, text, timestamptz, text)'),
  ('public.save_part_amount(uuid, uuid, bigint, text)'),
  ('public.resolve_missing_detail(uuid, uuid, text)'),
  ('public.mark_feed_seen(uuid, uuid, timestamptz)'),
  ('public.set_member_language(uuid, uuid, text)'),
  ('public.save_appointment_clarification(uuid, uuid, text, timestamptz, text)'),
  -- private helpers (migrations 20261210000200 and 20261210000300)
  ('private.actor_member(uuid, uuid)'),
  ('private.active_primary_count(uuid)'),
  ('private.step_household_id(uuid)'),
  ('private.is_part_closed(public.care_steps)'),
  ('private.effective_approval_state(public.care_steps)'),
  ('private.is_high_risk(public.care_steps)'),
  ('private.write_audit(uuid, uuid, uuid, uuid, text, uuid, text, jsonb)'),
  ('private.add_feed_item(uuid, uuid, uuid, uuid, text, uuid, jsonb, uuid)'),
  ('private.add_reminder(uuid, uuid, uuid, uuid, uuid, text, jsonb)'),
  ('private.apply_plan_change(uuid, text, uuid)'),
  ('private.apply_people_change(uuid, text, uuid)'),
  ('private.apply_key_fact_change(uuid, text, uuid)'),
  ('private.request_expiry(text, public.care_steps, timestamptz)'),
  ('private.may_reopen_or_request_backup(public.household_members, public.care_steps)'),
  ('private.iso_utc(timestamptz)'),
  ('private.create_care_request(public.care_steps, public.care_chains, public.household_members, uuid, text, text, uuid)'),
  ('private.close_care_request_expired(public.care_requests, public.care_chains, uuid, uuid)'),
  -- recognition functions (migration 20261210000400, task 12.2)
  ('public.start_recognition_run(uuid, uuid, integer)'),
  ('public.save_care_chain_draft(uuid, jsonb)'),
  ('public.fail_recognition_run(uuid, text, boolean)'),
  ('public.resume_stale_recognition_runs(timestamptz, integer, uuid)'),
  ('private.usable_draft_id(uuid)'),
  ('private.draft_text(jsonb, text, integer, boolean)'),
  ('private.draft_timestamptz(jsonb, text)'),
  ('private.fail_run_locked(public.recognition_runs, text, boolean)'),
  -- escalation (migration 20261210000500, task 18.1)
  ('public.escalate_due_parts(uuid, timestamptz)'),
  -- recipient replies (migration 20261210000600, decision D17)
  ('public.send_recipient_reply(uuid, uuid, text)');

select ok(to_regprocedure(sig) is not null, 'Function exists: ' || sig)
from fn_list order by sig;

-- anon, authenticated, and PUBLIC (grantee 0) hold no EXECUTE privilege.
select ok(
  not exists (
    select 1
    from pg_proc p,
         lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = to_regprocedure(sig)
      and a.privilege_type = 'EXECUTE'
      and (a.grantee = 0
           or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))
  )
  and not has_function_privilege('anon', to_regprocedure(sig), 'execute')
  and not has_function_privilege('authenticated', to_regprocedure(sig), 'execute'),
  'anon, authenticated, and PUBLIC cannot execute ' || sig
)
from fn_list order by sig;

select ok(
  has_function_privilege('service_role', to_regprocedure(sig), 'execute'),
  'service_role can execute ' || sig
)
from fn_list order by sig;

select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = to_regprocedure(sig)),
  'search_path is empty for ' || sig
)
from fn_list order by sig;

-- Name pattern: any function in public or private that is not a known legacy
-- function must be on the list above, so a new function cannot skip these checks.
select is_empty(
  $$
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as unlisted
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
    and p.prokind = 'f'
    and p.proname !~ '^(reserve_note_upload|complete_note_upload|record_note_upload_.*|claim_note_upload_failure|expire_note_upload|can_upload_notes|current_user_household_ids|set_updated_at|assert_.*)$'
    and p.oid not in (select to_regprocedure(sig)::oid from fn_list)
  $$,
  'Every feature function in public and private is on the grants list'
);

-- Real calls by client roles are refused with a permission error.
set local role anon;
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  '42501', null, 'anon cannot call claim_part'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  '42501', null, 'authenticated cannot call claim_part'
);
select throws_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'ja') $$,
  '42501', null, 'authenticated cannot call set_member_language'
);
select throws_ok(
  $$ select private.write_audit('d0000000-0000-4000-8000-000000000001', null, null, null, 'human', 'd1000000-0000-4000-8000-000000000002', 'part.claimed', '{}'::jsonb) $$,
  '42501', null, 'authenticated cannot call private.write_audit'
);
reset role;

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'outsider.grants.test@example.com', now(), now());
insert into public.households (id, name)
values ('e0000000-0000-4000-8000-000000000001', 'Grants outsider household');
insert into public.household_members (id, household_id, user_id, display_name, role, is_active)
values ('e2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000001', 'Outsider', 'primary_caregiver', true);
insert into public.notes (id, household_id, uploaded_by, image_path, status)
values (
  'e3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/1763700000000-note.png',
  'pending_review'
);
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values ('e4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
        'e3000000-0000-4000-8000-000000000001', 'SENTINEL-CHAIN-zq7', 'high');
-- Parts (ids e5...0000000NN). Titles carry sentinels (titles and a fake medication
-- name must never reach a payload).
-- 01 appointment, approved, unclaimed, evidence required (claim, release, approval, time, evidence, complete)
-- 02 payment, approved, owner Yui                       (amount, task due time, fail, reopen)
-- 03 transport, approval pending, owner Yui             (handover, assignment, backup requests)
-- 04 household, low risk, owner Yui                     (volunteer_backup)
-- 05 appointment, approval pending, owner Misa          (missing details, self-approval)
-- 06 appointment, approved, unclaimed                   (legacy appointment clarification)
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, owner_id, evidence_required
)
values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'SENTINEL-TITLE-1-zq7 SENTINEL-MEDS-zq7', 'appointment', 'high', true, 'pending_review', 'approved',
   null, array['Receipt for SENTINEL-MEDS-zq7', 'Photo']),
  ('e5000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001',
   'SENTINEL-TITLE-2-zq7 pay SENTINEL-MEDS-zq7', 'payment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', '{}'),
  ('e5000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001',
   'SENTINEL-TITLE-3-zq7', 'transport', 'high', true, 'in_progress', 'pending',
   'd2000000-0000-4000-8000-000000000004', '{}'),
  ('e5000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-000000000001',
   'SENTINEL-TITLE-4-zq7', 'household', 'low', false, 'in_progress', 'not_required',
   'd2000000-0000-4000-8000-000000000004', '{}'),
  ('e5000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-000000000001',
   'SENTINEL-TITLE-5-zq7 SENTINEL-MEDS-zq7', 'appointment', 'high', true, 'in_progress', 'pending',
   'd2000000-0000-4000-8000-000000000002', '{}'),
  ('e5000000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000001',
   'SENTINEL-TITLE-6-zq7', 'appointment', 'high', true, 'in_progress', 'approved',
   null, '{}');
insert into public.part_missing_details (id, household_id, care_chain_id, care_step_id, kind, question_code)
values
  ('e6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000005', 'location', 'which_clinic'),
  ('e6000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000005', 'person', 'which_person'),
  ('e6000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-000000000005', 'document', 'which_document');

-- ---------------------------------------------------------------------------
-- 2 and 3. The driver: a table of calls run in order, one row per call.
-- expected = null: setup statement (not counted); '' : writes no audit event;
-- otherwise the one primary event type the call must write.
-- ---------------------------------------------------------------------------
create temp table drv (seq int primary key, label text not null, sql text not null, expected text);
create temp table seq_audit (id uuid primary key);
create temp table call_log (
  seq int primary key, label text, expected text,
  primary_types text[], primary_n int, total_n int
);

insert into drv (seq, label, sql, expected) values
  -- Part 01: claim, volunteer, release, approval round trip, time, evidence, completion
  (1,  'claim_part owner',      $q$ select public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'owner') $q$, 'part.claimed'),
  (2,  'claim_part driver',     $q$ select public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'driver') $q$, 'part.driver_volunteered'),
  (3,  'claim_part companion',  $q$ select public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000005', 'companion') $q$, 'part.companion_volunteered'),
  (4,  'release_part driver',   $q$ select public.release_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'driver') $q$, 'part.released'),
  (5,  'decide_approval reject', $q$ select public.decide_approval('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'reject') $q$, 'approval.rejected'),
  (6,  'resubmit_part',         $q$ select public.resubmit_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'SENTINEL-EXPLAIN-zq7 the clinic moved', '{}'::uuid[]) $q$, 'approval.resubmitted'),
  (7,  'decide_approval approve', $q$ select public.decide_approval('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'approve') $q$, 'approval.given'),
  (8,  'confirm_part_time appointment', $q$ select public.confirm_part_time('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $q$, 'time.confirmed'),
  (9,  'decide_approval approve again', $q$ select public.decide_approval('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'approve') $q$, 'approval.given'),
  (10, 'record_evidence receipt', $q$ select public.record_evidence('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'Receipt for SENTINEL-MEDS-zq7', 'text', null, 'SENTINEL-EVTEXT-zq7 receipt total') $q$, 'evidence.uploaded'),
  (11, 'complete_part missing evidence', $q$ select public.complete_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004') $q$, 'part.evidence_missing'),
  (12, 'record_evidence photo', $q$ select public.record_evidence('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'Photo', 'text', null, 'SENTINEL-EVTEXT-zq7 second note') $q$, 'evidence.uploaded'),
  (13, 'complete_part',         $q$ select public.complete_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004') $q$, 'part.completed'),
  -- Part 02: amount, task due time, failure, reopen
  (14, 'save_part_amount',      $q$ select public.save_part_amount('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 987654321, 'JPY') $q$, 'missing_detail.resolved'),
  (15, 'confirm_part_time task_due', $q$ select public.confirm_part_time('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 'task_due', '2026-12-07 03:00:00+00', 'Asia/Tokyo') $q$, 'time.confirmed'),
  (16, 'report_part_failed',    $q$ select public.report_part_failed('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000004', 'clinic_closed') $q$, 'part.failed'),
  (17, 'reopen_part',           $q$ select public.reopen_part('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002') $q$, 'part.reopened'),
  -- Part 03: handover (accept, decline, expired by answer)
  (18, 'request_handover accepted path', $q$ select public.request_handover('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004', 'owner', 'd2000000-0000-4000-8000-000000000003') $q$, 'handover.requested'),
  (19, 'respond_to_request handover accept', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'handover' and status = 'pending'), 'd1000000-0000-4000-8000-000000000003', true) $q$, 'handover.accepted'),
  (20, 'request_handover declined path', $q$ select public.request_handover('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 'owner', 'd2000000-0000-4000-8000-000000000005') $q$, 'handover.requested'),
  (21, 'respond_to_request handover decline', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'handover' and status = 'pending'), 'd1000000-0000-4000-8000-000000000005', false) $q$, 'handover.declined'),
  (22, 'request_handover expiry path', $q$ select public.request_handover('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 'owner', 'd2000000-0000-4000-8000-000000000005') $q$, 'handover.requested'),
  (23, 'setup: expire the handover', $q$ update public.care_requests set expires_at = now() - interval '1 hour' where care_step_id = 'e5000000-0000-4000-8000-000000000003' and status = 'pending' $q$, null),
  (24, 'respond_to_request handover after expiry', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'handover' and status = 'pending'), 'd1000000-0000-4000-8000-000000000005', true) $q$, 'handover.not_accepted'),
  -- Part 03: assignment (accept, decline, sweep expiry)
  (25, 'request_assignment accepted path', $q$ select public.request_assignment('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000005') $q$, 'assignment.requested'),
  (26, 'respond_to_request assignment accept', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'assignment' and status = 'pending'), 'd1000000-0000-4000-8000-000000000005', true) $q$, 'assignment.accepted'),
  (27, 'request_assignment declined path', $q$ select public.request_assignment('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') $q$, 'assignment.requested'),
  (28, 'respond_to_request assignment decline', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'assignment' and status = 'pending'), 'd1000000-0000-4000-8000-000000000003', false) $q$, 'assignment.declined'),
  (29, 'request_assignment expiry path', $q$ select public.request_assignment('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') $q$, 'assignment.requested'),
  (30, 'setup: expire the assignment', $q$ update public.care_requests set expires_at = now() - interval '1 hour' where care_step_id = 'e5000000-0000-4000-8000-000000000003' and status = 'pending' $q$, null),
  (31, 'expire_care_requests assignment', $q$ select public.expire_care_requests('d0000000-0000-4000-8000-000000000001', now()) $q$, 'assignment.expired'),
  -- Part 03: backup request (accept, decline, sweep expiry); Aiko is the Owner now
  (32, 'request_backup accepted path', $q$ select public.request_backup('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000003') $q$, 'backup.requested'),
  (33, 'respond_to_request backup accept', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'backup' and status = 'pending'), 'd1000000-0000-4000-8000-000000000003', true) $q$, 'backup.accepted'),
  (34, 'request_backup declined path', $q$ select public.request_backup('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000004') $q$, 'backup.requested'),
  (35, 'respond_to_request backup decline', $q$ select public.respond_to_request((select id from public.care_requests where care_step_id = 'e5000000-0000-4000-8000-000000000003' and kind = 'backup' and status = 'pending'), 'd1000000-0000-4000-8000-000000000004', false) $q$, 'backup.declined'),
  (36, 'request_backup expiry path', $q$ select public.request_backup('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000004') $q$, 'backup.requested'),
  (37, 'setup: expire the backup request', $q$ update public.care_requests set expires_at = now() - interval '1 hour' where care_step_id = 'e5000000-0000-4000-8000-000000000003' and status = 'pending' $q$, null),
  (38, 'expire_care_requests backup', $q$ select public.expire_care_requests('d0000000-0000-4000-8000-000000000001', now()) $q$, 'backup.expired'),
  -- Part 04: volunteer as Backup_Owner
  (39, 'volunteer_backup',      $q$ select public.volunteer_backup('e5000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000003') $q$, 'backup.accepted'),
  -- Part 05: missing details with sensitive answers, then Self_Approval
  (40, 'resolve_missing_detail location', $q$ select public.resolve_missing_detail('e6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'SENTINEL-CLINIC-zq7 Fake Hospital, 1-2-3 Fake Street') $q$, 'missing_detail.resolved'),
  (41, 'resolve_missing_detail person', $q$ select public.resolve_missing_detail('e6000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 'SENTINEL-PERSON-zq7') $q$, 'missing_detail.resolved'),
  (42, 'resolve_missing_detail document', $q$ select public.resolve_missing_detail('e6000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 'SENTINEL-ANSWER-zq7 insurance card') $q$, 'missing_detail.resolved'),
  (43, 'decide_approval self approval', $q$ select public.decide_approval('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000002', 'approve') $q$, 'approval.given'),
  -- Read marker and language
  (44, 'mark_feed_seen',        $q$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', now()) $q$, ''),
  (45, 'set_member_language',   $q$ select public.set_member_language('d1000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'ja') $q$, 'member.language_changed'),
  -- Part 06: replaced legacy function (its payload is a documented legacy shape)
  (46, 'save_appointment_clarification', $q$ select public.save_appointment_clarification('e5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 'SENTINEL-LEGACYCLINIC-zq7', '2026-12-08 01:00:00+00', 'Asia/Tokyo') $q$, 'appointment_clarified');

do $do$
declare
  r record;
  v_before uuid[];
  v_new uuid[];
begin
  for r in select * from drv order by seq loop
    if r.expected is null then
      execute r.sql;
      continue;
    end if;
    select coalesce(array_agg(a.id), '{}') into v_before
    from public.audit_events a where a.household_id = 'd0000000-0000-4000-8000-000000000001';
    execute r.sql;
    select coalesce(array_agg(a.id), '{}') into v_new
    from public.audit_events a
    where a.household_id = 'd0000000-0000-4000-8000-000000000001'
      and a.id <> all (v_before);
    insert into seq_audit (id) select unnest(v_new);
    insert into call_log (seq, label, expected, primary_types, primary_n, total_n)
    select r.seq, r.label, r.expected,
           coalesce(array_agg(a.event_type order by a.created_at)
             filter (where a.event_type not in ('approval.reset', 'reminder.sent')), '{}'),
           (count(*) filter (where a.event_type not in ('approval.reset', 'reminder.sent')))::int,
           count(*)::int
    from public.audit_events a
    where a.id = any (v_new);
  end loop;
end
$do$;

-- ---------------------------------------------------------------------------
-- 3. Every call wrote exactly one primary audit event (table-driven)
-- ---------------------------------------------------------------------------
select ok(
  case when expected = '' then total_n = 0
       else primary_n = 1 and primary_types = array[expected] end,
  'seq ' || seq || ' ' || label || ' writes exactly one primary event '
    || case when expected = '' then '(none)' else expected end
)
from call_log order by seq;

select is((select count(*)::int from call_log), 43, 'All 43 counted calls ran');

-- Consequences are limited to approval.reset and reminder.sent: nothing else extra.
select is_empty(
  $$ select seq, label from call_log
     where expected <> '' and total_n < primary_n $$,
  'No call logged fewer events than its primary events'
);

-- Every state-changing public function is exercised at least once.
select is_empty(
  $$ select f.name from (values
       ('claim_part'), ('release_part'), ('request_assignment'), ('request_handover'),
       ('request_backup'), ('volunteer_backup'), ('respond_to_request'),
       ('expire_care_requests'), ('decide_approval'), ('resubmit_part'), ('complete_part'),
       ('report_part_failed'), ('reopen_part'), ('record_evidence'), ('confirm_part_time'),
       ('save_part_amount'), ('resolve_missing_detail'), ('set_member_language'),
       ('save_appointment_clarification')
     ) as f(name)
     where not exists (
       select 1 from call_log c where split_part(c.label, ' ', 1) = f.name
     ) $$,
  'Every audit-writing function appears in the driver'
);

-- Each primary household event has exactly one household Feed_Item (4.2, 4.10).
select is_empty(
  $$ select a.id, a.event_type
     from public.audit_events a join seq_audit s on s.id = a.id
     where a.event_type not in ('approval.reset', 'reminder.sent', 'member.language_changed')
       and (select count(*) from public.feed_items f
            where f.audit_event_id = a.id and f.recipient_member_id is null) <> 1 $$,
  'Every primary event has exactly one household Feed_Item'
);

-- Every reminder event has exactly one Feed_Item addressed to one Member.
select is_empty(
  $$ select a.id
     from public.audit_events a join seq_audit s on s.id = a.id
     where a.event_type = 'reminder.sent'
       and (select count(*) from public.feed_items f
            where f.audit_event_id = a.id and f.recipient_member_id is not null) <> 1 $$,
  'Every reminder.sent event has exactly one addressed Feed_Item'
);

-- ---------------------------------------------------------------------------
-- 2. Payload hygiene
-- ---------------------------------------------------------------------------
-- Sanity: the sensitive text really went into its own tables (so the checks
-- below are not vacuous).
select is(
  (select count(*)::int from public.part_resubmissions
   where care_step_id = 'e5000000-0000-4000-8000-000000000001'
     and explanation like 'SENTINEL-EXPLAIN-zq7%'),
  1, 'The explanation text is stored in part_resubmissions'
);
select is(
  (select count(*)::int from public.part_evidence
   where care_step_id = 'e5000000-0000-4000-8000-000000000001'
     and text_body like 'SENTINEL-EVTEXT-zq7%'),
  2, 'The evidence text is stored in part_evidence'
);
select is(
  (select count(*)::int from public.part_missing_details
   where care_step_id = 'e5000000-0000-4000-8000-000000000005'
     and answer in ('SENTINEL-PERSON-zq7', 'SENTINEL-ANSWER-zq7 insurance card',
                    'SENTINEL-CLINIC-zq7 Fake Hospital, 1-2-3 Fake Street')),
  3, 'The Missing_Detail answers are stored in part_missing_details'
);
select is(
  (select required_amount_minor from public.care_steps where id = 'e5000000-0000-4000-8000-000000000002'),
  987654321::bigint, 'The amount is stored on the Part'
);

-- No sentinel in any audit payload of the sequence (the legacy appointment_clarified
-- event is checked separately below).
select is_empty(
  format($$ select a.event_type from public.audit_events a join seq_audit s on s.id = a.id
     where a.event_type <> 'appointment_clarified' and a.payload::text like %L $$, '%' || p.pat || '%'),
  'No audit payload contains ' || p.what
)
from (values
  ('SENTINEL-EXPLAIN', 'the resubmission explanation'),
  ('SENTINEL-EVTEXT', 'the evidence text'),
  ('SENTINEL-ANSWER', 'a Missing_Detail answer'),
  ('SENTINEL-CLINIC', 'a clinic name'),
  ('SENTINEL-PERSON', 'a person to ask'),
  ('SENTINEL-MEDS', 'a medication name'),
  ('SENTINEL-TITLE', 'a Part title'),
  ('SENTINEL-CHAIN', 'a Care Chain title'),
  ('987654321', 'the amount'),
  ('SENTINEL', 'any sentinel')
) as p(pat, what);

-- No sentinel in any Feed_Item params of the sequence.
select is_empty(
  format($$ select f.kind from public.feed_items f join seq_audit s on s.id = f.audit_event_id
     where f.params::text like %L $$, '%' || p.pat || '%'),
  'No Feed_Item params contain ' || p.what
)
from (values
  ('SENTINEL-EXPLAIN', 'the resubmission explanation'),
  ('SENTINEL-EVTEXT', 'the evidence text'),
  ('SENTINEL-ANSWER', 'a Missing_Detail answer'),
  ('SENTINEL-CLINIC', 'a clinic name'),
  ('SENTINEL-PERSON', 'a person to ask'),
  ('SENTINEL-MEDS', 'a medication name'),
  ('SENTINEL-TITLE', 'a Part title'),
  ('987654321', 'the amount'),
  ('SENTINEL', 'any sentinel')
) as p(pat, what);

-- No Member name in a payload or in Feed_Item params (names are looked up by ID).
select is_empty(
  $$ select a.event_type, m.display_name
     from public.audit_events a
     join seq_audit s on s.id = a.id
     join public.household_members m on m.household_id = a.household_id
     where a.event_type <> 'appointment_clarified'
       and a.payload::text ilike '%' || split_part(m.display_name, ' ', 1) || '%' $$,
  'No audit payload contains a Member name'
);
select is_empty(
  $$ select f.kind, m.display_name
     from public.feed_items f
     join seq_audit s on s.id = f.audit_event_id
     join public.household_members m on m.household_id = f.household_id
     where f.params::text ilike '%' || split_part(m.display_name, ' ', 1) || '%' $$,
  'No Feed_Item params contain a Member name'
);

-- Allow-list from the design: IDs, codes, counts, ISO times, and zone names.
create temp table payload_allow (event_type text primary key, keys text[] not null);
insert into payload_allow (event_type, keys) values
  ('part.claimed', array['role', 'member_id']),
  ('part.released', array['role', 'member_id']),
  ('part.driver_volunteered', array['role', 'member_id']),
  ('part.companion_volunteered', array['role', 'member_id']),
  ('assignment.requested', array['request_id', 'receiver_member_id', 'expires_at', 'expiry_rule', 'role']),
  ('handover.requested', array['request_id', 'receiver_member_id', 'expires_at', 'expiry_rule', 'role']),
  ('backup.requested', array['request_id', 'receiver_member_id', 'expires_at', 'expiry_rule']),
  ('assignment.accepted', array['request_id', 'role']),
  ('handover.accepted', array['request_id', 'role']),
  ('backup.accepted', array['request_id', 'volunteered']),
  ('assignment.declined', array['request_id']),
  ('handover.declined', array['request_id', 'reason']),
  ('backup.declined', array['request_id']),
  ('assignment.expired', array['request_id', 'role']),
  ('handover.not_accepted', array['request_id', 'role']),
  ('backup.expired', array['request_id']),
  ('approval.given', array['self_approval']),
  ('approval.rejected', array['plan_version']),
  ('approval.reset', array['changed']),
  ('approval.resubmitted', array['resubmission_id', 'added', 'evidence_count']),
  ('time.confirmed', array['kind', 'timezone', 'at', 'member_id']),
  ('missing_detail.resolved', array['kind', 'changed', 'detail_id']),
  ('evidence.uploaded', array['kind', 'evidence_id']),
  ('part.evidence_missing', array['missing_count']),
  ('part.completed', array[]::text[]),
  ('part.failed', array['reason_code']),
  ('part.reopened', array[]::text[]),
  ('part.escalated', array['reason']),
  ('reminder.sent', array['channel', 'recipient_member_id', 'kind']),
  ('member.language_changed', array['language']),
  ('recipient.replied', array['reply']);

select is_empty(
  $$ select a.event_type from public.audit_events a join seq_audit s on s.id = a.id
     where a.event_type <> 'appointment_clarified'
       and a.event_type not in (select event_type from payload_allow) $$,
  'Every event type written by the sequence is on the allow-list'
);

select is_empty(
  $$ select distinct a.event_type, k.key
     from public.audit_events a
     join seq_audit s on s.id = a.id
     join payload_allow l on l.event_type = a.event_type
     cross join lateral jsonb_object_keys(a.payload) as k(key)
     where k.key <> all (l.keys) $$,
  'Every payload key is on the allow-list of its event type'
);

select is_empty(
  $$ select want from unnest(array[
       'part.claimed', 'part.released', 'part.driver_volunteered', 'part.companion_volunteered',
       'assignment.requested', 'assignment.accepted', 'assignment.declined', 'assignment.expired',
       'handover.requested', 'handover.accepted', 'handover.declined', 'handover.not_accepted',
       'backup.requested', 'backup.accepted', 'backup.declined', 'backup.expired',
       'approval.given', 'approval.rejected', 'approval.reset', 'approval.resubmitted',
       'time.confirmed', 'missing_detail.resolved', 'evidence.uploaded', 'part.evidence_missing',
       'part.completed', 'part.failed', 'part.reopened', 'reminder.sent', 'member.language_changed'
     ]) as want
     where want not in (
       select a.event_type from public.audit_events a join seq_audit s on s.id = a.id
     ) $$,
  'The sequence exercised every allow-listed event type'
);

-- Every string value (at any depth) is an ID, a code, an ISO time, or a zone name.
select is_empty(
  $$ select a.event_type, v #>> '{}' as value
     from public.audit_events a
     join seq_audit s on s.id = a.id
     cross join lateral jsonb_path_query(a.payload, 'strict $.**') as v
     where a.event_type <> 'appointment_clarified'
       and jsonb_typeof(v) = 'string'
       and not (
         v #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or v #>> '{}' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$'
         or v #>> '{}' ~ '^[a-z0-9][a-z0-9_]{0,59}$'
         or v #>> '{}' ~ '^[A-Za-z]+(/[A-Za-z0-9_+-]+)+$'
       ) $$,
  'Every audit payload string is an ID, code, ISO time, or zone name'
);

-- Same allow-list for Feed_Item params: codes, IDs, flags, and counts.
select is_empty(
  $$ select f.kind, k.key
     from public.feed_items f
     join seq_audit s on s.id = f.audit_event_id
     cross join lateral jsonb_object_keys(f.params) as k(key)
     where k.key not in ('role', 'needs_someone', 'request_id', 'self_approval', 'added',
                         'kind', 'reason_code', 'needs_attention', 'missing_count', 'volunteered') $$,
  'Every Feed_Item params key is on the allow-list'
);
select is_empty(
  $$ select f.kind, v #>> '{}' as value
     from public.feed_items f
     join seq_audit s on s.id = f.audit_event_id
     cross join lateral jsonb_path_query(f.params, 'strict $.**') as v
     where jsonb_typeof(v) = 'string'
       and not (
         v #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or v #>> '{}' ~ '^[a-z0-9][a-z0-9_]{0,59}$'
       ) $$,
  'Every Feed_Item params string is an ID or a code'
);

-- The legacy appointment_clarified payload keeps its documented shape. It stores
-- the location the person typed (design: "Existing note.uploaded and
-- appointment_clarified stay"); it is not part of the new allow-list.
select is_empty(
  $$ select distinct k.key
     from public.audit_events a
     join seq_audit s on s.id = a.id
     cross join lateral jsonb_object_keys(a.payload) as k(key)
     where a.event_type = 'appointment_clarified'
       and k.key not in ('location', 'appointment_time', 'timezone', 'clarified_by',
                         'clarified_by_member_id', 'previous') $$,
  'The legacy appointment_clarified payload keys are unchanged'
);
select is(
  (select count(*)::int from public.feed_items f join seq_audit s on s.id = f.audit_event_id
   where f.kind = 'appointment_clarified' and f.params = '{}'::jsonb),
  1, 'The appointment_clarified Feed_Item carries no text'
);

-- ---------------------------------------------------------------------------
-- 4. audit_events is append-only for client roles (Requirement 14.4)
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'audit_events'
     and grantee in ('anon', 'authenticated', 'public')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
  0, 'No client role holds a write privilege on audit_events'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select throws_ok(
  $$ insert into public.audit_events (household_id, actor_type, actor_id, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'human', 'd1000000-0000-4000-8000-000000000002', 'part.completed') $$,
  '42501', null, 'authenticated cannot insert audit events'
);
select throws_ok(
  $$ update public.audit_events set payload = '{}' $$,
  '42501', null, 'authenticated cannot update audit events'
);
select throws_ok(
  $$ delete from public.audit_events $$,
  '42501', null, 'authenticated cannot delete audit events'
);
reset role;

set local role anon;
select throws_ok(
  $$ insert into public.audit_events (household_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'system', 'part.completed') $$,
  '42501', null, 'anon cannot insert audit events'
);
select throws_ok(
  $$ update public.audit_events set payload = '{}' $$,
  '42501', null, 'anon cannot update audit events'
);
select throws_ok(
  $$ delete from public.audit_events $$,
  '42501', null, 'anon cannot delete audit events'
);
reset role;

select is(
  (select count(*)::int from public.audit_events a join seq_audit s on s.id = a.id),
  (select count(*)::int from seq_audit),
  'The sequence audit events are all still present after the refused writes'
);

select * from finish();
rollback;
