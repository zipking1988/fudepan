-- pgTAP tests for public.claim_part and public.release_part
-- (migration 20261210000300_shared_care_functions).
-- Uses the demo household from seed.sql plus a fake outsider household. All
-- new rows are fake and rolled back. Demo members:
--   Haruko 02..01 care_recipient, Misa ..02 primary_caregiver, Kenta ..03
--   finance_coordinator, Yui ..04 transport_coordinator.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'outsider.claims.test@example.com', now(), now());
insert into public.households (id, name)
values ('e0000000-0000-4000-8000-000000000001', 'Claims outsider household');
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
        'e3000000-0000-4000-8000-000000000001', 'Fake claims chain', 'high');

-- 01 appointment high, approval pending, unclaimed (first-claim-wins)
-- 02 appointment high, approved, unclaimed (reset on claim)
-- 03 household low, pending_review (owner only)
-- 04 appointment high, completed (closed)
-- 05 appointment high, approved, owner Misa, human_confirmed due in 2h (blocked)
-- 06 appointment high, approved, owner Misa, human_confirmed overdue (blocked)
-- 07 appointment high, approved, owner Misa, model_suggested due in 2h (allowed)
-- 08 appointment high, approved, owner Misa, human_confirmed due in 3 days (allowed)
-- 09 household low, owner Misa, human_confirmed due in 2h (allowed: not high risk)
-- 10 household low, approved, unclaimed (claim never touches approval)
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, owner_id
)
values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'Appointment pending', 'appointment', 'high', true, 'pending_review', 'pending', null),
  ('e5000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001',
   'Appointment approved', 'appointment', 'high', true, 'approved', 'approved', null),
  ('e5000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001',
   'Household low', 'household', 'low', false, 'pending_review', 'not_required', null),
  ('e5000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-000000000001',
   'Appointment completed', 'appointment', 'high', true, 'completed', 'approved', null),
  ('e5000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-000000000001',
   'Due soon confirmed', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000001',
   'Overdue confirmed', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000007', 'e4000000-0000-4000-8000-000000000001',
   'Due soon suggested', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000008', 'e4000000-0000-4000-8000-000000000001',
   'Due later confirmed', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-000000000009', 'e4000000-0000-4000-8000-000000000001',
   'Low risk due soon', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002'),
  ('e5000000-0000-4000-8000-00000000000a', 'e4000000-0000-4000-8000-000000000001',
   'Household approved', 'household', 'low', true, 'approved', 'approved', null);

update public.care_steps s
set task_due_at = v.due_at, task_due_timezone = 'Asia/Tokyo', task_due_provenance = v.prov,
    task_due_set_by = case when v.prov = 'human_confirmed'
      then 'd2000000-0000-4000-8000-000000000002'::uuid end
from (
  values
    ('e5000000-0000-4000-8000-000000000005'::uuid, now() + interval '2 hours', 'human_confirmed'),
    ('e5000000-0000-4000-8000-000000000006'::uuid, now() - interval '1 hour', 'human_confirmed'),
    ('e5000000-0000-4000-8000-000000000007'::uuid, now() + interval '2 hours', 'model_suggested'),
    ('e5000000-0000-4000-8000-000000000008'::uuid, now() + interval '3 days', 'human_confirmed'),
    ('e5000000-0000-4000-8000-000000000009'::uuid, now() + interval '2 hours', 'human_confirmed')
) as v (id, due_at, prov)
where s.id = v.id;

-- ---------------------------------------------------------------------------
-- Functions exist
-- ---------------------------------------------------------------------------
select has_function('public', 'claim_part', array['uuid', 'uuid', 'text'], 'claim_part(uuid, uuid, text) exists');
select has_function('public', 'release_part', array['uuid', 'uuid', 'text'], 'release_part(uuid, uuid, text) exists');

-- ---------------------------------------------------------------------------
-- First claim wins (step 01, approval pending)
-- ---------------------------------------------------------------------------
select is(
  public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'owner')
    ->> 'outcome',
  'claimed',
  'Misa claims owner on an unclaimed Part'
);
select is(
  (select owner_id::text || ' ' || status from public.care_steps where id = 'e5000000-0000-4000-8000-000000000001'),
  'd2000000-0000-4000-8000-000000000002 in_progress',
  'The Owner claim sets owner_id and moves pending_review to in_progress'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000001'),
  1,
  'One audit event for a successful claim without approval reset'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000001' and event_type = 'part.claimed'
     and actor_type = 'human' and actor_id = 'd1000000-0000-4000-8000-000000000002'
     and payload = '{"role": "owner", "member_id": "d2000000-0000-4000-8000-000000000002"}'::jsonb),
  1,
  'The audit event is part.claimed with only role and member ID'
);
select is(
  (select count(*)::int from public.feed_items f join public.audit_events a on a.id = f.audit_event_id
   where f.care_step_id = 'e5000000-0000-4000-8000-000000000001' and f.kind = 'part_claimed'
     and f.recipient_member_id is null and a.event_type = 'part.claimed'),
  1,
  'One household Feed_Item linked to the claim audit event'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000003', 'owner') $$,
  'P0001', 'already_claimed', 'A second person claiming the same role is refused (already_claimed)'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  'P0001', 'already_claimed', 'The holder claiming the same role again is refused (already_claimed)'
);
select is(
  (select (select count(*) from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-000000000001')::int
        + (select count(*) from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-000000000001')::int
        + (case when (select owner_id from public.care_steps where id = 'e5000000-0000-4000-8000-000000000001')
                = 'd2000000-0000-4000-8000-000000000002' then 0 else 100 end)),
  2,
  'Refused claims write no audit event, no Feed_Item, and change no holder'
);
select is(
  public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'driver')
    ->> 'outcome',
  'claimed',
  'The same person may also claim driver'
);
select is(
  (select owner_id = driver_id from public.care_steps where id = 'e5000000-0000-4000-8000-000000000001'),
  true,
  'One Member holds owner and driver at once'
);
select is(
  public.claim_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'companion')
    ->> 'outcome',
  'claimed',
  'Another Member claims companion'
);
select is(
  (select array_agg(event_type order by created_at)
   from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-000000000001'),
  array['part.claimed', 'part.driver_volunteered', 'part.companion_volunteered'],
  'Each role uses its own event type, one event per success'
);
select is(
  (select count(*)::int from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-000000000001'),
  3,
  'One Feed_Item per successful claim'
);
select is(
  (select approval_state || ' ' || plan_version::text from public.care_steps
   where id = 'e5000000-0000-4000-8000-000000000001'),
  'pending 0',
  'Claims on a pending Part leave approval state and plan version alone'
);

-- ---------------------------------------------------------------------------
-- Role offering, input, closed Parts (step 03 household, step 04 completed)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000003',
       'd1000000-0000-4000-8000-000000000002', 'driver') $$,
  'P0001', 'role_not_offered', 'Driver is not offered on a household Part'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000003',
       'd1000000-0000-4000-8000-000000000002', 'companion') $$,
  'P0001', 'role_not_offered', 'Companion is not offered on a household Part'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000003',
       'd1000000-0000-4000-8000-000000000002', 'boss') $$,
  'P0001', 'invalid_input', 'An unknown role is invalid_input'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-000000000003')
    + (select count(*)::int from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-000000000003'),
  0,
  'Nothing was written for the refused role claims'
);
select is(
  public.claim_part('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004', 'owner')
    ->> 'approval_reset',
  'false',
  'Owner is offered for every category and no approval reset happens on a low-risk Part'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  'P0001', 'part_closed', 'A completed Part cannot be claimed'
);

-- ---------------------------------------------------------------------------
-- Care recipient and outsider (step 02, approved)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000001', 'owner') $$,
  'P0001', 'recipient_read_only', 'A care recipient cannot claim'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-000000000002',
       'e1000000-0000-4000-8000-000000000001', 'owner') $$,
  'P0001', 'part_not_found', 'A member of another household gets part_not_found'
);
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-00000000ffff',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  'P0001', 'part_not_found', 'An unknown Part gets part_not_found'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-000000000002')
    + (select count(*)::int from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-000000000002')
    + (select count(*)::int from public.care_steps
       where id = 'e5000000-0000-4000-8000-000000000002' and (owner_id is not null or plan_version <> 0)),
  0,
  'Refused recipient and outsider claims wrote nothing and changed nothing'
);

-- ---------------------------------------------------------------------------
-- Approval reset on an approved High_Risk_Part (step 02)
-- ---------------------------------------------------------------------------
select is(
  public.claim_part('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003', 'owner')
    ->> 'approval_reset',
  'true',
  'Claiming an approved High_Risk_Part reports an approval reset'
);
select is(
  (select approval_state || ' ' || plan_version::text || ' ' || status
   from public.care_steps where id = 'e5000000-0000-4000-8000-000000000002'),
  'pending 1 approved',
  'The claim resets approval to pending, bumps the plan version, and keeps Progress_Status'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000002' and event_type = 'part.claimed'),
  1,
  'One part.claimed event'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000002' and event_type = 'approval.reset'),
  '{"changed": "owner"}'::jsonb,
  'One approval.reset event with the changed role'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'e5000000-0000-4000-8000-000000000002' and recipient_member_id is null),
  1,
  'Exactly one household Feed_Item (the reset adds only reminders)'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000002' and event_type = 'reminder.sent'),
  (select count(*)::int from public.household_members
   where household_id = 'd0000000-0000-4000-8000-000000000001' and role = 'primary_caregiver' and is_active),
  'One reminder per active Primary_Caregiver'
);
select is(
  public.claim_part('e5000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000004', 'owner')
    ->> 'approval_reset',
  'false',
  'A claim on an approved low-risk Part does not reset approval'
);
select is(
  (select approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-00000000000a'),
  'approved',
  'The low-risk Part stays approved'
);

-- ---------------------------------------------------------------------------
-- Release refusals (steps 05, 06; Misa holds owner)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  'P0001', 'release_blocked_due_soon',
  'Release is blocked when a human_confirmed time on a High_Risk_Part is within 24 hours'
);
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  'P0001', 'release_blocked_due_soon',
  'Release is blocked when a human_confirmed time on a High_Risk_Part is overdue'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id in
     ('e5000000-0000-4000-8000-000000000005', 'e5000000-0000-4000-8000-000000000006'))
    + (select count(*)::int from public.feed_items where care_step_id in
     ('e5000000-0000-4000-8000-000000000005', 'e5000000-0000-4000-8000-000000000006'))
    + (select count(*)::int from public.care_steps
       where id in ('e5000000-0000-4000-8000-000000000005', 'e5000000-0000-4000-8000-000000000006')
         and (owner_id is distinct from 'd2000000-0000-4000-8000-000000000002' or approval_state <> 'approved')),
  0,
  'Blocked releases wrote nothing; Misa keeps the role and approval stays'
);
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000003', 'owner') $$,
  'P0001', 'not_holder', 'Only the holder can release'
);
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000003', 'driver') $$,
  'P0001', 'not_holder', 'Releasing an unheld role is not_holder'
);
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000001', 'owner') $$,
  'P0001', 'recipient_read_only', 'A care recipient cannot release'
);
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000005',
       'e1000000-0000-4000-8000-000000000001', 'owner') $$,
  'P0001', 'part_not_found', 'An outsider releasing gets part_not_found'
);
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  'P0001', 'part_closed', 'A completed Part cannot be released'
);

-- ---------------------------------------------------------------------------
-- Release successes (steps 07, 08, 09)
-- ---------------------------------------------------------------------------
select is(
  public.release_part('e5000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000002', 'owner')
    ->> 'outcome',
  'released',
  'A model_suggested time does not block release'
);
select is(
  (select owner_id is null and approval_state = 'pending' and plan_version = 1
   from public.care_steps where id = 'e5000000-0000-4000-8000-000000000007'),
  true,
  'Release clears the role and resets approval on an approved High_Risk_Part'
);
select is(
  (select array_agg(event_type order by created_at)
   from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000007' and event_type <> 'reminder.sent'),
  array['part.released', 'approval.reset'],
  'One part.released event plus the approval.reset event'
);
select is(
  (select count(*)::int from public.feed_items f
   where f.care_step_id = 'e5000000-0000-4000-8000-000000000007' and f.kind = 'part_released'
     and f.recipient_member_id is null
     and f.params = '{"role": "owner", "needs_someone": true}'::jsonb),
  1,
  'One household part_released Feed_Item marked needs_someone'
);
select is(
  public.release_part('e5000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000002', 'owner')
    ->> 'outcome',
  'released',
  'A human_confirmed time more than 24 hours away does not block release'
);
select is(
  public.release_part('e5000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000002', 'owner')
    ->> 'approval_reset',
  'false',
  'A low-risk Part with a time within 24 hours can be released without a reset'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000009')
  + (select count(*)::int from public.feed_items
     where care_step_id = 'e5000000-0000-4000-8000-000000000009'),
  2,
  'A release with no reset writes one audit event and one Feed_Item'
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('claim_part', 'release_part')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'anon and authenticated cannot execute claim_part or release_part'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('claim_part', 'release_part')
     and has_function_privilege('service_role', p.oid, 'execute')),
  2,
  'service_role can execute both functions'
);
set local role authenticated;
select throws_ok(
  $$ select public.claim_part('e5000000-0000-4000-8000-00000000000a',
       'd1000000-0000-4000-8000-000000000002', 'driver') $$,
  '42501', null, 'A browser session calling claim_part is denied by the database'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.release_part('e5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000002', 'owner') $$,
  '42501', null, 'An anonymous session calling release_part is denied by the database'
);
reset role;

select * from finish();
rollback;
