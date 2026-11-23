-- pgTAP tests for migration 20261210000000_shared_care_columns.
-- Relies on the demo household from supabase/seed.sql. All fixtures are fake
-- and everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(31);

-- ---------------------------------------------------------------------------
-- Existing seed rows satisfy the new constraints and stay untouched
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int from public.household_members where ui_language is not null),
  0,
  'Existing members have no ui_language and satisfy its check'
);
-- The table may hold rows from earlier runs, so this checks the column
-- contract instead of counting rows: note_id is nullable and an event written
-- without it keeps it null.
insert into public.audit_events (household_id, actor_type, event_type)
values ('d0000000-0000-4000-8000-000000000001', 'system', 'test.columns_default_note_id');
select is(
  (select (select is_nullable from information_schema.columns
           where table_schema = 'public' and table_name = 'audit_events' and column_name = 'note_id')
          || ':' ||
          (select note_id is null from public.audit_events
           where event_type = 'test.columns_default_note_id')::text),
  'YES:true',
  'audit_events.note_id is nullable and an event written without it keeps a null note_id'
);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): an outsider household with a member and a note,
-- plus a demo note, chain, and two steps (one needs approval, one does not)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'e1000000-0000-4000-8000-000000000013',
  'authenticated',
  'authenticated',
  'outsider.shared.columns.test@example.com',
  now(),
  now()
);
insert into public.households (id, name) values ('e0000000-0000-4000-8000-000000000013', 'Outsider household');
insert into public.household_members (id, household_id, user_id, display_name, role)
values (
  'e2000000-0000-4000-8000-000000000013',
  'e0000000-0000-4000-8000-000000000013',
  'e1000000-0000-4000-8000-000000000013',
  'Outsider',
  'primary_caregiver'
);
insert into public.notes (id, household_id, uploaded_by, image_path, status)
values
  (
    'a1000000-0000-4000-8000-000000000011',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001/a1000000-0000-4000-8000-000000000011/1763700000000-note.png',
    'pending_review'
  ),
  (
    'a1000000-0000-4000-8000-000000000012',
    'e0000000-0000-4000-8000-000000000013',
    'e1000000-0000-4000-8000-000000000013',
    'e0000000-0000-4000-8000-000000000013/a1000000-0000-4000-8000-000000000012/1763700000000-note.png',
    'pending_review'
  );
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values (
  'a2000000-0000-4000-8000-000000000011',
  'd0000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000011',
  'Fake follow-up visit',
  'high'
);
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status, source_quote
)
values
  (
    'a3000000-0000-4000-8000-000000000011',
    'a2000000-0000-4000-8000-000000000011',
    'Confirm the follow-up visit',
    'appointment',
    'high',
    true,
    'pending_review',
    'Hospital next Friday?'
  ),
  (
    'a3000000-0000-4000-8000-000000000012',
    'a2000000-0000-4000-8000-000000000011',
    'Pick up the paperwork',
    'document',
    'low',
    false,
    'pending_review',
    'Paperwork'
  );

select results_eq(
  $$ select approval_state, plan_version, driver_id, companion_id, respond_by_at, task_due_at,
            required_amount_minor, amount_currency
     from public.care_steps where id = 'a3000000-0000-4000-8000-000000000011' $$,
  $$ values (null::text, 0, null::uuid, null::uuid, null::timestamptz, null::timestamptz,
             null::bigint, null::text) $$,
  'A step written without the new columns keeps approval_state null and plan_version 0'
);

-- ---------------------------------------------------------------------------
-- approval_state and approval_required consistency
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.care_steps set approval_state = 'bogus'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'An unknown approval_state is rejected'
);
select throws_ok(
  $$ update public.care_steps set approval_state = 'pending'
     where id = 'a3000000-0000-4000-8000-000000000012' $$,
  '23514', null,
  'A pending approval_state is rejected when approval is not required'
);
select throws_ok(
  $$ update public.care_steps set approval_state = 'not_required'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'approval_state not_required is rejected when approval is required'
);
select lives_ok(
  $$ update public.care_steps set approval_state = 'pending'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  'A pending approval_state is accepted when approval is required'
);
select lives_ok(
  $$ update public.care_steps set approval_state = 'not_required'
     where id = 'a3000000-0000-4000-8000-000000000012' $$,
  'approval_state not_required is accepted when approval is not required'
);
select throws_ok(
  $$ update public.care_steps set plan_version = -1
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A negative plan_version is rejected'
);

-- ---------------------------------------------------------------------------
-- Respond_By_Time group
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.care_steps set respond_by_at = '2026-12-05 01:00:00+00'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A respond-by time without zone and provenance is rejected'
);
select throws_ok(
  $$ update public.care_steps
     set respond_by_at = '2026-12-05 01:00:00+00', respond_by_timezone = 'Asia/Tokyo',
         respond_by_provenance = 'guessed'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'An unknown respond-by provenance is rejected'
);
select throws_ok(
  $$ update public.care_steps
     set respond_by_at = '2026-12-05 01:00:00+00', respond_by_timezone = 'Asia/Tokyo',
         respond_by_provenance = 'human_confirmed'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A human-confirmed respond-by time without set_by is rejected'
);
select lives_ok(
  $$ update public.care_steps
     set respond_by_at = '2026-12-05 01:00:00+00', respond_by_timezone = 'Asia/Tokyo',
         respond_by_provenance = 'model_suggested'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  'A model-suggested respond-by time without set_by is accepted'
);
select lives_ok(
  $$ update public.care_steps
     set respond_by_provenance = 'human_confirmed',
         respond_by_set_by = 'd2000000-0000-4000-8000-000000000002'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  'A human-confirmed respond-by time with set_by is accepted'
);

-- ---------------------------------------------------------------------------
-- Task_Due_Time group
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.care_steps set task_due_timezone = 'Asia/Tokyo'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A task-due zone without a time and provenance is rejected'
);
select throws_ok(
  $$ update public.care_steps
     set task_due_at = '2026-12-04 01:00:00+00', task_due_timezone = 'Asia/Tokyo',
         task_due_provenance = 'guessed'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'An unknown task-due provenance is rejected'
);
select throws_ok(
  $$ update public.care_steps
     set task_due_at = '2026-12-04 01:00:00+00', task_due_timezone = 'Asia/Tokyo',
         task_due_provenance = 'human_confirmed'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A human-confirmed task-due time without set_by is rejected'
);
select lives_ok(
  $$ update public.care_steps
     set task_due_at = '2026-12-04 01:00:00+00', task_due_timezone = 'Asia/Tokyo',
         task_due_provenance = 'human_confirmed',
         task_due_set_by = 'd2000000-0000-4000-8000-000000000002'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  'A complete human-confirmed task-due time is accepted'
);

-- ---------------------------------------------------------------------------
-- Amount and currency
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.care_steps set required_amount_minor = 1200
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'An amount without a currency is rejected'
);
select throws_ok(
  $$ update public.care_steps set amount_currency = 'JPY'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A currency without an amount is rejected'
);
select throws_ok(
  $$ update public.care_steps set required_amount_minor = 1200, amount_currency = 'jpy'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A currency that is not three capital letters is rejected'
);
select throws_ok(
  $$ update public.care_steps set required_amount_minor = -1, amount_currency = 'JPY'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A negative amount is rejected'
);
select lives_ok(
  $$ update public.care_steps set required_amount_minor = 1200, amount_currency = 'JPY'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  'An amount with a valid currency is accepted'
);

-- ---------------------------------------------------------------------------
-- ui_language
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.household_members set ui_language = 'fr'
     where id = 'd2000000-0000-4000-8000-000000000002' $$,
  '23514', null,
  'An unsupported ui_language is rejected'
);
select lives_ok(
  $$ update public.household_members set ui_language = 'ja'
     where id = 'd2000000-0000-4000-8000-000000000002' $$,
  'A supported ui_language is accepted'
);

-- ---------------------------------------------------------------------------
-- Driver and companion must belong to the chain's household
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ update public.care_steps set driver_id = 'e2000000-0000-4000-8000-000000000013'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A driver from another household is rejected'
);
select throws_ok(
  $$ update public.care_steps set companion_id = 'e2000000-0000-4000-8000-000000000013'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  '23514', null,
  'A companion from another household is rejected'
);
select lives_ok(
  $$ update public.care_steps
     set driver_id = 'd2000000-0000-4000-8000-000000000003',
         companion_id = 'd2000000-0000-4000-8000-000000000004'
     where id = 'a3000000-0000-4000-8000-000000000011' $$,
  'A driver and companion from the same household are accepted'
);

-- ---------------------------------------------------------------------------
-- audit_events.note_id must be a note of the event's household
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.audit_events (household_id, note_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000012',
             'system', 'test.cross_household_note') $$,
  '23503', null,
  'An audit event cannot point at a note of another household'
);
select lives_ok(
  $$ insert into public.audit_events (household_id, note_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000011',
             'system', 'test.same_household_note') $$,
  'An audit event can point at a note of its own household'
);
select lives_ok(
  $$ insert into public.audit_events (household_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'system', 'test.no_note') $$,
  'An audit event without a note is accepted'
);

select * from finish();
rollback;
