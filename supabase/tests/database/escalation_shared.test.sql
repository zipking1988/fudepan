-- pgTAP tests for public.escalate_due_parts (migration 20261210000500_escalation_functions).
-- Requirements 8.13, 12.1-12.14, decision D-3.
-- Uses the demo household from seed.sql plus a fake outsider household. All new
-- rows are fake and rolled back. Demo members (user ids d1..0N):
--   Haruko d2..01 care_recipient, Misa d2..02 primary_caregiver, Kenta d2..03
--   finance_coordinator, Yui d2..04 transport_coordinator, Aiko d2..05
--   professional_caregiver. Added here: Pat a2..02, an inactive primary_caregiver.
-- Fixed clock: p_now = 2030-01-10T00:00:00Z, "past" = 2030-01-09, "future" = 2030-01-11.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'outsider.escalation.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'inactive.escalation.test@example.com', now(), now());
insert into public.households (id, name)
values ('a0000000-0000-4000-8000-000000000001', 'Escalation outsider household');
insert into public.household_members (id, household_id, user_id, display_name, role, is_active)
values
  ('a2000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001', 'Outsider Primary', 'primary_caregiver', true),
  ('a2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000002', 'Pat Inactive', 'primary_caregiver', true);
insert into public.notes (id, household_id, uploaded_by, image_path, status)
values
  ('a3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-000000000001/1763700000000-note.png',
   'pending_review'),
  ('a3000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'a1000000-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-000000000002/1763700000000-note.png',
   'pending_review');
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values
  ('a4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'a3000000-0000-4000-8000-000000000001', 'SENTINEL-ESC-CHAIN', 'high'),
  ('a4000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001',
   'a3000000-0000-4000-8000-000000000002', 'Outsider chain', 'high');

-- Parts (ids a5...0000000NN, hex). Misa d2..02 is the confirming member.
-- 01 high, unclaimed, backup Aiko, respond_by past            -> respond_by: Misa + Aiko
-- 02 high, owner Yui, respond_by past                         -> claimed: no respond_by escalation
-- 03 high, owner Yui, backup Kenta, task_due past, approved   -> task_due: Yui + Kenta
-- 04 high, unclaimed, model_suggested respond_by + task_due past -> ignored
-- 05 high, legacy due_at + escalation_at past only            -> ignored
-- 06 high, completed, task_due past                           -> closed
-- 07 high, cancelled, task_due past                           -> closed
-- 08 high, failed, owner Yui, task_due past, no ledger        -> skipped, escalates after reopen
-- 09 high, failed, owner Yui, task_due past, ledger row       -> not re-escalated after reopen
-- 0a low risk, unclaimed, respond_by + task_due past          -> no escalation, no reminders
-- 0b high, unclaimed, backup Misa, respond_by past            -> respond_by: Misa once (deduped)
-- 0c high, owner Yui, backup Pat (inactive), task_due past    -> task_due: Yui only
-- 0d low risk, unclaimed, pending assignment request          -> request expired, no escalation
-- 0e high, owner Yui, pending handover request (task_due rule), task_due past
--                                                              -> request expired, then escalated, Owner stays Yui
-- 0f high, owner Yui, model_suggested task_due past           -> ignored
-- 10 high, unclaimed, future respond_by and task_due          -> not yet
-- 11 outsider household: high, unclaimed, respond_by past
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, owner_id, backup_owner_id, due_at, escalation_at,
  respond_by_at, respond_by_timezone, respond_by_provenance, respond_by_set_by,
  task_due_at, task_due_timezone, task_due_provenance, task_due_set_by
)
values
  ('a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-01', 'appointment', 'high', true, 'pending_review', 'pending',
   null, 'd2000000-0000-4000-8000-000000000005', null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002',
   null, null, null, null),
  ('a5000000-0000-4000-8000-000000000002', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-02', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002',
   null, null, null, null),
  ('a5000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-03', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003', null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-000000000004', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-04', 'appointment', 'high', true, 'pending_review', 'pending',
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'model_suggested', null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'model_suggested', null),
  ('a5000000-0000-4000-8000-000000000005', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-05', 'appointment', 'high', true, 'pending_review', 'pending',
   null, null, '2030-01-09T00:00:00Z', '2030-01-09T00:00:00Z',
   null, null, null, null, null, null, null, null),
  ('a5000000-0000-4000-8000-000000000006', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-06', 'appointment', 'high', true, 'completed', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-000000000007', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-07', 'appointment', 'high', true, 'cancelled', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-000000000008', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-08', 'appointment', 'high', true, 'failed', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-000000000009', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-09', 'appointment', 'high', true, 'failed', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-0a', 'household', 'low', false, 'in_progress', 'not_required',
   null, 'd2000000-0000-4000-8000-000000000003', null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002',
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-00000000000b', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-0b', 'appointment', 'high', true, 'pending_review', 'approved',
   null, 'd2000000-0000-4000-8000-000000000002', null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002',
   null, null, null, null),
  ('a5000000-0000-4000-8000-00000000000c', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-0c', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', 'a2000000-0000-4000-8000-000000000002', null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-00000000000d', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-0d', 'household', 'low', false, 'in_progress', 'not_required',
   null, null, null, null,
   null, null, null, null, null, null, null, null),
  ('a5000000-0000-4000-8000-00000000000e', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-0e', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-00000000000f', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-0f', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, null,
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'model_suggested', null),
  ('a5000000-0000-4000-8000-000000000010', 'a4000000-0000-4000-8000-000000000001',
   'SENTINEL-ESC-10', 'appointment', 'high', true, 'pending_review', 'pending',
   null, null, null, null,
   '2030-01-11T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002',
   '2030-01-11T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'd2000000-0000-4000-8000-000000000002'),
  ('a5000000-0000-4000-8000-000000000011', 'a4000000-0000-4000-8000-000000000002',
   'Outsider part', 'appointment', 'high', true, 'pending_review', 'pending',
   null, null, null, null,
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'a2000000-0000-4000-8000-000000000001',
   null, null, null, null);

-- Pat held a backup role and has since left (the owner trigger only allows active members at write time).
update public.household_members set is_active = false where id = 'a2000000-0000-4000-8000-000000000002';

-- Step 09 was already escalated for its current Task_Due_Time (ledger row).
insert into public.step_escalations (household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id)
values ('d0000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
        'a5000000-0000-4000-8000-000000000009', 'task_due', '2030-01-09T00:00:00Z',
        private.write_audit('d0000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001',
          'a5000000-0000-4000-8000-000000000009', null, 'system', null, 'part.escalated',
          '{"reason": "task_due"}'::jsonb));

-- Pending requests that expire before the sweep: an assignment on step 0d (Misa to
-- Kenta) and an Owner Handover on step 0e (Yui to Kenta, expires at the Task_Due_Time).
select public.request_assignment('a5000000-0000-4000-8000-00000000000d',
  'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003');
select public.request_handover('a5000000-0000-4000-8000-00000000000e',
  'd1000000-0000-4000-8000-000000000004', 'owner', 'd2000000-0000-4000-8000-000000000003');
update public.care_requests set expires_at = '2030-01-09T00:00:00Z'
where care_step_id = 'a5000000-0000-4000-8000-00000000000d';

create temp table orig as
select s.id, s.status, s.approval_state, s.plan_version, s.owner_id
from public.care_steps s
where s.care_chain_id in ('a4000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000002');
create temp table runs (n int primary key, r jsonb not null);

-- ---------------------------------------------------------------------------
-- Function exists, privileges, input
-- ---------------------------------------------------------------------------
select has_function('public', 'escalate_due_parts', array['uuid', 'timestamp with time zone'],
  'escalate_due_parts(uuid, timestamptz) exists');
select is(
  (select p.prorettype::regtype::text from pg_proc p where p.oid = to_regprocedure('public.escalate_due_parts(uuid, timestamptz)')),
  'jsonb', 'escalate_due_parts returns jsonb'
);
select ok(
  has_function_privilege('service_role', 'public.escalate_due_parts(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.escalate_due_parts(uuid, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.escalate_due_parts(uuid, timestamptz)', 'execute')
  and not exists (
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = to_regprocedure('public.escalate_due_parts(uuid, timestamptz)')
      and a.privilege_type = 'EXECUTE' and a.grantee = 0),
  'Only service_role can execute escalate_due_parts'
);
set local role anon;
select throws_ok(
  $$ select public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z') $$,
  '42501', null, 'An anonymous session is denied'
);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select throws_ok(
  $$ select public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z') $$,
  '42501', null, 'A signed-in member is denied'
);
reset role;
select throws_ok(
  $$ select public.escalate_due_parts(null, null) $$,
  'P0001', 'invalid_input', 'A null p_now is refused as invalid_input'
);

-- ---------------------------------------------------------------------------
-- Run 1: demo household only
-- ---------------------------------------------------------------------------
insert into runs
select 1, public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z');

select is(
  (select r from runs where n = 1),
  '{"escalated": 5, "expired_requests": 2}'::jsonb,
  'Run 1 escalates five Parts and expires two requests'
);
select is(
  (select array_agg(s.id order by s.id) from public.care_steps s
   where s.care_chain_id = 'a4000000-0000-4000-8000-000000000001' and s.status = 'escalated'),
  array['a5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000003',
        'a5000000-0000-4000-8000-00000000000b', 'a5000000-0000-4000-8000-00000000000c',
        'a5000000-0000-4000-8000-00000000000e']::uuid[],
  'Exactly the unclaimed respond-by Parts and the task-due Parts are escalated'
);
select is(
  (select status from public.care_steps where id = 'a5000000-0000-4000-8000-000000000002'),
  'in_progress', 'A claimed Part with a past Respond_By_Time is not escalated'
);
select is(
  (select count(*)::int from public.care_steps s join orig o on o.id = s.id
   where s.id in ('a5000000-0000-4000-8000-000000000004', 'a5000000-0000-4000-8000-00000000000f',
                  'a5000000-0000-4000-8000-000000000005')
     and s.status = o.status
     and not exists (select 1 from public.step_escalations e where e.care_step_id = s.id)),
  3, 'Model-suggested times and legacy due_at/escalation_at are ignored'
);
select is(
  (select count(*)::int from public.care_steps s join orig o on o.id = s.id
   where s.id in ('a5000000-0000-4000-8000-000000000006', 'a5000000-0000-4000-8000-000000000007')
     and s.status = o.status
     and not exists (select 1 from public.step_escalations e where e.care_step_id = s.id)),
  2, 'Completed and cancelled Parts never escalate'
);
select is(
  (select count(*)::int from public.care_steps s
   where s.id in ('a5000000-0000-4000-8000-000000000008', 'a5000000-0000-4000-8000-000000000009')
     and s.status = 'failed'),
  2, 'Failed Parts are skipped'
);
select is(
  (select count(*)::int from public.care_steps s join orig o on o.id = s.id
   where s.id in ('a5000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-000000000010')
     and s.status = o.status
     and not exists (select 1 from public.step_escalations e where e.care_step_id = s.id)),
  2, 'A low-risk Part and a future deadline do not escalate'
);
select is_empty(
  $$ select a.care_step_id from public.audit_events a
     where a.care_step_id in (
       'a5000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000004',
       'a5000000-0000-4000-8000-000000000005', 'a5000000-0000-4000-8000-000000000006',
       'a5000000-0000-4000-8000-000000000007', 'a5000000-0000-4000-8000-00000000000a',
       'a5000000-0000-4000-8000-00000000000f', 'a5000000-0000-4000-8000-000000000010') $$,
  'No audit event, feed item, or reminder is written for Parts that do not escalate'
);

-- Ledger
select is(
  (select count(*)::int from public.step_escalations e
   join public.care_steps s on s.id = e.care_step_id
   where e.household_id = 'd0000000-0000-4000-8000-000000000001'
     and ((e.deadline_kind = 'respond_by' and e.deadline_at = s.respond_by_at)
       or (e.deadline_kind = 'task_due' and e.deadline_at = s.task_due_at))),
  6, 'The ledger holds one row per escalated deadline value (plus the prepared row of step 09)'
);
select is(
  (select string_agg(e.care_step_id::text || ':' || e.deadline_kind, ',' order by e.care_step_id)
   from public.step_escalations e
   where e.household_id = 'd0000000-0000-4000-8000-000000000001'
     and e.care_step_id <> 'a5000000-0000-4000-8000-000000000009'),
  'a5000000-0000-4000-8000-000000000001:respond_by,a5000000-0000-4000-8000-000000000003:task_due,'
  || 'a5000000-0000-4000-8000-00000000000b:respond_by,a5000000-0000-4000-8000-00000000000c:task_due,'
  || 'a5000000-0000-4000-8000-00000000000e:task_due',
  'Each ledger row carries the right deadline kind'
);

-- Audit and feed
select is(
  (select count(*)::int from public.audit_events
   where household_id = 'd0000000-0000-4000-8000-000000000001' and event_type = 'part.escalated'
     and care_step_id <> 'a5000000-0000-4000-8000-000000000009'),
  5, 'One part.escalated audit event per escalated Part'
);
select is(
  (select count(*)::int from public.audit_events
   where event_type = 'part.escalated' and actor_type = 'system' and actor_id is null
     and ((care_step_id in ('a5000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-00000000000b')
           and payload = '{"reason": "respond_by"}'::jsonb)
       or (care_step_id in ('a5000000-0000-4000-8000-000000000003', 'a5000000-0000-4000-8000-00000000000c',
                            'a5000000-0000-4000-8000-00000000000e')
           and payload = '{"reason": "task_due"}'::jsonb))),
  5, 'The audit events are system events with payload {reason} only'
);
select is(
  (select count(*)::int from public.step_escalations e
   join public.audit_events a on a.id = e.audit_event_id
   where a.event_type = 'part.escalated' and a.care_step_id = e.care_step_id
     and e.household_id = 'd0000000-0000-4000-8000-000000000001'),
  6, 'Each ledger row points at its part.escalated audit event'
);
select is(
  (select count(*)::int from public.feed_items f
   join public.audit_events a on a.id = f.audit_event_id
   where f.kind = 'part_escalated' and f.recipient_member_id is null
     and a.event_type = 'part.escalated'
     and f.params ->> 'reason' = a.payload ->> 'reason'
     and jsonb_typeof(f.params -> 'notified') = 'array'),
  5, 'One household Feed_Item per escalation, with the reason and the notified member ids'
);
select is(
  (select f.params -> 'notified' from public.feed_items f
   where f.kind = 'part_escalated' and f.care_step_id = 'a5000000-0000-4000-8000-000000000001'),
  '["d2000000-0000-4000-8000-000000000002", "d2000000-0000-4000-8000-000000000005"]'::jsonb,
  'The Feed_Item names the members notified (ids only)'
);

-- Reminders: recipients per deadline kind, only active same-household members, deduplicated
select is(
  (select array_agg(f.recipient_member_id order by f.recipient_member_id) from public.feed_items f
   where f.care_step_id = 'a5000000-0000-4000-8000-000000000001' and f.kind = 'escalated_respond_by'),
  array['d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000005']::uuid[],
  'Respond-by with no Owner reminds the active Primary_Caregiver and the Backup_Owner, not the inactive one'
);
select is(
  (select array_agg(f.recipient_member_id) from public.feed_items f
   where f.care_step_id = 'a5000000-0000-4000-8000-00000000000b' and f.kind = 'escalated_respond_by'),
  array['d2000000-0000-4000-8000-000000000002']::uuid[],
  'A Backup_Owner who is also the Primary_Caregiver gets one reminder'
);
select is(
  (select array_agg(f.recipient_member_id order by f.recipient_member_id) from public.feed_items f
   where f.care_step_id = 'a5000000-0000-4000-8000-000000000003' and f.kind = 'escalated_task_due'),
  array['d2000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004']::uuid[],
  'Task-due reminds the Owner and the Backup_Owner'
);
select is(
  (select array_agg(f.recipient_member_id) from public.feed_items f
   where f.care_step_id = 'a5000000-0000-4000-8000-00000000000c' and f.kind = 'escalated_task_due'),
  array['d2000000-0000-4000-8000-000000000004']::uuid[],
  'An inactive Backup_Owner is not reminded'
);
select is(
  (select count(*)::int from public.audit_events a
   where a.event_type = 'reminder.sent' and a.payload ->> 'kind' like 'escalated\_%'),
  7, 'One reminder.sent audit event per escalation reminder'
);
select is_empty(
  $$ select f.id from public.feed_items f
     left join public.household_members m on m.id = f.recipient_member_id
     where f.kind like 'escalated\_%'
       and (m.id is null or not m.is_active or m.household_id <> f.household_id) $$,
  'Escalation reminders go only to active members of the same household'
);

-- Payload hygiene
select is_empty(
  $$ select a.id from public.audit_events a
     where a.household_id = 'd0000000-0000-4000-8000-000000000001'
       and (a.payload::text like '%SENTINEL%'
            or exists (select 1 from public.household_members m
                       where a.payload::text ilike '%' || split_part(m.display_name, ' ', 1) || '%')) $$,
  'No audit payload contains a title or a member name'
);
select is_empty(
  $$ select f.id from public.feed_items f
     where f.household_id = 'd0000000-0000-4000-8000-000000000001'
       and (f.params::text like '%SENTINEL%'
            or exists (select 1 from public.household_members m
                       where f.params::text ilike '%' || split_part(m.display_name, ' ', 1) || '%')) $$,
  'No Feed_Item params contain a title or a member name'
);

-- approval_state is never written; an approved Part can still be completed
select is_empty(
  $$ select s.id from public.care_steps s join orig o on o.id = s.id
     where s.approval_state is distinct from o.approval_state
        or s.plan_version <> o.plan_version
        or s.owner_id is distinct from o.owner_id $$,
  'Escalation leaves approval_state, plan_version, and owners unchanged'
);
select is(
  public.complete_part('a5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'completed', 'An escalated, approved Part can still be completed by its Owner'
);

-- Expired requests are closed in the same sweep
select is(
  (select string_agg(r.kind || ':' || r.status, ',' order by r.kind) from public.care_requests r
   where r.household_id = 'd0000000-0000-4000-8000-000000000001'),
  'assignment:expired,handover:expired',
  'Both pending requests are expired by the sweep'
);
select is(
  (select count(*)::int from public.feed_items f
   where f.kind in ('assignment_expired', 'handover_expired') and f.recipient_member_id is not null),
  4, 'Both parties of each expired request get a reminder in the same sweep'
);
select is(
  (select owner_id from public.care_steps where id = 'a5000000-0000-4000-8000-00000000000e'),
  'd2000000-0000-4000-8000-000000000004'::uuid,
  'An overdue Owner Handover is expired first and the Part escalates with the requester as Owner'
);
select ok(
  (select a.created_at from public.audit_events a
   where a.care_step_id = 'a5000000-0000-4000-8000-00000000000e' and a.event_type = 'handover.not_accepted')
  < (select a.created_at from public.audit_events a
     where a.care_step_id = 'a5000000-0000-4000-8000-00000000000e' and a.event_type = 'part.escalated'),
  'The request expiry is recorded before the escalation'
);
select is(
  (select array_agg(f.recipient_member_id) from public.feed_items f
   where f.care_step_id = 'a5000000-0000-4000-8000-00000000000e' and f.kind = 'escalated_task_due'),
  array['d2000000-0000-4000-8000-000000000004']::uuid[],
  'The requester, still the Owner, is reminded of the task-due escalation'
);

-- Outsider household untouched when p_household_id is given
select is(
  (select status from public.care_steps where id = 'a5000000-0000-4000-8000-000000000011'),
  'pending_review', 'The other household Part is not escalated'
);
select is(
  (select (select count(*) from public.step_escalations where household_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.audit_events where household_id = 'a0000000-0000-4000-8000-000000000001')
        + (select count(*) from public.feed_items where household_id = 'a0000000-0000-4000-8000-000000000001'))::int,
  0, 'The other household gets no ledger row, audit event, or feed item'
);

-- ---------------------------------------------------------------------------
-- Run 2: same clock, idempotent
-- ---------------------------------------------------------------------------
insert into runs
select 2, public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z');
select is(
  (select r from runs where n = 2),
  '{"escalated": 0, "expired_requests": 0}'::jsonb,
  'A second run changes nothing'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'a5000000-0000-4000-8000-000000000001' and event_type = 'part.escalated'),
  1, 'Still one part.escalated event for the escalated Part'
);
select is(
  (select count(*)::int from public.audit_events
   where event_type = 'part.escalated' and household_id = 'd0000000-0000-4000-8000-000000000001'),
  6, 'The total of part.escalated events is unchanged (five new plus the prepared one)'
);

-- ---------------------------------------------------------------------------
-- Failed Parts: skipped until reopened, then once per deadline value
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.reopen_part('a5000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000002') $$,
  'Misa reopens failed Part 08'
);
select lives_ok(
  $$ select public.reopen_part('a5000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000002') $$,
  'Misa reopens failed Part 09'
);
select is(
  (select string_agg(id::text || '=' || status, ',' order by id) from public.care_steps
   where id in ('a5000000-0000-4000-8000-000000000008', 'a5000000-0000-4000-8000-000000000009')),
  'a5000000-0000-4000-8000-000000000008=in_progress,a5000000-0000-4000-8000-000000000009=in_progress',
  'Reopen sets the status to in_progress'
);
select is(
  (select count(*)::int from public.step_escalations where care_step_id = 'a5000000-0000-4000-8000-000000000009'),
  1, 'Reopen does not clear the ledger'
);
insert into runs
select 3, public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z');
select is(
  (select r from runs where n = 3),
  '{"escalated": 1, "expired_requests": 0}'::jsonb,
  'After the Reopen only the never-escalated Part escalates'
);
select is(
  (select string_agg(id::text || '=' || status, ',' order by id) from public.care_steps
   where id in ('a5000000-0000-4000-8000-000000000008', 'a5000000-0000-4000-8000-000000000009')),
  'a5000000-0000-4000-8000-000000000008=escalated,a5000000-0000-4000-8000-000000000009=in_progress',
  'Part 08 escalates once reopened; Part 09 is not escalated again for the same Task_Due_Time'
);
update public.care_steps set task_due_at = '2030-01-09T12:00:00Z'
where id = 'a5000000-0000-4000-8000-000000000009';
insert into runs
select 4, public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z');
select is(
  (select r from runs where n = 4),
  '{"escalated": 1, "expired_requests": 0}'::jsonb,
  'A new confirmed Task_Due_Time escalates again'
);
select is(
  (select count(*)::int from public.step_escalations
   where care_step_id = 'a5000000-0000-4000-8000-000000000009' and deadline_kind = 'task_due'),
  2, 'The ledger now holds both deadline values of Part 09'
);
select is(
  (select status from public.care_steps where id = 'a5000000-0000-4000-8000-000000000009'),
  'escalated', 'Part 09 is escalated for the new value'
);

-- A completed Part with a new deadline value still never escalates
update public.care_steps set task_due_at = '2030-01-09T18:00:00Z'
where id = 'a5000000-0000-4000-8000-000000000006';
update public.care_steps set respond_by_at = '2030-01-09T18:00:00Z', respond_by_timezone = 'Asia/Tokyo',
  respond_by_provenance = 'human_confirmed', respond_by_set_by = 'd2000000-0000-4000-8000-000000000002',
  owner_id = null
where id = 'a5000000-0000-4000-8000-000000000007';
insert into runs
select 5, public.escalate_due_parts('d0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z');
select is(
  (select r from runs where n = 5),
  '{"escalated": 0, "expired_requests": 0}'::jsonb,
  'Completed and cancelled Parts never escalate, even for a new deadline value'
);

-- ---------------------------------------------------------------------------
-- All households (null) and the service role
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  public.escalate_due_parts(null, '2030-01-10T00:00:00Z'),
  '{"escalated": 1, "expired_requests": 0}'::jsonb,
  'A null household sweeps every household (called as service_role)'
);
reset role;
select is(
  (select s.status || ':' || (select count(*) from public.step_escalations e where e.care_step_id = s.id)
   from public.care_steps s where s.id = 'a5000000-0000-4000-8000-000000000011'),
  'escalated:1', 'The other household Part escalates in the all-household sweep'
);
select is(
  (select array_agg(f.recipient_member_id) from public.feed_items f
   where f.care_step_id = 'a5000000-0000-4000-8000-000000000011' and f.kind = 'escalated_respond_by'),
  array['a2000000-0000-4000-8000-000000000001']::uuid[],
  'Only that household''s Primary_Caregiver is reminded'
);
select is(
  (select count(*)::int from public.feed_items f
   where f.recipient_member_id in (select id from public.household_members
                                   where household_id = 'd0000000-0000-4000-8000-000000000001')
     and f.household_id = 'a0000000-0000-4000-8000-000000000001'),
  0, 'No demo household member is reminded about the other household'
);

select * from finish();
rollback;
