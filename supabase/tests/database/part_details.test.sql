-- pgTAP tests for public.confirm_part_time, save_part_amount,
-- resolve_missing_detail, mark_feed_seen, set_member_language, and the replaced
-- save_appointment_clarification (migration 20261210000300_shared_care_functions).
-- Uses the demo household from seed.sql plus a fake outsider household.
-- Demo members: Haruko ..01 care_recipient, Misa ..02 primary_caregiver (the only
-- active primary), Kenta ..03 finance_coordinator, Yui ..04 transport_coordinator,
-- Aiko ..05 professional_caregiver. All new rows are fake and rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(141);
-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'outsider.details.test@example.com', now(), now());
insert into public.households (id, name)
values ('f0000000-0000-4000-8000-000000000001', 'Details outsider household');
insert into public.household_members (id, household_id, user_id, display_name, role, is_active)
values ('f2000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
        'f1000000-0000-4000-8000-000000000001', 'Outsider', 'primary_caregiver', true);
insert into public.notes (id, household_id, uploaded_by, image_path, status)
values (
  'f3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd0000000-0000-4000-8000-000000000001/f3000000-0000-4000-8000-000000000001/1763700000000-note.png',
  'pending_review'
);
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values ('f4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
        'f3000000-0000-4000-8000-000000000001', 'Fake details chain', 'high');
-- Step ids f5...0000000NN (hex).
-- 01 appointment, approved            (confirm appointment time resets approval)
-- 02 appointment, pending approval    (no reset)
-- 03 household, low risk              (respond_by by a non-primary; appointment kind refused)
-- 04 transport, approved, task due model_suggested (confirm replaces and resolves)
-- 05 transport, approved, task due human_confirmed by Aiko (replaced, resolves nothing)
-- 06 payment, approved, no amount     (amount resets approval)
-- 07 payment, pending approval        (no reset)
-- 08 household, low risk              (amount refused: not a payment Part)
-- 09 appointment, completed           (part_closed)
-- 0a appointment, approved            (location answer resets)
-- 0b household, low risk              (answers, no reset)
-- 0c appointment, approved, time set  (same instant: no reset; new instant: reset)
-- 0d appointment, approved, empty     (replaced save_appointment_clarification resets once)
-- 0e payment, completed               (part_closed)
-- 0f payment, approved, 500 JPY       (same amount: no reset; new amount: reset)
-- 10 appointment, approved, saved details (same values: no reset)
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status, approval_state
)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'Appt approved', 'appointment', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000001', 'Appt pending', 'appointment', 'high', true, 'in_progress', 'pending'),
  ('f5000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000001', 'Low risk', 'household', 'low', false, 'in_progress', 'not_required'),
  ('f5000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000001', 'Ride model time', 'transport', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000001', 'Ride human time', 'transport', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000001', 'Pay approved', 'payment', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000001', 'Pay pending', 'payment', 'high', true, 'in_progress', 'pending'),
  ('f5000000-0000-4000-8000-000000000008', 'f4000000-0000-4000-8000-000000000001', 'Not payment', 'household', 'low', false, 'in_progress', 'not_required'),
  ('f5000000-0000-4000-8000-000000000009', 'f4000000-0000-4000-8000-000000000001', 'Appt completed', 'appointment', 'high', true, 'completed', 'approved'),
  ('f5000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-000000000001', 'Appt location', 'appointment', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-00000000000b', 'f4000000-0000-4000-8000-000000000001', 'Low details', 'household', 'low', false, 'in_progress', 'not_required'),
  ('f5000000-0000-4000-8000-00000000000c', 'f4000000-0000-4000-8000-000000000001', 'Appt time set', 'appointment', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-00000000000d', 'f4000000-0000-4000-8000-000000000001', 'Appt empty', 'appointment', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-00000000000e', 'f4000000-0000-4000-8000-000000000001', 'Pay completed', 'payment', 'high', true, 'completed', 'approved'),
  ('f5000000-0000-4000-8000-00000000000f', 'f4000000-0000-4000-8000-000000000001', 'Pay with amount', 'payment', 'high', true, 'in_progress', 'approved'),
  ('f5000000-0000-4000-8000-000000000010', 'f4000000-0000-4000-8000-000000000001', 'Appt saved', 'appointment', 'high', true, 'in_progress', 'approved');
update public.care_steps
set task_due_at = '2026-12-01 00:00:00+00', task_due_timezone = 'Asia/Tokyo',
    task_due_provenance = 'model_suggested'
where id = 'f5000000-0000-4000-8000-000000000004';
update public.care_steps
set task_due_at = '2026-12-02 00:00:00+00', task_due_timezone = 'Asia/Tokyo',
    task_due_provenance = 'human_confirmed', task_due_set_by = 'd2000000-0000-4000-8000-000000000005'
where id = 'f5000000-0000-4000-8000-000000000005';
update public.care_steps
set appointment_time = '2026-12-05 01:00:00+00', appointment_timezone = 'Asia/Tokyo'
where id = 'f5000000-0000-4000-8000-00000000000c';
update public.care_steps
set required_amount_minor = 500, amount_currency = 'JPY'
where id = 'f5000000-0000-4000-8000-00000000000f';
update public.care_steps
set appointment_location = 'Fake Hospital', appointment_time = '2026-12-06 01:00:00+00',
    appointment_timezone = 'Asia/Tokyo'
where id = 'f5000000-0000-4000-8000-000000000010';
-- Stored Missing_Details. 01 location (0a); 02 person, 03 location, 04 time,
-- 05 amount, 06 already resolved, 07 contact (all on 0b); 08 document (09, closed).
insert into public.part_missing_details (id, household_id, care_chain_id, care_step_id, kind, question_code)
values
  ('f6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000a', 'location', 'which_clinic'),
  ('f6000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000b', 'person', 'which_person'),
  ('f6000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000b', 'location', 'which_clinic'),
  ('f6000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000b', 'time', 'which_time'),
  ('f6000000-0000-4000-8000-000000000005', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000b', 'amount', 'which_amount'),
  ('f6000000-0000-4000-8000-000000000007', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000b', 'contact', 'which_contact'),
  ('f6000000-0000-4000-8000-000000000008', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000009', 'document', 'which_document');
insert into public.part_missing_details (id, household_id, care_chain_id, care_step_id, kind, question_code, resolved_at, resolved_by, answer)
values ('f6000000-0000-4000-8000-000000000006', 'd0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-00000000000b', 'document', 'which_document', now(), 'd2000000-0000-4000-8000-000000000002', 'earlier answer');
-- ---------------------------------------------------------------------------
-- Functions exist
-- ---------------------------------------------------------------------------
select has_function('public', 'confirm_part_time', array['uuid', 'uuid', 'text', 'timestamp with time zone', 'text'], 'confirm_part_time exists');
select has_function('public', 'save_part_amount', array['uuid', 'uuid', 'bigint', 'text'], 'save_part_amount exists');
select has_function('public', 'resolve_missing_detail', array['uuid', 'uuid', 'text'], 'resolve_missing_detail exists');
select has_function('public', 'mark_feed_seen', array['uuid', 'uuid', 'timestamp with time zone'], 'mark_feed_seen exists');
select has_function('public', 'set_member_language', array['uuid', 'uuid', 'text'], 'set_member_language exists');
-- ---------------------------------------------------------------------------
-- confirm_part_time refusals (nothing is written)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'part_not_found', 'A member of another household gets part_not_found'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-0000000000ff', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'part_not_found', 'An unknown Part gets part_not_found'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot confirm a time'
);
update public.household_members set is_active = false where id = 'd2000000-0000-4000-8000-000000000003';
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'part_not_found', 'An inactive member cannot confirm a time'
);
update public.household_members set is_active = true where id = 'd2000000-0000-4000-8000-000000000003';
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'part_closed', 'A completed Part refuses a time'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2026-12-05 01:00:00+00', 'Mars/Olympus') $$,
  'P0001', 'invalid_input', 'An unknown IANA zone is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2026-12-05 01:00:00+00', null) $$,
  'P0001', 'invalid_input', 'A missing zone is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'appointment', null, 'Asia/Tokyo') $$,
  'P0001', 'invalid_input', 'A missing time is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'appointment', '1999-12-31 23:59:59+00', 'Asia/Tokyo') $$,
  'P0001', 'invalid_input', 'A time before 2000 is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2101-01-01 00:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'invalid_input', 'A time after 2100 is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'bogus', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'invalid_input', 'An unknown kind is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', null, '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'invalid_input', 'A missing kind is refused'
);
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004', 'appointment', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'invalid_input', 'An appointment time on a Part that is not an appointment is refused'
);
select results_eq(
  $$ select appointment_time, appointment_timezone, approval_state, plan_version
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000001' $$,
  $$ values (null::timestamptz, null::text, 'approved'::text, 0) $$,
  'Refused time calls leave the Part unchanged'
);
-- ---------------------------------------------------------------------------
-- save_part_amount refusals
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'f1000000-0000-4000-8000-000000000001', 100, 'JPY') $$,
  'P0001', 'part_not_found', 'A member of another household gets part_not_found for an amount'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-0000000000ff', 'd1000000-0000-4000-8000-000000000003', 100, 'JPY') $$,
  'P0001', 'part_not_found', 'An unknown Part gets part_not_found for an amount'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000001', 100, 'JPY') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot save an amount'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-00000000000e', 'd1000000-0000-4000-8000-000000000003', 100, 'JPY') $$,
  'P0001', 'part_closed', 'A completed Part refuses an amount'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000003', 100, 'JPY') $$,
  'P0001', 'invalid_input', 'An amount on a Part that is not a payment is refused'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', -1, 'JPY') $$,
  'P0001', 'invalid_input', 'A negative amount is refused'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', null, 'JPY') $$,
  'P0001', 'invalid_input', 'A missing amount is refused'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 100, null) $$,
  'P0001', 'invalid_input', 'A missing currency is refused'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 100, 'jpy') $$,
  'P0001', 'invalid_input', 'A lower-case currency is refused'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 100, 'JP') $$,
  'P0001', 'invalid_input', 'A two-letter currency is refused'
);
select results_eq(
  $$ select required_amount_minor, amount_currency, approval_state, plan_version
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000006' $$,
  $$ values (null::bigint, null::text, 'approved'::text, 0) $$,
  'Refused amount calls leave the Part unchanged'
);
-- ---------------------------------------------------------------------------
-- resolve_missing_detail refusals
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-0000000000ff', 'd1000000-0000-4000-8000-000000000002', 'x') $$,
  'P0001', 'part_not_found', 'An unknown detail gets part_not_found'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000007', 'f1000000-0000-4000-8000-000000000001', 'x') $$,
  'P0001', 'part_not_found', 'A member of another household gets part_not_found for a detail'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000001', 'x') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot answer a detail'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000002', 'x') $$,
  'P0001', 'part_closed', 'A detail on a completed Part cannot be answered'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000002', '   ') $$,
  'P0001', 'invalid_input', 'A blank answer is refused'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000002', null) $$,
  'P0001', 'invalid_input', 'A missing answer is refused'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000002', repeat('a', 501)) $$,
  'P0001', 'invalid_input', 'An answer over 500 characters is refused'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', repeat('a', 201)) $$,
  'P0001', 'invalid_input', 'A location answer over 200 characters is refused'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000002', '10:00') $$,
  'P0001', 'invalid_input', 'A typed answer never resolves a time detail'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000002', '5000') $$,
  'P0001', 'invalid_input', 'A typed answer never resolves an amount detail'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000002', 'again') $$,
  'P0001', 'invalid_input', 'An already resolved detail is refused'
);
select is(
  (select count(*)::int from public.part_missing_details
   where care_chain_id = 'f4000000-0000-4000-8000-000000000001' and resolved_at is null and answer is not null),
  0, 'Refused answers are not stored'
);
select is(
  (select answer from public.part_missing_details where id = 'f6000000-0000-4000-8000-000000000006'),
  'earlier answer', 'A refused second answer keeps the first'
);
-- ---------------------------------------------------------------------------
-- mark_feed_seen and set_member_language refusals
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'part_not_found', 'An outsider cannot mark the demo feed seen'
);
select throws_ok(
  $$ select public.mark_feed_seen('f0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'part_not_found', 'A demo member cannot mark another household feed seen'
);
select throws_ok(
  $$ select public.set_member_language('f1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'ja') $$,
  'P0001', 'part_not_found', 'An outsider cannot set a language in the demo household'
);
select throws_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'fr') $$,
  'P0001', 'invalid_input', 'An unsupported language is refused'
);
select throws_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', null) $$,
  'P0001', 'invalid_input', 'A missing language is refused'
);
select is(
  (select count(*)::int from public.household_members
   where household_id = 'd0000000-0000-4000-8000-000000000001' and ui_language is not null)
  + (select count(*)::int from public.audit_events where event_type = 'member.language_changed'
     and household_id = 'd0000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.member_feed_state),
  0, 'Refused feed and language calls write nothing'
);
-- ---------------------------------------------------------------------------
-- save_appointment_clarification: the two new refusals
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.save_appointment_clarification('f5000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-000000000001', 'Fake Hospital', '2026-12-06 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot save appointment details'
);
select throws_ok(
  $$ select public.save_appointment_clarification('f5000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000002', 'Fake Hospital', '2026-12-06 01:00:00+00', 'Asia/Tokyo') $$,
  'P0001', 'part_closed', 'A completed appointment refuses details'
);
-- Nothing at all was written by any refusal above.
select is(
  (select count(*)::int from public.audit_events where care_chain_id = 'f4000000-0000-4000-8000-000000000001'),
  0, 'No refusal wrote an audit event'
);
select is(
  (select count(*)::int from public.feed_items where care_chain_id = 'f4000000-0000-4000-8000-000000000001'),
  0, 'No refusal wrote a Feed_Item'
);
-- ---------------------------------------------------------------------------
-- confirm_part_time: appointment time on an approved High_Risk_Part (01)
-- ---------------------------------------------------------------------------
select is(
  (public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004',
     'appointment', '2026-12-05 10:00:00+09', 'Asia/Tokyo') ->> 'approval_reset')::boolean,
  true, 'Confirming the appointment time of an approved High_Risk_Part resets approval'
);
select results_eq(
  $$ select appointment_time, appointment_timezone, approval_state, plan_version
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000001' $$,
  $$ values ('2026-12-05 01:00:00+00'::timestamptz, 'Asia/Tokyo'::text, 'pending'::text, 1) $$,
  'The time and zone are stored, approval is pending, and plan_version is bumped'
);
select results_eq(
  $$ select actor_type, actor_id, note_id from public.audit_events
     where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type = 'time.confirmed' $$,
  $$ values ('human'::text, 'd1000000-0000-4000-8000-000000000004'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid) $$,
  'One time.confirmed event by the human actor, linked to the note'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type = 'time.confirmed'),
  jsonb_build_object('kind', 'appointment', 'timezone', 'Asia/Tokyo', 'at', '2026-12-05T01:00:00.000Z',
                     'member_id', 'd2000000-0000-4000-8000-000000000004'),
  'The payload holds kind, zone, ISO time, and member id only'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type = 'approval.reset'),
  jsonb_build_object('changed', 'appointment_time'), 'approval.reset names the appointment time'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type = 'reminder.sent'),
  1, 'The only active Primary_Caregiver is reminded'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000001'),
  3, 'The change wrote time.confirmed, approval.reset, and one reminder'
);
select results_eq(
  $$ select f.kind, f.params, a.event_type from public.feed_items f join public.audit_events a on a.id = f.audit_event_id
     where f.care_step_id = 'f5000000-0000-4000-8000-000000000001' and f.recipient_member_id is null $$,
  $$ values ('missing_detail_resolved'::text, '{"kind": "appointment"}'::jsonb, 'time.confirmed'::text) $$,
  'One household Feed_Item says a missing detail was resolved, linked to the time event'
);
-- Pending approval is not reset (02).
select is(
  (public.confirm_part_time('f5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002',
     'appointment', '2026-12-05 10:00:00+09', 'Asia/Tokyo') ->> 'approval_reset')::boolean,
  false, 'A pending High_Risk_Part is not reset'
);
select results_eq(
  $$ select approval_state, plan_version,
            (select count(*)::int from public.audit_events a where a.care_step_id = s.id)
     from public.care_steps s where s.id = 'f5000000-0000-4000-8000-000000000002' $$,
  $$ values ('pending'::text, 0, 1) $$,
  'A pending Part keeps its state and version, and writes one audit event'
);
-- The same instant again on an approved Part (0c) is not a change.
select is(
  (public.confirm_part_time('f5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000004',
     'appointment', '2026-12-05 10:00:00+09', 'Asia/Tokyo') ->> 'approval_reset')::boolean,
  false, 'Confirming the same appointment instant does not reset approval'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000c' $$,
  $$ values ('approved'::text, 0) $$, 'The approved Part stays approved'
);
select is(
  (select kind from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-00000000000c' and recipient_member_id is null),
  'time_confirmed', 'Re-confirming an existing time does not claim to resolve a detail'
);
select is(
  (public.confirm_part_time('f5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000004',
     'appointment', '2026-12-05 11:00:00+09', 'Asia/Tokyo') ->> 'approval_reset')::boolean,
  true, 'A new appointment instant on an approved Part resets approval'
);
-- ---------------------------------------------------------------------------
-- confirm_part_time: Task_Due_Time and Respond_By_Time (not Key_Facts)
-- ---------------------------------------------------------------------------
select is(
  (public.confirm_part_time('f5000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004',
     'task_due', '2026-12-10 18:00:00+09', 'Asia/Tokyo') ->> 'approval_reset')::boolean,
  false, 'A Task_Due_Time never resets approval'
);
select results_eq(
  $$ select task_due_at, task_due_timezone, task_due_provenance, task_due_set_by, approval_state, plan_version
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000004' $$,
  $$ values ('2026-12-10 09:00:00+00'::timestamptz, 'Asia/Tokyo'::text, 'human_confirmed'::text,
             'd2000000-0000-4000-8000-000000000004'::uuid, 'approved'::text, 0) $$,
  'A confirmed Task_Due_Time replaces the model_suggested one, set_by is the Member'
);
select is(
  (select kind from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-000000000004' and recipient_member_id is null),
  'missing_detail_resolved', 'A model_suggested time did not count: confirming the first human time resolves the gap'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000004' and event_type = 'time.confirmed'),
  jsonb_build_object('kind', 'task_due', 'timezone', 'Asia/Tokyo', 'at', '2026-12-10T09:00:00.000Z',
                     'member_id', 'd2000000-0000-4000-8000-000000000004'),
  'The task_due payload holds kind, zone, ISO time, and member id only'
);
select lives_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000004',
       'task_due', '2026-12-11 18:00:00+09', 'Asia/Tokyo') $$,
  'A second Member replaces a human_confirmed Task_Due_Time'
);
select results_eq(
  $$ select task_due_at, task_due_provenance, task_due_set_by
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000005' $$,
  $$ values ('2026-12-11 09:00:00+00'::timestamptz, 'human_confirmed'::text, 'd2000000-0000-4000-8000-000000000004'::uuid) $$,
  'The new Task_Due_Time and its setter replace the old ones'
);
select is(
  (select kind from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-000000000005' and recipient_member_id is null),
  'time_confirmed', 'Replacing a human_confirmed time does not claim to resolve a detail'
);
select lives_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000005',
       'respond_by', '2026-12-03 12:00:00+09', 'Asia/Tokyo') $$,
  'A professional caregiver (not a primary) confirms a Respond_By_Time'
);
select results_eq(
  $$ select respond_by_at, respond_by_timezone, respond_by_provenance, respond_by_set_by, approval_state, task_due_at
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000003' $$,
  $$ values ('2026-12-03 03:00:00+00'::timestamptz, 'Asia/Tokyo'::text, 'human_confirmed'::text,
             'd2000000-0000-4000-8000-000000000005'::uuid, 'not_required'::text, null::timestamptz) $$,
  'respond_by_* is written as a group with human_confirmed and the actor; the other time is untouched'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000003'),
  1, 'A low-risk Part writes exactly one audit event and no reset'
);
-- ---------------------------------------------------------------------------
-- save_part_amount
-- ---------------------------------------------------------------------------
select is(
  (public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 12345, 'JPY') ->> 'approval_reset')::boolean,
  true, 'Saving an amount on an approved payment Part resets approval'
);
select results_eq(
  $$ select required_amount_minor, amount_currency, approval_state, plan_version
     from public.care_steps where id = 'f5000000-0000-4000-8000-000000000006' $$,
  $$ values (12345::bigint, 'JPY'::text, 'pending'::text, 1) $$,
  'The amount and currency are stored, approval is pending, plan_version is bumped'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and event_type = 'missing_detail.resolved'),
  jsonb_build_object('kind', 'amount', 'changed', true), 'The audit payload has a flag, not the amount'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and payload::text like '%12345%'),
  0, 'No audit payload of the Part contains the amount'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and params::text like '%12345%'),
  0, 'No Feed_Item of the Part contains the amount'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and event_type = 'approval.reset'),
  jsonb_build_object('changed', 'amount'), 'approval.reset names the amount'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000006'),
  3, 'The change wrote missing_detail.resolved, approval.reset, and one reminder'
);
select results_eq(
  $$ select kind, params from public.feed_items
     where care_step_id = 'f5000000-0000-4000-8000-000000000006' and recipient_member_id is null $$,
  $$ values ('missing_detail_resolved'::text, '{"kind": "amount"}'::jsonb) $$,
  'One household Feed_Item for the amount, without the value'
);
select is(
  (public.save_part_amount('f5000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000003', 900, 'JPY') ->> 'approval_reset')::boolean,
  false, 'A pending payment Part is not reset'
);
select results_eq(
  $$ select approval_state, plan_version, (select count(*)::int from public.audit_events a where a.care_step_id = s.id)
     from public.care_steps s where s.id = 'f5000000-0000-4000-8000-000000000007' $$,
  $$ values ('pending'::text, 0, 1) $$, 'A pending payment Part keeps its state and writes one event'
);
select is(
  (public.save_part_amount('f5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 500, 'JPY') ->> 'approval_reset')::boolean,
  false, 'Saving the same amount again does not reset approval'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000f' and event_type = 'missing_detail.resolved'),
  jsonb_build_object('kind', 'amount', 'changed', false), 'An unchanged amount is flagged as unchanged'
);
select is(
  (public.save_part_amount('f5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 600, 'JPY') ->> 'approval_reset')::boolean,
  true, 'Changing the amount of an approved payment Part resets approval'
);
-- ---------------------------------------------------------------------------
-- resolve_missing_detail
-- ---------------------------------------------------------------------------
select is(
  (public.resolve_missing_detail('f6000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', '  Fake Clinic  ') ->> 'approval_reset')::boolean,
  true, 'A location answer on an approved High_Risk_Part resets approval'
);
select results_eq(
  $$ select appointment_location, approval_state, plan_version from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000a' $$,
  $$ values ('Fake Clinic'::text, 'pending'::text, 1) $$,
  'The trimmed location is saved on the Part through the Key_Fact path'
);
select results_eq(
  $$ select answer, resolved_by, resolved_at is not null from public.part_missing_details where id = 'f6000000-0000-4000-8000-000000000001' $$,
  $$ values ('Fake Clinic'::text, 'd2000000-0000-4000-8000-000000000004'::uuid, true) $$,
  'The answer and the human who gave it are stored in part_missing_details'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000a' and event_type = 'missing_detail.resolved'),
  jsonb_build_object('kind', 'location', 'detail_id', 'f6000000-0000-4000-8000-000000000001'),
  'The audit payload holds the kind and detail id, not the answer'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000a' and event_type = 'approval.reset'),
  jsonb_build_object('changed', 'location'), 'approval.reset names the location'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000a' and payload::text like '%Clinic%'),
  0, 'No audit payload of the Part contains the answer'
);
-- A Person_To_Ask answer is text only (0b, low risk).
select lives_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'Misa Fake') $$,
  'A person answer is accepted'
);
select results_eq(
  $$ select owner_id, backup_owner_id, driver_id, companion_id, person_to_ask
     from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000b' $$,
  $$ values (null::uuid, null::uuid, null::uuid, null::uuid, null::text) $$,
  'A person answer never becomes an Owner, Backup, Driver, or Companion'
);
select is(
  (select answer from public.part_missing_details where id = 'f6000000-0000-4000-8000-000000000002'),
  'Misa Fake', 'The person answer stays in part_missing_details'
);
select is(
  (select count(*)::int from public.audit_events a
   where a.care_step_id = 'f5000000-0000-4000-8000-00000000000b' and a.payload::text like '%Misa Fake%')
  + (select count(*)::int from public.feed_items f
     where f.care_step_id = 'f5000000-0000-4000-8000-00000000000b' and f.params::text like '%Misa Fake%'),
  0, 'The answer is in neither the audit trail nor the Feed_Items'
);
-- A location answer on a low-risk Part saves the location but resets nothing.
select is(
  (public.resolve_missing_detail('f6000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002', 'Fake Pharmacy') ->> 'approval_reset')::boolean,
  false, 'A location answer on a low-risk Part does not reset approval'
);
select results_eq(
  $$ select appointment_location, approval_state, plan_version from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000b' $$,
  $$ values ('Fake Pharmacy'::text, 'not_required'::text, 0) $$,
  'The low-risk Part keeps its approval state and plan version'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000b' and event_type in ('approval.reset', 'reminder.sent')),
  0, 'No approval.reset or reminder for a low-risk Part'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000b' and event_type = 'missing_detail.resolved'),
  2, 'One audit event per answered detail'
);
-- ---------------------------------------------------------------------------
-- save_appointment_clarification (replaced)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select r ->> 'approval_reset', r ->> 'outcome', r ->> 'care_chain_id'
     from (select public.save_appointment_clarification('f5000000-0000-4000-8000-00000000000d',
       'd1000000-0000-4000-8000-000000000002', '  Fake Hospital ', '2026-12-06 10:00:00+09', 'Asia/Tokyo') as r) q $$,
  $$ values ('true'::text, 'saved'::text, 'f4000000-0000-4000-8000-000000000001'::text) $$,
  'Saving location and time on an approved appointment resets approval and returns the chain'
);
select results_eq(
  $$ select appointment_location, appointment_time, appointment_timezone, approval_state, plan_version
     from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000d' $$,
  $$ values ('Fake Hospital'::text, '2026-12-06 01:00:00+00'::timestamptz, 'Asia/Tokyo'::text, 'pending'::text, 1) $$,
  'The details are saved, approval is pending, and plan_version is bumped once'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000d' and event_type = 'approval.reset'),
  1, 'Location and time changing together reset approval once'
);
select results_eq(
  $$ select count(*)::int, bool_and(note_id = 'f3000000-0000-4000-8000-000000000001')
     from public.audit_events
     where care_step_id = 'f5000000-0000-4000-8000-00000000000d' and event_type = 'appointment_clarified' $$,
  $$ values (1, true) $$, 'One appointment_clarified event, linked to the note'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-00000000000d' and kind = 'appointment_clarified' and recipient_member_id is null),
  1, 'One household Feed_Item for the saved details'
);
select is(
  (public.save_appointment_clarification('f5000000-0000-4000-8000-000000000010',
     'd1000000-0000-4000-8000-000000000002', 'Fake Hospital', '2026-12-06 10:00:00+09', 'Asia/Tokyo') ->> 'approval_reset')::boolean,
  false, 'Saving the same details again does not reset approval'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps where id = 'f5000000-0000-4000-8000-000000000010' $$,
  $$ values ('approved'::text, 0) $$, 'The approved appointment stays approved'
);
-- ---------------------------------------------------------------------------
-- mark_feed_seen
-- ---------------------------------------------------------------------------
-- A reminder for Yui, who will not mark anything seen.
select private.add_reminder('d0000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001', null, 'd2000000-0000-4000-8000-000000000004', 'test_reminder');
create temporary table _audit_before as
  select count(*)::int as n from public.audit_events where household_id = 'd0000000-0000-4000-8000-000000000001';
select cmp_ok(
  (select count(*)::int from public.feed_items
   where recipient_member_id = 'd2000000-0000-4000-8000-000000000002' and seen_at is null),
  '>', 0, 'Misa has unseen reminders from the approval resets'
);
select lives_ok(
  $$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', timestamptz '2000-01-01 00:00:00+00') $$,
  'A Member marks the feed seen up to an old time'
);
select is(
  (select count(*)::int from public.feed_items
   where recipient_member_id = 'd2000000-0000-4000-8000-000000000002' and seen_at is not null),
  0, 'An old marker does not mark newer reminders seen'
);
select lives_ok(
  $$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', clock_timestamp()) $$,
  'A Member marks the feed seen up to now'
);
select is(
  (select count(*)::int from public.feed_items
   where recipient_member_id = 'd2000000-0000-4000-8000-000000000002' and seen_at is null),
  0, 'All reminders addressed to the Member get seen_at'
);
select is(
  (select count(*)::int from public.feed_items
   where recipient_member_id = 'd2000000-0000-4000-8000-000000000004' and seen_at is not null),
  0, 'Another Member reminders stay unseen'
);
select is(
  (select count(*)::int from public.feed_items where recipient_member_id is null and seen_at is not null),
  0, 'Household Feed_Items never get seen_at'
);
select cmp_ok(
  (select last_seen_at from public.member_feed_state where member_id = 'd2000000-0000-4000-8000-000000000002'),
  '>', timestamptz '2020-01-01 00:00:00+00', 'The marker moved forward'
);
select lives_ok(
  $$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', timestamptz '2001-01-01 00:00:00+00') $$,
  'An older time can be passed again'
);
select cmp_ok(
  (select last_seen_at from public.member_feed_state where member_id = 'd2000000-0000-4000-8000-000000000002'),
  '>', timestamptz '2020-01-01 00:00:00+00', 'The marker never moves back'
);
select lives_ok(
  $$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001') $$,
  'The Care_Recipient can mark the feed seen, using the default time'
);
select is(
  (select count(*)::int from public.member_feed_state where household_id = 'd0000000-0000-4000-8000-000000000001'),
  2, 'One marker row per Member, upserted'
);
select is(
  (select count(*)::int from public.audit_events where household_id = 'd0000000-0000-4000-8000-000000000001'),
  (select n from _audit_before), 'mark_feed_seen writes no audit event'
);
-- ---------------------------------------------------------------------------
-- set_member_language
-- ---------------------------------------------------------------------------
select lives_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'ja') $$,
  'A Member sets their language'
);
select is(
  (select ui_language from public.household_members where id = 'd2000000-0000-4000-8000-000000000002'),
  'ja', 'The language is stored on the Member'
);
select results_eq(
  $$ select actor_type, actor_id, care_chain_id, payload from public.audit_events where event_type = 'member.language_changed' $$,
  $$ values ('human'::text, 'd1000000-0000-4000-8000-000000000002'::uuid, null::uuid, '{"language": "ja"}'::jsonb) $$,
  'One member.language_changed event with the language only'
);
select lives_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'ja') $$,
  'Setting the same language again is accepted'
);
select is(
  (select count(*)::int from public.audit_events where event_type = 'member.language_changed'),
  1, 'An unchanged language writes no second event'
);
select lives_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'en') $$,
  'The language changes back'
);
select is(
  (select count(*)::int from public.audit_events where event_type = 'member.language_changed'),
  2, 'A real change writes a new event'
);
select lives_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'ja') $$,
  'The Care_Recipient can set their language'
);
select is(
  (select count(*)::int from public.household_members
   where household_id = 'd0000000-0000-4000-8000-000000000001' and ui_language is not null),
  2, 'Other Members are untouched'
);
-- ---------------------------------------------------------------------------
-- Privileges: browser roles cannot execute
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('confirm_part_time', 'save_part_amount', 'resolve_missing_detail',
                       'mark_feed_seen', 'set_member_language', 'save_appointment_clarification')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon and authenticated cannot execute the six functions'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('confirm_part_time', 'save_part_amount', 'resolve_missing_detail',
                       'mark_feed_seen', 'set_member_language', 'save_appointment_clarification')
     and has_function_privilege('service_role', p.oid, 'execute')),
  6, 'service_role can execute all six functions'
);
set local role authenticated;
select throws_ok(
  $$ select public.confirm_part_time('f5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004', 'task_due', '2026-12-05 01:00:00+00', 'Asia/Tokyo') $$,
  '42501', null, 'A browser session calling confirm_part_time is denied'
);
select throws_ok(
  $$ select public.save_part_amount('f5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000003', 1, 'JPY') $$,
  '42501', null, 'A browser session calling save_part_amount is denied'
);
select throws_ok(
  $$ select public.resolve_missing_detail('f6000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000002', 'x') $$,
  '42501', null, 'A browser session calling resolve_missing_detail is denied'
);
select throws_ok(
  $$ select public.mark_feed_seen('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'A browser session calling mark_feed_seen is denied'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.set_member_language('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001', 'ja') $$,
  '42501', null, 'An anonymous session calling set_member_language is denied'
);
select throws_ok(
  $$ select public.save_appointment_clarification('f5000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-000000000002', 'x', '2026-12-06 01:00:00+00', 'Asia/Tokyo') $$,
  '42501', null, 'An anonymous session calling save_appointment_clarification is denied'
);
reset role;
select * from finish();
rollback;
