-- pgTAP tests for public.decide_approval and public.resubmit_part
-- (migration 20261210000300_shared_care_functions).
-- Uses the demo household from seed.sql (exactly one active primary caregiver:
-- Misa) plus a fake outsider household. All new rows are fake and rolled back.
-- Demo members: Haruko ..01 care_recipient, Misa ..02 primary_caregiver, Kenta
-- ..03 finance_coordinator, Yui ..04 transport_coordinator.
begin;
create extension if not exists pgtap with schema extensions;
select plan(65);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'outsider.approval.test@example.com', now(), now());
insert into public.households (id, name)
values ('f0000000-0000-4000-8000-000000000001', 'Approval outsider household');
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
        'f3000000-0000-4000-8000-000000000001', 'Fake approval chain', 'high');
-- 01 pending, owner Yui         (approve by non-owner primary)
-- 02 pending, owner Misa        (self-approval, one primary)
-- 03 pending, owner Misa        (blocked with two primaries, then allowed after deactivation)
-- 04 pending, owner Misa        (blocked again after reactivation)
-- 05 pending, owner Yui         (non-primary, recipient, outsider, demoted, inactive, bad input)
-- 06 pending, owner Yui         (reject, resubmit with explanation)
-- 07 pending, owner Yui         (reject, resubmit via changed plan)
-- 08 pending, owner Yui         (reject, resubmit via evidence)
-- 09 low risk, approval not required, owner Yui
-- 10 pending, completed         (part_closed)
-- 11 rejected, completed        (resubmission_required before part_closed)
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, owner_id
)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
   'Approve by other primary', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000001',
   'Self approval', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000002'),
  ('f5000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000001',
   'Blocked then allowed', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000002'),
  ('f5000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000001',
   'Blocked again', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000002'),
  ('f5000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000001',
   'Refusals', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000001',
   'Resubmit explanation', 'appointment', 'high', true, 'evidence_required', 'pending', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000001',
   'Resubmit plan', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-000000000008', 'f4000000-0000-4000-8000-000000000001',
   'Resubmit evidence', 'appointment', 'high', true, 'in_progress', 'pending', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-000000000009', 'f4000000-0000-4000-8000-000000000001',
   'No approval needed', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-000000000001',
   'Closed pending', 'appointment', 'high', true, 'completed', 'pending', 'd2000000-0000-4000-8000-000000000004'),
  ('f5000000-0000-4000-8000-00000000000b', 'f4000000-0000-4000-8000-000000000001',
   'Closed rejected', 'appointment', 'high', true, 'completed', 'rejected', 'd2000000-0000-4000-8000-000000000004');

-- ---------------------------------------------------------------------------
-- Functions exist
-- ---------------------------------------------------------------------------
select has_function('public', 'decide_approval', array['uuid', 'uuid', 'text'], 'decide_approval(uuid, uuid, text) exists');
select has_function('public', 'resubmit_part', array['uuid', 'uuid', 'text', 'uuid[]'], 'resubmit_part(uuid, uuid, text, uuid[]) exists');
select is(
  (select count(*)::int from public.household_members
   where household_id = 'd0000000-0000-4000-8000-000000000001'
     and role = 'primary_caregiver' and is_active),
  1,
  'Fixture: the demo household has exactly one active primary caregiver'
);

-- ---------------------------------------------------------------------------
-- Approve by a primary caregiver who is not the Owner (step 01)
-- ---------------------------------------------------------------------------
select is(
  public.decide_approval('f5000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002', 'approve') ->> 'outcome',
  'approved',
  'An active primary caregiver approves a pending Part'
);
select is(
  (select approval_state || ' ' || approval_decided_by::text || ' ' || status
   from public.care_steps where id = 'f5000000-0000-4000-8000-000000000001'),
  'approved d2000000-0000-4000-8000-000000000002 in_progress',
  'Approval stores state and decider, and leaves the progress status unchanged'
);
select isnt(
  (select approval_decided_at from public.care_steps where id = 'f5000000-0000-4000-8000-000000000001'),
  null,
  'approval_decided_at is set'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001'),
  1,
  'One audit event for the approval'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type = 'approval.given'
     and actor_type = 'human' and actor_id = 'd1000000-0000-4000-8000-000000000002'
     and payload = '{"self_approval": false}'::jsonb),
  1,
  'The audit event is approval.given by the human actor with self_approval false'
);
select is(
  (select count(*)::int from public.feed_items f join public.audit_events a on a.id = f.audit_event_id
   where f.care_step_id = 'f5000000-0000-4000-8000-000000000001' and f.kind = 'approval_given'
     and f.recipient_member_id is null and a.event_type = 'approval.given'),
  1,
  'One household Feed_Item linked to the approval audit event'
);

-- ---------------------------------------------------------------------------
-- Self-approval (step 02: Misa is Owner and the only active primary)
-- ---------------------------------------------------------------------------
select is(
  public.decide_approval('f5000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000002', 'approve') ->> 'self_approval',
  'true',
  'The Owner who is the only active primary caregiver may approve'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000002' and event_type = 'approval.given'
     and payload = '{"self_approval": true}'::jsonb),
  1,
  'The audit payload carries self_approval true'
);
select is(
  (select approval_state from public.care_steps where id = 'f5000000-0000-4000-8000-000000000002'),
  'approved',
  'Self-approval sets the state approved'
);

-- ---------------------------------------------------------------------------
-- Self-approval blocked with two active primaries, evaluated at processing time
-- ---------------------------------------------------------------------------
update public.household_members set role = 'primary_caregiver'
where id = 'd2000000-0000-4000-8000-000000000003';
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000003',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'self_approval_blocked',
  'With two active primary caregivers the Owner cannot approve their own Part'
);
select is(
  (select approval_state from public.care_steps where id = 'f5000000-0000-4000-8000-000000000003')
  || ' ' || (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000003')
  || ' ' || (select count(*)::int from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-000000000003'),
  'pending 0 0',
  'A blocked self-approval writes nothing'
);
select is(
  public.decide_approval('f5000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000003', 'approve') ->> 'self_approval',
  'false',
  'The second primary caregiver can approve the Owner''s Part (not a self-approval)'
);

-- Step 04: still blocked; deactivate the second primary, approval then allowed.
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'self_approval_blocked',
  'Blocked while the second primary caregiver is active'
);
update public.household_members set is_active = false
where id = 'd2000000-0000-4000-8000-000000000003';
select is(
  public.decide_approval('f5000000-0000-4000-8000-000000000004',
    'd1000000-0000-4000-8000-000000000002', 'approve') ->> 'self_approval',
  'true',
  'After the second primary is deactivated the Owner may self-approve (count read at processing time)'
);
-- Reactivate and check the block returns on a fresh Part.
update public.household_members set is_active = true
where id = 'd2000000-0000-4000-8000-000000000003';
update public.care_steps set approval_state = 'pending'
where id = 'f5000000-0000-4000-8000-000000000004';
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'self_approval_blocked',
  'After reactivation the block applies again'
);
-- Back to one primary caregiver.
update public.household_members set role = 'finance_coordinator'
where id = 'd2000000-0000-4000-8000-000000000003';

-- ---------------------------------------------------------------------------
-- Refusals (step 05) and nothing written
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000003', 'approve') $$,
  'P0001', 'not_primary_caregiver', 'A member who is not a primary caregiver cannot approve'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000004', 'reject') $$,
  'P0001', 'not_primary_caregiver', 'A member who is not a primary caregiver cannot reject'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000001', 'approve') $$,
  'P0001', 'recipient_read_only', 'The care recipient cannot approve'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'f1000000-0000-4000-8000-000000000001', 'approve') $$,
  'P0001', 'part_not_found', 'A user from another household sees part_not_found'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-0000000000ff',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'part_not_found', 'An unknown Part is part_not_found'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000002', 'maybe') $$,
  'P0001', 'invalid_input', 'An unknown decision is invalid_input'
);
-- Demote Misa: the role is read at processing time.
update public.household_members set role = 'finance_coordinator'
where id = 'd2000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'not_primary_caregiver', 'A demoted primary caregiver is refused at processing time'
);
update public.household_members set role = 'primary_caregiver', is_active = false
where id = 'd2000000-0000-4000-8000-000000000002';
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'part_not_found', 'A deactivated primary caregiver is refused at processing time'
);
update public.household_members set is_active = true
where id = 'd2000000-0000-4000-8000-000000000002';
select is(
  (select approval_state from public.care_steps where id = 'f5000000-0000-4000-8000-000000000005')
  || ' ' || (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000005')
  || ' ' || (select count(*)::int from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-000000000005'),
  'pending 0 0',
  'Nothing is written for any refusal'
);

-- ---------------------------------------------------------------------------
-- Not required, closed
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000009',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'approval_not_required', 'A Part that needs no approval cannot be approved'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000009',
       'd1000000-0000-4000-8000-000000000002', 'reject') $$,
  'P0001', 'approval_not_required', 'A Part that needs no approval cannot be rejected'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-00000000000a',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'part_closed', 'A closed Part cannot be approved'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-00000000000a',
       'd1000000-0000-4000-8000-000000000002', 'reject') $$,
  'P0001', 'part_closed', 'A closed Part cannot be rejected'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-00000000000b',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'resubmission_required', 'part_closed is checked last: a closed rejected Part reports resubmission_required'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id in ('f5000000-0000-4000-8000-000000000009',
                          'f5000000-0000-4000-8000-00000000000a',
                          'f5000000-0000-4000-8000-00000000000b')),
  0,
  'Nothing is written for not-required or closed refusals'
);

-- ---------------------------------------------------------------------------
-- Reject, then approval needs a resubmission (step 06)
-- ---------------------------------------------------------------------------
select is(
  public.decide_approval('f5000000-0000-4000-8000-000000000006',
    'd1000000-0000-4000-8000-000000000002', 'reject') ->> 'outcome',
  'rejected',
  'A primary caregiver rejects a pending Part'
);
select is(
  (select approval_state || ' ' || approval_decided_by::text || ' ' || rejected_at_plan_version::text
          || ' ' || status
   from public.care_steps where id = 'f5000000-0000-4000-8000-000000000006'),
  'rejected d2000000-0000-4000-8000-000000000002 0 evidence_required',
  'Rejection stores state, decider, and plan version, and leaves the progress status unchanged'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and event_type = 'approval.rejected'
     and actor_type = 'human' and actor_id = 'd1000000-0000-4000-8000-000000000002'),
  1,
  'One approval.rejected audit event'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and kind = 'approval_rejected'
     and recipient_member_id is null),
  1,
  'One household Feed_Item for the rejection'
);
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  'P0001', 'resubmission_required', 'Approving a rejected Part needs a resubmission first'
);
select is(
  (select approval_state from public.care_steps where id = 'f5000000-0000-4000-8000-000000000006'),
  'rejected',
  'The state stays rejected after the refused approval'
);

-- ---------------------------------------------------------------------------
-- Resubmission refusals (step 06)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000002', 'I am not the owner', '{}') $$,
  'P0001', 'not_owner', 'Only the Owner can resubmit'
);
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000001', 'recipient', '{}') $$,
  'P0001', 'recipient_read_only', 'The care recipient cannot resubmit'
);
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'f1000000-0000-4000-8000-000000000001', 'outsider', '{}') $$,
  'P0001', 'part_not_found', 'A user from another household sees part_not_found'
);
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000004', null, '{}') $$,
  'P0001', 'resubmission_empty', 'A resubmission with nothing added is refused'
);
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000004', E'  \n\t ', '{}') $$,
  'P0001', 'resubmission_empty', 'A blank explanation counts as empty'
);
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000004', 'not rejected', '{}') $$,
  'P0001', 'not_rejected', 'A Part that is not rejected cannot be resubmitted'
);
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000004', null,
       array['f6000000-0000-4000-8000-0000000000ff']::uuid[]) $$,
  'P0001', 'invalid_input', 'Evidence that does not belong to the Part is invalid_input'
);
select is(
  (select approval_state from public.care_steps where id = 'f5000000-0000-4000-8000-000000000006')
  || ' ' || (select count(*)::int from public.part_resubmissions where care_step_id = 'f5000000-0000-4000-8000-000000000006')
  || ' ' || (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000006'),
  'rejected 0 1',
  'Refused resubmissions write nothing (only the rejection event exists)'
);

-- ---------------------------------------------------------------------------
-- Resubmit with an explanation (step 06)
-- ---------------------------------------------------------------------------
select is(
  public.resubmit_part('f5000000-0000-4000-8000-000000000006',
    'd1000000-0000-4000-8000-000000000004', 'Dr Fake confirmed the clinic by phone', '{}') ->> 'outcome',
  'resubmitted',
  'The Owner resubmits with a written explanation'
);
select is(
  (select approval_state || ' ' || status from public.care_steps
   where id = 'f5000000-0000-4000-8000-000000000006'),
  'pending evidence_required',
  'The state returns to pending and the progress status is unchanged'
);
select is(
  (select explanation || '|' || submitted_by::text || '|' || plan_changed::text
   from public.part_resubmissions where care_step_id = 'f5000000-0000-4000-8000-000000000006'),
  'Dr Fake confirmed the clinic by phone|d2000000-0000-4000-8000-000000000004|false',
  'The explanation text is stored in part_resubmissions'
);
select is(
  (select count(*)::int from public.audit_events
   where household_id = 'd0000000-0000-4000-8000-000000000001'
     and payload::text like '%Dr Fake%'),
  0,
  'The explanation text appears in no audit payload'
);
select is(
  (select payload - 'resubmission_id' from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and event_type = 'approval.resubmitted'),
  '{"added": ["explanation"], "evidence_count": 0}'::jsonb,
  'The resubmission audit payload names only the kinds added and counts'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006'
     and event_type in ('approval.rejected', 'approval.resubmitted')),
  2,
  'The rejection event stays in the audit trail next to the resubmission'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and event_type = 'reminder.sent'
     and payload ->> 'recipient_member_id' = 'd2000000-0000-4000-8000-000000000002'),
  1,
  'An in-app reminder goes to the active primary caregiver'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and kind = 'approval_resubmitted'
     and recipient_member_id is null),
  1,
  'One household Feed_Item for the resubmission'
);
select is(
  public.decide_approval('f5000000-0000-4000-8000-000000000006',
    'd1000000-0000-4000-8000-000000000002', 'approve') ->> 'outcome',
  'approved',
  'After the resubmission the Part can be approved'
);

-- ---------------------------------------------------------------------------
-- Resubmit via a changed plan (step 07)
-- ---------------------------------------------------------------------------
select public.decide_approval('f5000000-0000-4000-8000-000000000007',
  'd1000000-0000-4000-8000-000000000002', 'reject');
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000007',
       'd1000000-0000-4000-8000-000000000004', null, '{}') $$,
  'P0001', 'resubmission_empty', 'Same plan version and nothing added is empty'
);
update public.care_steps set plan_version = plan_version + 1
where id = 'f5000000-0000-4000-8000-000000000007';
select is(
  public.resubmit_part('f5000000-0000-4000-8000-000000000007',
    'd1000000-0000-4000-8000-000000000004', null, '{}') -> 'added',
  '["changed_plan"]'::jsonb,
  'A newer plan version alone is enough to resubmit'
);
select is(
  (select s.approval_state || ' ' || r.plan_changed::text
   from public.care_steps s
   join public.part_resubmissions r on r.care_step_id = s.id and r.explanation is null
   where s.id = 'f5000000-0000-4000-8000-000000000007'),
  'pending true',
  'The plan-change resubmission is stored with no explanation and the state is pending'
);

-- ---------------------------------------------------------------------------
-- Resubmit via new evidence (step 08)
-- ---------------------------------------------------------------------------
select public.decide_approval('f5000000-0000-4000-8000-000000000008',
  'd1000000-0000-4000-8000-000000000002', 'reject');
insert into public.part_evidence (
  id, household_id, care_chain_id, care_step_id, label, kind, text_body, added_by
)
values (
  'f6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000008',
  'other', 'text', 'fake evidence text', 'd2000000-0000-4000-8000-000000000004'
);
select is(
  public.resubmit_part('f5000000-0000-4000-8000-000000000008',
    'd1000000-0000-4000-8000-000000000004', null,
    array['f6000000-0000-4000-8000-000000000001']::uuid[]) -> 'added',
  '["evidence"]'::jsonb,
  'New evidence alone is enough to resubmit'
);
select is(
  (select payload - 'resubmission_id' from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000008' and event_type = 'approval.resubmitted'),
  '{"added": ["evidence"], "evidence_count": 1}'::jsonb,
  'The audit payload holds the evidence count, not the evidence'
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('decide_approval', 'resubmit_part')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'anon and authenticated cannot execute decide_approval or resubmit_part'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('decide_approval', 'resubmit_part')
     and has_function_privilege('service_role', p.oid, 'execute')),
  2,
  'service_role can execute both functions'
);
set local role authenticated;
select throws_ok(
  $$ select public.decide_approval('f5000000-0000-4000-8000-000000000005',
       'd1000000-0000-4000-8000-000000000002', 'approve') $$,
  '42501', null, 'A browser session calling decide_approval is denied by the database'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.resubmit_part('f5000000-0000-4000-8000-000000000006',
       'd1000000-0000-4000-8000-000000000004', 'x', '{}') $$,
  '42501', null, 'An anonymous session calling resubmit_part is denied by the database'
);
reset role;

select * from finish();
rollback;
