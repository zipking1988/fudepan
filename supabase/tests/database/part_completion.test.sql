-- pgTAP tests for public.complete_part, report_part_failed, reopen_part, and
-- record_evidence (migration 20261210000300_shared_care_functions).
-- Uses the demo household from seed.sql plus a fake outsider household.
-- Demo members: Haruko ..01 care_recipient, Misa ..02 primary_caregiver, Kenta
-- ..03 finance_coordinator, Yui ..04 transport_coordinator, Aiko ..05
-- professional_caregiver. All new rows are fake and rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(93);
-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'outsider.completion.test@example.com', now(), now());
insert into public.households (id, name)
values ('e0000000-0000-4000-8000-000000000001', 'Completion outsider household');
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
        'e3000000-0000-4000-8000-000000000001', 'Fake completion chain', 'high');
-- Owner is Yui (..04) unless stated. Step ids e5...0000000NN (hex).
-- 01 approved, no evidence required            (complete ok, one audit/feed)
-- 02 approved, driver Kenta, companion Aiko    (not_owner, recipient, outsider)
-- 03 pending approval                          (approval_pending)
-- 04 rejected approval                         (approval_pending)
-- 05 approved, needs Receipt + Photo           (evidence_required result, then completed)
-- 06 approved, status escalated, needs Receipt (completes once evidence exists)
-- 07 approved, status evidence_required        (completes, nothing missing)
-- 08 low risk, approval not required           (completes)
-- 09 completed                                 (part_closed)
-- 0a failed                                    (part_closed)
-- 0b approved, driver Kenta, companion Aiko    (report_part_failed)
-- 0c failed, approved                          (reopen refusals, then by primary)
-- 0d failed, pending approval                  (reopen by Owner)
-- 0e in_progress                               (not_failed)
-- 0f approved, driver Kenta, companion Aiko    (record_evidence)
-- 10 failed, approved, escalation ledger row   (reopen keeps the ledger)
-- 11 no owner                                  (not_owner)
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, owner_id, driver_id, companion_id, evidence_required
)
values
  ('e5000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
   'Complete ok', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-000000000002', 'e4000000-0000-4000-8000-000000000001',
   'Not owner', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003',
   'd2000000-0000-4000-8000-000000000005', '{}'),
  ('e5000000-0000-4000-8000-000000000003', 'e4000000-0000-4000-8000-000000000001',
   'Pending', 'appointment', 'high', true, 'in_progress', 'pending',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-000000000004', 'e4000000-0000-4000-8000-000000000001',
   'Rejected', 'appointment', 'high', true, 'in_progress', 'rejected',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-000000000005', 'e4000000-0000-4000-8000-000000000001',
   'Needs evidence', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, array['Receipt', 'Photo']),
  ('e5000000-0000-4000-8000-000000000006', 'e4000000-0000-4000-8000-000000000001',
   'Escalated', 'appointment', 'high', true, 'escalated', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, array['Receipt']),
  ('e5000000-0000-4000-8000-000000000007', 'e4000000-0000-4000-8000-000000000001',
   'Evidence status', 'appointment', 'high', true, 'evidence_required', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-000000000008', 'e4000000-0000-4000-8000-000000000001',
   'Low risk', 'household', 'low', false, 'in_progress', 'not_required',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-000000000009', 'e4000000-0000-4000-8000-000000000001',
   'Already completed', 'appointment', 'high', true, 'completed', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-00000000000a', 'e4000000-0000-4000-8000-000000000001',
   'Already failed', 'appointment', 'high', true, 'failed', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-00000000000b', 'e4000000-0000-4000-8000-000000000001',
   'Fail by helpers', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003',
   'd2000000-0000-4000-8000-000000000005', '{}'),
  ('e5000000-0000-4000-8000-00000000000c', 'e4000000-0000-4000-8000-000000000001',
   'Reopen refusals', 'appointment', 'high', true, 'failed', 'approved',
   'd2000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003',
   'd2000000-0000-4000-8000-000000000005', '{}'),
  ('e5000000-0000-4000-8000-00000000000d', 'e4000000-0000-4000-8000-000000000001',
   'Reopen by owner', 'appointment', 'high', true, 'failed', 'pending',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-00000000000e', 'e4000000-0000-4000-8000-000000000001',
   'Not failed', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-00000000000f', 'e4000000-0000-4000-8000-000000000001',
   'Evidence', 'appointment', 'high', true, 'in_progress', 'approved',
   'd2000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000003',
   'd2000000-0000-4000-8000-000000000005', '{}'),
  ('e5000000-0000-4000-8000-000000000010', 'e4000000-0000-4000-8000-000000000001',
   'Reopen keeps ledger', 'appointment', 'high', true, 'failed', 'approved',
   'd2000000-0000-4000-8000-000000000004', null, null, '{}'),
  ('e5000000-0000-4000-8000-000000000011', 'e4000000-0000-4000-8000-000000000001',
   'No owner', 'appointment', 'high', true, 'in_progress', 'approved',
   null, null, null, '{}');
-- An escalation ledger row for step 10, with its audit event.
insert into public.step_escalations (household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id)
values ('d0000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
        'e5000000-0000-4000-8000-000000000010', 'task_due',
        '2026-01-01T00:00:00Z',
        private.write_audit('d0000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001',
          'e5000000-0000-4000-8000-000000000010', null, 'system', null, 'escalation.created', '{}'::jsonb));
-- ---------------------------------------------------------------------------
-- Functions exist
-- ---------------------------------------------------------------------------
select has_function('public', 'complete_part', array['uuid', 'uuid'], 'complete_part(uuid, uuid) exists');
select has_function('public', 'report_part_failed', array['uuid', 'uuid', 'text'], 'report_part_failed(uuid, uuid, text) exists');
select has_function('public', 'reopen_part', array['uuid', 'uuid'], 'reopen_part(uuid, uuid) exists');
select has_function('public', 'record_evidence', array['uuid', 'uuid', 'text', 'text', 'text', 'text'], 'record_evidence(...) exists');
-- ---------------------------------------------------------------------------
-- complete_part: the Owner completes an approved Part (step 01)
-- ---------------------------------------------------------------------------
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'completed', 'The Owner completes an approved Part'
);
select is(
  (select status || ' ' || approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-000000000001'),
  'completed approved', 'Completion sets status completed and leaves approval_state unchanged'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000001'),
  1, 'One audit event for the completion'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000001' and event_type = 'part.completed'
     and actor_type = 'human' and actor_id = 'd1000000-0000-4000-8000-000000000004' and payload = '{}'::jsonb),
  1, 'The audit event is part.completed by the human actor with an empty payload'
);
select is(
  (select count(*)::int from public.feed_items f join public.audit_events a on a.id = f.audit_event_id
   where f.care_step_id = 'e5000000-0000-4000-8000-000000000001' and f.kind = 'completed'
     and f.recipient_member_id is null and a.event_type = 'part.completed'),
  1, 'One household Feed_Item linked to the completion audit event'
);
-- ---------------------------------------------------------------------------
-- complete_part refusals (nothing is written)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_owner', 'A Driver who is not the Owner cannot complete'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_owner', 'A primary caregiver who is not the Owner cannot complete'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000011', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'not_owner', 'A Part with no Owner cannot be completed'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot complete'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000002', 'e1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'part_not_found', 'A user outside the household sees part_not_found'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-0000000000ff', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'part_not_found', 'An unknown Part is part_not_found'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'approval_pending', 'A pending approval blocks completion'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'approval_pending', 'A rejected approval blocks completion'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'part_closed', 'A completed Part is closed'
);
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'part_closed', 'A failed Part is closed for completion'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id in ('e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003',
                          'e5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000009',
                          'e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000011'))
  + (select count(*)::int from public.feed_items
   where care_step_id in ('e5000000-0000-4000-8000-000000000002', 'e5000000-0000-4000-8000-000000000003',
                          'e5000000-0000-4000-8000-000000000004', 'e5000000-0000-4000-8000-000000000009',
                          'e5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-000000000011')),
  0, 'Refused completions write no audit events and no Feed_Items'
);
select is(
  (select string_agg(id::text || ':' || status || ':' || approval_state, ',' order by id) from public.care_steps
   where id in ('e5000000-0000-4000-8000-000000000003', 'e5000000-0000-4000-8000-000000000004')),
  'e5000000-0000-4000-8000-000000000003:in_progress:pending,e5000000-0000-4000-8000-000000000004:in_progress:rejected',
  'Refused completions leave status and approval_state unchanged'
);
-- ---------------------------------------------------------------------------
-- complete_part: missing Evidence is a committed result (step 05)
-- ---------------------------------------------------------------------------
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000004') - 'audit_event_id',
  jsonb_build_object(
    'care_chain_id', 'e4000000-0000-4000-8000-000000000001',
    'note_id', 'e3000000-0000-4000-8000-000000000001',
    'outcome', 'evidence_required',
    'approval_reset', false,
    'missing', jsonb_build_array('Receipt', 'Photo')
  ),
  'Missing Evidence returns outcome evidence_required listing the missing labels in order'
);
select is(
  (select status || ' ' || approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-000000000005'),
  'evidence_required approved', 'The evidence_required outcome is committed and approval_state is unchanged'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-000000000005' and event_type = 'part.evidence_missing'),
  '{"missing_count": 2}'::jsonb, 'The part.evidence_missing payload holds only the count'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'e5000000-0000-4000-8000-000000000005' and kind = 'evidence_missing'),
  1, 'One Feed_Item for the evidence_required outcome'
);
select is(
  public.record_evidence('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000004',
    'Receipt', 'text', null, 'Receipt number 1234') ->> 'outcome',
  'recorded', 'The Owner records text Evidence'
);
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000004') -> 'missing',
  '["Photo"]'::jsonb, 'After one label is attached only the other is listed as missing'
);
select is(
  public.record_evidence('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000004',
    'Photo', 'photo', 'd0000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000005/1763700000001-evidence.jpg',
    null) ->> 'outcome',
  'recorded', 'The Owner records photo Evidence at the household/step path'
);
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000005', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'completed', 'A Part in evidence_required completes once all required Evidence exists'
);
-- ---------------------------------------------------------------------------
-- complete_part from escalated / evidence_required status
-- ---------------------------------------------------------------------------
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'evidence_required', 'An escalated approved Part with missing Evidence returns evidence_required'
);
select is(
  public.record_evidence('e5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000004',
    'Receipt', 'text', null, 'Done at the desk') ->> 'outcome',
  'recorded', 'Evidence is recorded on an evidence_required Part'
);
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000006', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'completed', 'An approved Part that was escalated then evidence_required completes once Evidence exists'
);
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000007', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'completed', 'An approved Part in evidence_required status with nothing missing completes'
);
select is(
  (select status || ' ' || approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-000000000007'),
  'completed approved', 'Approval_State stays approved through evidence_required and completion'
);
select is(
  public.complete_part('e5000000-0000-4000-8000-000000000008', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'completed', 'A Part that needs no approval completes'
);
select is(
  (select approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-000000000008'),
  'not_required', 'approval_state not_required is unchanged by completion'
);
-- ---------------------------------------------------------------------------
-- report_part_failed (step 0b)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000002', 'could_not_go') $$,
  'P0001', 'not_holder', 'A primary caregiver who holds no role cannot report failure'
);
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000001', 'could_not_go') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot report failure'
);
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-00000000000b', 'e1000000-0000-4000-8000-000000000001', 'could_not_go') $$,
  'P0001', 'part_not_found', 'An outsider sees part_not_found on report_part_failed'
);
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-000000000009', 'd1000000-0000-4000-8000-000000000004', 'could_not_go') $$,
  'P0001', 'part_closed', 'A completed Part cannot be reported failed'
);
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000004', 'could_not_go') $$,
  'P0001', 'part_closed', 'A failed Part cannot be reported failed again'
);
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000005', 'Free text with spaces') $$,
  'P0001', 'invalid_input', 'The reason must be a short code, not free text'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-00000000000b')
  + (select count(*)::int from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-00000000000b'),
  0, 'Refused failure reports write nothing'
);
select is(
  public.report_part_failed('e5000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000005', 'could_not_go') ->> 'outcome',
  'failed', 'A Companion reports the Part failed'
);
select is(
  (select status || ' ' || approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-00000000000b'),
  'failed approved', 'Failure sets status failed and leaves approval_state unchanged'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-00000000000b' and event_type = 'part.failed'
     and actor_id = 'd1000000-0000-4000-8000-000000000005' and payload = '{"reason_code": "could_not_go"}'::jsonb),
  1, 'One part.failed audit event with the reason code'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'e5000000-0000-4000-8000-00000000000b' and kind = 'part_failed' and recipient_member_id is null),
  1, 'One household Feed_Item for the failure'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'e5000000-0000-4000-8000-00000000000b' and kind = 'part_failed'
     and recipient_member_id = 'd2000000-0000-4000-8000-000000000002'),
  1, 'The active primary caregiver gets one reminder'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-00000000000b' and event_type = 'reminder.sent'),
  1, 'The reminder has its own reminder.sent audit event'
);
-- ---------------------------------------------------------------------------
-- reopen_part
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000e', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_failed', 'Only a failed Part can be reopened'
);
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_allowed_reopen', 'A Driver who is not the Owner cannot reopen'
);
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000005') $$,
  'P0001', 'not_allowed_reopen', 'A Companion who is not the Owner cannot reopen'
);
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot reopen'
);
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000c', 'e1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'part_not_found', 'A primary caregiver of another household cannot reopen'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-00000000000c')
  + (select count(*)::int from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-00000000000c'),
  0, 'Refused reopens write nothing'
);
select is(
  public.reopen_part('e5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000002') ->> 'outcome',
  'reopened', 'An active primary caregiver reopens a failed Part'
);
select is(
  (select status || ' ' || approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-00000000000c'),
  'in_progress approved', 'Reopen sets in_progress and leaves approval_state unchanged'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-00000000000c' and event_type = 'part.reopened'
     and actor_id = 'd1000000-0000-4000-8000-000000000002' and payload = '{}'::jsonb),
  1, 'One part.reopened audit event'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'e5000000-0000-4000-8000-00000000000c' and kind = 'part_reopened'),
  1, 'One Feed_Item for the reopen'
);
select is(
  public.reopen_part('e5000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'reopened', 'The Owner reopens their own failed Part'
);
select is(
  (select approval_state from public.care_steps where id = 'e5000000-0000-4000-8000-00000000000d'),
  'pending', 'A pending approval stays pending after reopen'
);
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000d', 'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'not_failed', 'A reopened Part cannot be reopened again'
);
-- A demoted primary caregiver is no longer allowed (role read at processing time).
update public.household_members set role = 'finance_coordinator'
where id = 'd2000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_allowed_reopen', 'A demoted primary caregiver cannot reopen'
);
update public.household_members set role = 'primary_caregiver'
where id = 'd2000000-0000-4000-8000-000000000002';
select is(
  public.reopen_part('e5000000-0000-4000-8000-000000000010', 'd1000000-0000-4000-8000-000000000002') ->> 'outcome',
  'reopened', 'Reopen of a Part with an escalation ledger row succeeds'
);
select is(
  (select count(*)::int from public.step_escalations
   where care_step_id = 'e5000000-0000-4000-8000-000000000010'),
  1, 'Reopen does not clear the escalation ledger row for the old deadline'
);
-- ---------------------------------------------------------------------------
-- record_evidence (step 0f)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000001', 'Receipt', 'text', null, 'x') $$,
  'P0001', 'recipient_read_only', 'The Care_Recipient cannot record Evidence'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000002', 'Receipt', 'text', null, 'x') $$,
  'P0001', 'not_holder', 'A member who holds no role cannot record Evidence'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'e1000000-0000-4000-8000-000000000001', 'Receipt', 'text', null, 'x') $$,
  'P0001', 'part_not_found', 'An outsider sees part_not_found on record_evidence'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', '  ', 'text', null, 'x') $$,
  'P0001', 'invalid_input', 'A blank label is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'video', null, 'x') $$,
  'P0001', 'invalid_input', 'An unknown kind is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'text', null, '   ') $$,
  'P0001', 'invalid_input', 'Blank text is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'text', null, repeat('a', 2001)) $$,
  'P0001', 'invalid_input', 'Text over 2000 characters is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'photo', null, null) $$,
  'P0001', 'invalid_input', 'A photo without a path is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'photo',
       'e0000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-00000000000f/1763700000002-evidence.jpg', null) $$,
  'P0001', 'invalid_input', 'A path under another household is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'file',
       'd0000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-000000000002/1763700000002-evidence.pdf', null) $$,
  'P0001', 'invalid_input', 'A path under another Part is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'file',
       'd0000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-00000000000f/../x-evidence.pdf', null) $$,
  'P0001', 'invalid_input', 'A malformed path is invalid'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003', 'Receipt', 'text',
       'd0000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-00000000000f/1763700000002-evidence.pdf', 'x') $$,
  'P0001', 'invalid_input', 'Text Evidence with a path is invalid'
);
select is(
  (select count(*)::int from public.part_evidence where care_step_id = 'e5000000-0000-4000-8000-00000000000f')
  + (select count(*)::int from public.audit_events where care_step_id = 'e5000000-0000-4000-8000-00000000000f')
  + (select count(*)::int from public.feed_items where care_step_id = 'e5000000-0000-4000-8000-00000000000f'),
  0, 'Refused Evidence writes no evidence, audit, or feed rows'
);
select is(
  public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000003',
    'Receipt', 'text', null, 'Secret handwritten detail 987') ->> 'outcome',
  'recorded', 'A Driver records text Evidence'
);
select is(
  public.record_evidence('e5000000-0000-4000-8000-00000000000f', 'd1000000-0000-4000-8000-000000000005',
    'Photo', 'file', 'd0000000-0000-4000-8000-000000000001/e5000000-0000-4000-8000-00000000000f/1763700000003-evidence.pdf',
    null) ->> 'outcome',
  'recorded', 'A Companion records file Evidence'
);
select is(
  (select count(*)::int from public.part_evidence
   where care_step_id = 'e5000000-0000-4000-8000-00000000000f'
     and ((kind = 'text' and text_body = 'Secret handwritten detail 987' and storage_path is null)
       or (kind = 'file' and storage_path like '%1763700000003-evidence.pdf' and text_body is null))),
  2, 'Text and path are stored in part_evidence'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'e5000000-0000-4000-8000-00000000000f'),
  2, 'One audit event per recorded Evidence item'
);
select is(
  (select count(*)::int from public.audit_events a
   where a.care_step_id = 'e5000000-0000-4000-8000-00000000000f' and a.event_type = 'evidence.uploaded'
     and (select array_agg(k order by k) from jsonb_object_keys(a.payload) k) = array['evidence_id', 'kind']
     and (a.payload ->> 'evidence_id')::uuid in (select id from public.part_evidence)),
  2, 'The evidence.uploaded payload names only the kind and the evidence id'
);
select is(
  (select count(*)::int from public.audit_events a
   where a.household_id = 'd0000000-0000-4000-8000-000000000001'
     and (a.payload::text like '%Secret handwritten%' or a.payload::text like '%1763700000003%'
          or a.payload::text like '%Receipt number%' or a.payload::text like '%Done at the desk%')),
  0, 'No evidence text or path appears in any audit payload'
);
select is(
  (select count(*)::int from public.feed_items f
   where f.household_id = 'd0000000-0000-4000-8000-000000000001'
     and (f.params::text like '%Secret handwritten%' or f.params::text like '%1763700000003%')),
  0, 'No evidence text or path appears in any Feed_Item'
);
select is(
  (select count(*)::int from public.feed_items f join public.audit_events a on a.id = f.audit_event_id
   where f.care_step_id = 'e5000000-0000-4000-8000-00000000000f' and f.kind = 'evidence_added'
     and a.event_type = 'evidence.uploaded'),
  2, 'One linked household Feed_Item per Evidence item'
);
select is(
  (select status from public.care_steps where id = 'e5000000-0000-4000-8000-00000000000f'),
  'in_progress', 'Recording Evidence does not change the status'
);
-- ---------------------------------------------------------------------------
-- Browser roles cannot execute the functions
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('complete_part', 'report_part_failed', 'reopen_part', 'record_evidence')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0, 'anon and authenticated cannot execute the four functions'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('complete_part', 'report_part_failed', 'reopen_part', 'record_evidence')
     and has_function_privilege('service_role', p.oid, 'execute')),
  4, 'service_role can execute all four functions'
);
set local role authenticated;
select throws_ok(
  $$ select public.complete_part('e5000000-0000-4000-8000-00000000000e', 'd1000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'A browser session calling complete_part is denied by the database'
);
select throws_ok(
  $$ select public.record_evidence('e5000000-0000-4000-8000-00000000000e', 'd1000000-0000-4000-8000-000000000004', 'a', 'text', null, 'x') $$,
  '42501', null, 'A browser session calling record_evidence is denied by the database'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.reopen_part('e5000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-000000000004') $$,
  '42501', null, 'An anonymous session calling reopen_part is denied by the database'
);
select throws_ok(
  $$ select public.report_part_failed('e5000000-0000-4000-8000-00000000000e', 'd1000000-0000-4000-8000-000000000004', 'x') $$,
  '42501', null, 'An anonymous session calling report_part_failed is denied by the database'
);
reset role;
select * from finish();
rollback;
