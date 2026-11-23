-- pgTAP tests for public.save_appointment_clarification (migration 20261202000000).
-- Relies on the demo household from supabase/seed.sql. All fixtures are fake
-- and everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(22);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'public.save_appointment_clarification(uuid,uuid,text,timestamptz,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.save_appointment_clarification(uuid,uuid,text,timestamptz,text)', 'execute'),
  'Browser roles cannot execute save_appointment_clarification'
);
select ok(
  has_function_privilege('service_role', 'public.save_appointment_clarification(uuid,uuid,text,timestamptz,text)', 'execute'),
  'The service role can execute save_appointment_clarification'
);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): an outsider household, one note, one chain, two steps
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'e1000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'outsider.appointment.test@example.com',
  now(),
  now()
);
insert into public.households (id, name) values ('e0000000-0000-4000-8000-000000000003', 'Outsider household');
insert into public.household_members (household_id, user_id, display_name, role)
values ('e0000000-0000-4000-8000-000000000003', 'e1000000-0000-4000-8000-000000000003', 'Outsider', 'primary_caregiver');

insert into public.notes (id, household_id, uploaded_by, image_path, status)
values (
  'a1000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000001/1763700000000-note.png',
  'pending_review'
);
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values (
  'a2000000-0000-4000-8000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'Fake follow-up visit',
  'high'
);
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  due_at, escalation_at, source_quote
)
values
  (
    'a3000000-0000-4000-8000-000000000001',
    'a2000000-0000-4000-8000-000000000001',
    'Confirm the follow-up visit',
    'appointment',
    'high',
    true,
    'pending_review',
    '2026-12-01 09:00:00+00',
    '2026-12-02 09:00:00+00',
    'Hospital next Friday?'
  ),
  (
    'a3000000-0000-4000-8000-000000000002',
    'a2000000-0000-4000-8000-000000000001',
    'Pick up the paperwork',
    'document',
    'low',
    false,
    'pending_review',
    null,
    null,
    'Paperwork'
  );

set local role service_role;

-- ---------------------------------------------------------------------------
-- Refusals: nothing is written
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000003', 'Fake Clinic', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'not_allowed',
  'A member of another household cannot save appointment details'
);
select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000099',
       'd1000000-0000-4000-8000-000000000002', 'Fake Clinic', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'step_not_found',
  'An unknown step is refused'
);
select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', 'Fake Clinic', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'not_appointment',
  'Only appointment steps accept appointment details'
);
select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', '   ', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'invalid_input',
  'A blank hospital or clinic name is refused'
);
select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'Fake Clinic', '2026-12-05 01:00:00+00', 'Mars/Olympus') $$,
  'P0001', 'invalid_input',
  'An unknown time zone is refused'
);
select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'Fake Clinic', null, 'Asia/Tokyo') $$,
  'P0001', 'invalid_input',
  'A missing appointment time is refused'
);

reset role;
update public.household_members set is_active = false
where id = 'd2000000-0000-4000-8000-000000000003';
set local role service_role;

select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000003', 'Fake Clinic', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'not_allowed',
  'An inactive member cannot save appointment details'
);

reset role;
update public.household_members set is_active = true
where id = 'd2000000-0000-4000-8000-000000000003';
set local role service_role;

select results_eq(
  $$ select appointment_location, appointment_time, appointment_timezone
     from public.care_steps where id = 'a3000000-0000-4000-8000-000000000001' $$,
  $$ values (null::text, null::timestamptz, null::text) $$,
  'Refused calls leave the step unchanged'
);
select is(
  (select count(*)::int from public.audit_events where care_chain_id = 'a2000000-0000-4000-8000-000000000001'),
  0,
  'Refused calls write no audit event'
);

-- ---------------------------------------------------------------------------
-- Saving
-- ---------------------------------------------------------------------------
select is(
  (public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
     'd1000000-0000-4000-8000-000000000002', '  Fake Clinic  ', '2026-12-05 10:00:00+09', 'Asia/Tokyo')
  ) ->> 'care_chain_id',
  'a2000000-0000-4000-8000-000000000001',
  'An active member saves appointment details and gets the chain back'
);
select results_eq(
  $$ select appointment_location, appointment_time, appointment_timezone
     from public.care_steps where id = 'a3000000-0000-4000-8000-000000000001' $$,
  $$ values ('Fake Clinic'::text, '2026-12-05 01:00:00+00'::timestamptz, 'Asia/Tokyo'::text) $$,
  'The trimmed location, the exact instant, and the time zone are stored'
);
select results_eq(
  $$ select status, approval_required, due_at, escalation_at, source_quote
     from public.care_steps where id = 'a3000000-0000-4000-8000-000000000001' $$,
  $$ values ('pending_review'::text, true, '2026-12-01 09:00:00+00'::timestamptz,
             '2026-12-02 09:00:00+00'::timestamptz, 'Hospital next Friday?'::text) $$,
  'Status, approval, due_at, escalation_at, and the original quote are untouched'
);
select results_eq(
  $$ select household_id, care_step_id, actor_type, actor_id
     from public.audit_events
     where care_chain_id = 'a2000000-0000-4000-8000-000000000001' and event_type = 'appointment_clarified' $$,
  $$ values ('d0000000-0000-4000-8000-000000000001'::uuid, 'a3000000-0000-4000-8000-000000000001'::uuid,
             'human'::text, 'd1000000-0000-4000-8000-000000000002'::uuid) $$,
  'Exactly one appointment_clarified event, attributed to the person who saved it'
);
select is(
  (select payload from public.audit_events
   where care_chain_id = 'a2000000-0000-4000-8000-000000000001' and event_type = 'appointment_clarified'),
  jsonb_build_object(
    'location', 'Fake Clinic',
    'appointment_time', '2026-12-05T01:00:00Z',
    'timezone', 'Asia/Tokyo',
    'clarified_by', 'd1000000-0000-4000-8000-000000000002',
    'clarified_by_member_id', 'd2000000-0000-4000-8000-000000000002',
    'previous', null
  ),
  'The audit payload records the saved details, who supplied them, and no previous values'
);

-- A correction keeps the earlier values in its own audit event.
select lives_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000004', 'Fake Clinic East', '2026-12-05 11:30:00+09', 'Asia/Tokyo') $$,
  'Another active member can correct the details'
);
select is(
  (select payload -> 'previous' from public.audit_events
   where care_chain_id = 'a2000000-0000-4000-8000-000000000001'
     and event_type = 'appointment_clarified'
     and actor_id = 'd1000000-0000-4000-8000-000000000004'),
  jsonb_build_object('location', 'Fake Clinic', 'appointment_time', '2026-12-05T01:00:00Z', 'timezone', 'Asia/Tokyo'),
  'A correction records the previous details'
);
select is(
  (select count(*)::int from public.audit_events
   where care_chain_id = 'a2000000-0000-4000-8000-000000000001' and event_type = 'appointment_clarified'),
  2,
  'Each save writes its own audit event'
);

-- ---------------------------------------------------------------------------
-- Column checks
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.care_steps set appointment_timezone = null
     where id = 'a3000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'An appointment time cannot be stored without its time zone'
);
select throws_ok(
  $$ update public.care_steps set appointment_location = '  '
     where id = 'a3000000-0000-4000-8000-000000000001' $$,
  '23514', null,
  'A blank appointment location cannot be stored'
);

reset role;

-- ---------------------------------------------------------------------------
-- Browser role cannot call it even for its own household
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select throws_ok(
  $$ select public.save_appointment_clarification('a3000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'Fake Clinic', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  '42501', null,
  'A signed-in member cannot call the function directly from the browser'
);

reset role;

select * from finish();
rollback;
