-- pgTAP tests for the request functions of migration
-- 20261210000300_shared_care_functions: request_assignment, request_handover,
-- request_backup, volunteer_backup, respond_to_request, expire_care_requests.
-- Uses the demo household from seed.sql plus a fake outsider household. All new
-- rows are fake and rolled back. Demo members:
--   Haruko d2..01 care_recipient, Misa d2..02 primary_caregiver,
--   Kenta d2..03 finance_coordinator, Yui d2..04 transport_coordinator.
-- Users are d1..01 to d1..04 in the same order.
begin;
create extension if not exists pgtap with schema extensions;
select plan(129);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'f1000000-0000-4000-8000-000000000001',
        'authenticated', 'authenticated', 'outsider.requests.test@example.com', now(), now());
insert into public.households (id, name)
values ('f0000000-0000-4000-8000-000000000001', 'Requests outsider household');
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
        'f3000000-0000-4000-8000-000000000001', 'Fake requests chain', 'high');

-- 01 appointment high approved, owner Misa, human_confirmed due in 3 days (handover, task_due rule)
-- 02 appointment high approved, pending_review, unclaimed (assignment accepted, reset)
-- 03 household low, pending_review, unclaimed (assignment declined, then left pending)
-- 04 appointment high, completed (closed)
-- 05 appointment high approved, owner Kenta, driver Misa, no due (driver handover, 24h rule)
-- 06 household low, owner Misa (handover declined)
-- 07 household low, owner Misa (accept after expiry)
-- 08 household low, owner Misa (holder_changed)
-- 09 household low, owner Misa (backup refused, declined)
-- 10 appointment high approved, owner Kenta (backup accepted, no approval change)
-- 11 household low, owner Misa (volunteer)
-- 12 appointment high approved, owner Kenta (volunteer, no approval change)
-- 13 household low, unclaimed (sweep: assignment)
-- 14 household low, owner Misa (sweep: handover)
-- 15 household low, owner Misa (sweep with later p_now)
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, owner_id, driver_id
)
values
  ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
   'Handover task due', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-000000000002', 'f4000000-0000-4000-8000-000000000001',
   'Assignment approved', 'appointment', 'high', true, 'pending_review', 'approved', null, null),
  ('f5000000-0000-4000-8000-000000000003', 'f4000000-0000-4000-8000-000000000001',
   'Assignment declined', 'household', 'low', false, 'pending_review', 'not_required', null, null),
  ('f5000000-0000-4000-8000-000000000004', 'f4000000-0000-4000-8000-000000000001',
   'Completed', 'appointment', 'high', true, 'completed', 'approved', null, null),
  ('f5000000-0000-4000-8000-000000000005', 'f4000000-0000-4000-8000-000000000001',
   'Driver handover', 'appointment', 'high', true, 'approved', 'approved',
   'd2000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002'),
  ('f5000000-0000-4000-8000-000000000006', 'f4000000-0000-4000-8000-000000000001',
   'Handover declined', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-000000000007', 'f4000000-0000-4000-8000-000000000001',
   'Accept after expiry', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-000000000008', 'f4000000-0000-4000-8000-000000000001',
   'Holder changed', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-000000000009', 'f4000000-0000-4000-8000-000000000001',
   'Backup declined', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-00000000000a', 'f4000000-0000-4000-8000-000000000001',
   'Backup accepted', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000003', null),
  ('f5000000-0000-4000-8000-00000000000b', 'f4000000-0000-4000-8000-000000000001',
   'Volunteer', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-00000000000c', 'f4000000-0000-4000-8000-000000000001',
   'Volunteer approved', 'appointment', 'high', true, 'approved', 'approved', 'd2000000-0000-4000-8000-000000000003', null),
  ('f5000000-0000-4000-8000-00000000000d', 'f4000000-0000-4000-8000-000000000001',
   'Sweep assignment', 'household', 'low', false, 'pending_review', 'not_required', null, null),
  ('f5000000-0000-4000-8000-00000000000e', 'f4000000-0000-4000-8000-000000000001',
   'Sweep handover', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null),
  ('f5000000-0000-4000-8000-00000000000f', 'f4000000-0000-4000-8000-000000000001',
   'Sweep later', 'household', 'low', false, 'in_progress', 'not_required', 'd2000000-0000-4000-8000-000000000002', null);

update public.care_steps
set task_due_at = now() + interval '3 days', task_due_timezone = 'Asia/Tokyo',
    task_due_provenance = 'human_confirmed', task_due_set_by = 'd2000000-0000-4000-8000-000000000002'
where id = 'f5000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Functions exist
-- ---------------------------------------------------------------------------
select has_function('public', 'request_assignment', array['uuid', 'uuid', 'uuid'], 'request_assignment exists');
select has_function('public', 'request_handover', array['uuid', 'uuid', 'text', 'uuid'], 'request_handover exists');
select has_function('public', 'request_backup', array['uuid', 'uuid', 'uuid'], 'request_backup exists');
select has_function('public', 'volunteer_backup', array['uuid', 'uuid'], 'volunteer_backup exists');
select has_function('public', 'respond_to_request', array['uuid', 'uuid', 'boolean'], 'respond_to_request exists');
select has_function('public', 'expire_care_requests', array['uuid', 'timestamp with time zone'], 'expire_care_requests exists');

-- ---------------------------------------------------------------------------
-- request_assignment refusals (step 02)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'not_primary_caregiver', 'A non-primary member cannot start an Assignment'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001') $$,
  'P0001', 'receiver_not_eligible', 'A care recipient is not an eligible receiver'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002') $$,
  'P0001', 'receiver_not_eligible', 'The requester cannot be the receiver'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', 'f2000000-0000-4000-8000-000000000001') $$,
  'P0001', 'receiver_not_eligible', 'A member of another household is not an eligible receiver'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', null) $$,
  'P0001', 'receiver_not_eligible', 'A missing receiver is not eligible'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'recipient_read_only', 'A care recipient cannot start an Assignment'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'f1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'part_not_found', 'An outsider gets part_not_found'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-00000000ffff',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'part_not_found', 'An unknown Part gets part_not_found'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'part_closed', 'A completed Part refuses an Assignment'
);
select is(
  (select count(*)::int from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000002')
  + (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000002')
  + (select count(*)::int from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-000000000002'),
  0,
  'Refused Assignments wrote no request, audit event, or Feed_Item'
);

-- ---------------------------------------------------------------------------
-- request_assignment success (step 02: Misa asks Kenta)
-- ---------------------------------------------------------------------------
select is(
  public.request_assignment('f5000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') ->> 'outcome',
  'requested',
  'A Primary_Caregiver asks another member to take the Owner role'
);
select is(
  (select owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-000000000002'),
  null,
  'The Owner does not change while the Assignment is pending'
);
select is(
  (select kind || ' ' || helper_role || ' ' || status || ' ' || expiry_rule || ' '
     || (expires_at = now() + interval '24 hours')::text
     || ' ' || (from_member_id = 'd2000000-0000-4000-8000-000000000002')::text
     || ' ' || (to_member_id = 'd2000000-0000-4000-8000-000000000003')::text
   from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000002'),
  'assignment owner pending 24h true true true',
  'The request is pending, for owner, expires in 24 hours, from Misa to Kenta'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000002' and event_type <> 'reminder.sent'),
  array['assignment.requested'],
  'One primary audit event: assignment.requested'
);
select is(
  (select (payload ? 'request_id')::text || ' ' || (payload ->> 'role') || ' ' || (payload ->> 'expiry_rule')
          || ' ' || (payload ->> 'receiver_member_id')
   from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000002' and event_type = 'assignment.requested'),
  'true owner 24h d2000000-0000-4000-8000-000000000003',
  'The audit payload holds only IDs and codes'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000002'
     and kind = 'assignment_requested' and recipient_member_id is null),
  1,
  'One household Feed_Item for the request'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000002'
     and recipient_member_id = 'd2000000-0000-4000-8000-000000000003'),
  1,
  'One In_App_Reminder addressed to the receiver'
);
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-000000000002',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'request_pending', 'A second pending Assignment on the same Part is refused'
);
select throws_ok(
  $$ insert into public.care_requests (household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule)
     values ('d0000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
       'f5000000-0000-4000-8000-000000000002', 'assignment', 'owner',
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004', now(), '24h') $$,
  '23505', null, 'The database allows one pending request per Part, kind, and role'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000002'),
  2,
  'The refused duplicate wrote nothing (request event plus one reminder)'
);

-- ---------------------------------------------------------------------------
-- respond_to_request refusals and accept (step 02)
-- ---------------------------------------------------------------------------
create temp table req02 as
select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000002';

select throws_ok(
  $$ select public.respond_to_request((select id from req02), 'd1000000-0000-4000-8000-000000000004', true) $$,
  'P0001', 'request_not_found', 'Someone who is not the receiver gets request_not_found'
);
select throws_ok(
  $$ select public.respond_to_request((select id from req02), 'd1000000-0000-4000-8000-000000000002', true) $$,
  'P0001', 'request_not_found', 'The requester cannot answer their own request'
);
select throws_ok(
  $$ select public.respond_to_request((select id from req02), 'f1000000-0000-4000-8000-000000000001', true) $$,
  'P0001', 'request_not_found', 'An outsider gets request_not_found'
);
select throws_ok(
  $$ select public.respond_to_request('f6000000-0000-4000-8000-00000000ffff',
       'd1000000-0000-4000-8000-000000000003', true) $$,
  'P0001', 'request_not_found', 'An unknown request gets request_not_found'
);
select is(
  (select status from public.care_requests where id = (select id from req02)),
  'pending',
  'Refused answers leave the request pending'
);
select is(
  public.respond_to_request((select id from req02), 'd1000000-0000-4000-8000-000000000003', true) ->> 'outcome',
  'accepted',
  'The receiver accepts the Assignment'
);
select is(
  (select owner_id::text || ' ' || status || ' ' || approval_state || ' ' || plan_version::text
   from public.care_steps where id = 'f5000000-0000-4000-8000-000000000002'),
  'd2000000-0000-4000-8000-000000000003 in_progress pending 1',
  'Acceptance sets the Owner, starts the Part, and resets approval on an approved High_Risk_Part'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000002' and event_type <> 'reminder.sent'),
  array['assignment.requested', 'assignment.accepted', 'approval.reset'],
  'Acceptance writes assignment.accepted and approval.reset'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000002' and recipient_member_id is null),
  2,
  'One household Feed_Item per primary event (request and acceptance)'
);
select is(
  (select status || ' ' || (resolved_at is not null)::text || ' ' ||
          (resolved_by = 'd2000000-0000-4000-8000-000000000003')::text
   from public.care_requests where id = (select id from req02)),
  'accepted true true',
  'The request is closed as accepted by the receiver'
);
select throws_ok(
  $$ select public.respond_to_request((select id from req02), 'd1000000-0000-4000-8000-000000000003', true) $$,
  'P0001', 'request_not_pending', 'An answered request cannot be answered again'
);

-- ---------------------------------------------------------------------------
-- Assignment declined (step 03), then a new request is allowed
-- ---------------------------------------------------------------------------
select is(
  public.request_assignment('f5000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004') ->> 'outcome',
  'requested',
  'Misa asks Yui to take a low-risk Part'
);
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000003'),
    'd1000000-0000-4000-8000-000000000004', false) ->> 'outcome',
  'declined',
  'The receiver declines'
);
select is(
  (select (owner_id is null)::text || ' ' || status from public.care_steps
   where id = 'f5000000-0000-4000-8000-000000000003'),
  'true pending_review',
  'Declining changes no holder and no status'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000003' and event_type <> 'reminder.sent'),
  array['assignment.requested', 'assignment.declined'],
  'Decline writes one assignment.declined event'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000003'
     and recipient_member_id = 'd2000000-0000-4000-8000-000000000002' and kind = 'assignment_declined'),
  1,
  'The requester gets an In_App_Reminder about the decline'
);
select is(
  public.request_assignment('f5000000-0000-4000-8000-000000000003',
    'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') ->> 'outcome',
  'requested',
  'After a decline a new Assignment can be requested (left pending for the sweep test)'
);

-- ---------------------------------------------------------------------------
-- request_handover refusals and success (step 01, Misa owns, due in 3 days)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000004', 'owner', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_holder', 'Only the holder can request a handover'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'driver', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_holder', 'Handing over a role you do not hold is not_holder'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'boss', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'invalid_input', 'An unknown role is invalid_input'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000001') $$,
  'P0001', 'receiver_not_eligible', 'A handover to a care recipient is refused'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000001', 'owner', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'recipient_read_only', 'A care recipient cannot request a handover'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'f1000000-0000-4000-8000-000000000001', 'owner', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'part_not_found', 'An outsider requesting a handover gets part_not_found'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'part_closed', 'A completed Part refuses a handover'
);
select is(
  (select count(*)::int from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-000000000001')
  + (select count(*)::int from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-000000000001'),
  0,
  'Refused handovers wrote nothing'
);
select is(
  public.request_handover('f5000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000004') ->> 'outcome',
  'requested',
  'Misa asks Yui to take over the Owner role'
);
select is(
  (select owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-000000000001'),
  'd2000000-0000-4000-8000-000000000002'::uuid,
  'The original Owner keeps the role while the handover is pending'
);
select is(
  (select r.expiry_rule || ' ' || (r.expires_at = s.task_due_at)::text
   from public.care_requests r join public.care_steps s on s.id = r.care_step_id
   where r.care_step_id = 'f5000000-0000-4000-8000-000000000001'),
  'task_due true',
  'A human_confirmed future Task_Due_Time is the handover expiry'
);
select is(
  (select (payload ->> 'expiry_rule') || ' ' ||
          (payload ->> 'expires_at' = private.iso_utc(s.task_due_at))::text || ' ' || (payload ->> 'role')
   from public.audit_events a join public.care_steps s on s.id = a.care_step_id
   where a.care_step_id = 'f5000000-0000-4000-8000-000000000001' and a.event_type = 'handover.requested'),
  'task_due true owner',
  'handover.requested records expiry_rule, expires_at, and role'
);
select throws_ok(
  $$ select public.request_handover('f5000000-0000-4000-8000-000000000001',
       'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'request_pending', 'A second pending handover for the same role is refused'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type <> 'reminder.sent')
  + (select count(*)::int from public.feed_items
     where care_step_id = 'f5000000-0000-4000-8000-000000000001' and recipient_member_id is null),
  2,
  'One primary audit event and one household Feed_Item for the handover request'
);
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000001'),
    'd1000000-0000-4000-8000-000000000004', true) ->> 'outcome',
  'accepted',
  'Yui accepts the handover'
);
select is(
  (select owner_id::text || ' ' || approval_state || ' ' || plan_version::text
   from public.care_steps where id = 'f5000000-0000-4000-8000-000000000001'),
  'd2000000-0000-4000-8000-000000000004 pending 1',
  'The Owner moves to Yui and approval resets on the approved High_Risk_Part'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000001' and event_type <> 'reminder.sent'),
  array['handover.requested', 'handover.accepted', 'approval.reset'],
  'Accepting writes handover.accepted and approval.reset'
);

-- ---------------------------------------------------------------------------
-- Driver handover moves only that role, 24h rule (step 05)
-- ---------------------------------------------------------------------------
select is(
  public.request_handover('f5000000-0000-4000-8000-000000000005',
    'd1000000-0000-4000-8000-000000000002', 'driver', 'd2000000-0000-4000-8000-000000000004') ->> 'outcome',
  'requested',
  'The driver asks Yui to take the driver role'
);
select is(
  (select expiry_rule || ' ' || (expires_at = now() + interval '24 hours')::text
   from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000005'),
  '24h true',
  'Without a human_confirmed Task_Due_Time the handover expires in 24 hours'
);
select is(
  (select driver_id from public.care_steps where id = 'f5000000-0000-4000-8000-000000000005'),
  'd2000000-0000-4000-8000-000000000002'::uuid,
  'The driver keeps the role while pending'
);
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000005'),
    'd1000000-0000-4000-8000-000000000004', true) ->> 'approval_reset',
  'true',
  'Accepting a driver handover on an approved High_Risk_Part resets approval'
);
select is(
  (select driver_id::text || ' ' || owner_id::text || ' ' || (companion_id is null)::text
   from public.care_steps where id = 'f5000000-0000-4000-8000-000000000005'),
  'd2000000-0000-4000-8000-000000000004 d2000000-0000-4000-8000-000000000003 true',
  'Only the driver role moved; owner and companion are unchanged'
);
select is(
  (select payload from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000005' and event_type = 'approval.reset'),
  '{"changed": "driver"}'::jsonb,
  'The reset names the changed role'
);

-- ---------------------------------------------------------------------------
-- Handover declined (step 06)
-- ---------------------------------------------------------------------------
select is(
  public.request_handover('f5000000-0000-4000-8000-000000000006',
    'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000003') ->> 'outcome',
  'requested',
  'Misa asks Kenta to take a low-risk Part'
);
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000006'),
    'd1000000-0000-4000-8000-000000000003', false) ->> 'outcome',
  'declined',
  'Kenta declines the handover'
);
select is(
  (select owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-000000000006'),
  'd2000000-0000-4000-8000-000000000002'::uuid,
  'The original Owner stays after a decline'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000006' and event_type <> 'reminder.sent'),
  array['handover.requested', 'handover.declined'],
  'One handover.declined event'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000006'
     and recipient_member_id = 'd2000000-0000-4000-8000-000000000002' and kind = 'handover_declined'),
  1,
  'The requester is reminded of the decline'
);

-- ---------------------------------------------------------------------------
-- Accept after expiry commits the expiry (step 07)
-- ---------------------------------------------------------------------------
select public.request_handover('f5000000-0000-4000-8000-000000000007',
  'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000003');
update public.care_requests set expires_at = now() - interval '1 hour'
where care_step_id = 'f5000000-0000-4000-8000-000000000007';
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000007'),
    'd1000000-0000-4000-8000-000000000003', true) ->> 'outcome',
  'expired',
  'Accepting an expired request returns outcome expired and does not raise'
);
select is(
  (select status || ' ' || (resolved_at is not null)::text
   from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000007'),
  'expired true',
  'The expiry is committed even though no sweep ran'
);
select is(
  (select owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-000000000007'),
  'd2000000-0000-4000-8000-000000000002'::uuid,
  'The original holder is kept'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000007' and event_type <> 'reminder.sent'),
  array['handover.requested', 'handover.not_accepted'],
  'One handover.not_accepted event'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000007' and kind = 'handover_expired'
     and recipient_member_id in ('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003')),
  2,
  'Both the requester and the receiver get an expiry reminder'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-000000000007' and recipient_member_id is null),
  2,
  'One household Feed_Item for the request and one for the expiry'
);
select throws_ok(
  $$ select public.respond_to_request(
       (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000007'),
       'd1000000-0000-4000-8000-000000000003', true) $$,
  'P0001', 'request_not_pending', 'An expired request cannot be answered again'
);

-- ---------------------------------------------------------------------------
-- Requester no longer holds the role (step 08)
-- ---------------------------------------------------------------------------
select public.request_handover('f5000000-0000-4000-8000-000000000008',
  'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000004');
update public.care_steps set owner_id = 'd2000000-0000-4000-8000-000000000003'
where id = 'f5000000-0000-4000-8000-000000000008';
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000008'),
    'd1000000-0000-4000-8000-000000000004', true) ->> 'reason',
  'holder_changed',
  'Accepting after the requester lost the role closes the request with reason holder_changed'
);
select is(
  (select status from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000008'),
  'declined',
  'The request is closed as declined'
);
select is(
  (select owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-000000000008'),
  'd2000000-0000-4000-8000-000000000003'::uuid,
  'The current holder is untouched'
);
select is(
  (select payload ->> 'reason' from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-000000000008' and event_type = 'handover.declined'),
  'holder_changed',
  'handover.declined carries the reason'
);

-- ---------------------------------------------------------------------------
-- request_backup (steps 09 and 10)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-000000000009',
       'd1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'not_allowed_backup_request', 'Neither the Owner nor a Primary_Caregiver: refused'
);
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-000000000009',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001') $$,
  'P0001', 'receiver_not_eligible', 'A care recipient cannot be asked to be backup'
);
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-000000000009',
       'd1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'recipient_read_only', 'A care recipient cannot request a backup'
);
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-000000000009',
       'f1000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'part_not_found', 'An outsider requesting a backup gets part_not_found'
);
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'part_closed', 'A completed Part refuses a backup request'
);
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-00000000000a',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') $$,
  'P0001', 'receiver_not_eligible', 'The Owner cannot also be the backup'
);
select is(
  (select count(*)::int from public.care_requests
   where care_step_id in ('f5000000-0000-4000-8000-000000000009', 'f5000000-0000-4000-8000-00000000000a'))
  + (select count(*)::int from public.audit_events
     where care_step_id in ('f5000000-0000-4000-8000-000000000009', 'f5000000-0000-4000-8000-00000000000a')),
  0,
  'Refused backup requests wrote nothing'
);
select is(
  public.request_backup('f5000000-0000-4000-8000-00000000000a',
    'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004') ->> 'outcome',
  'requested',
  'An active Primary_Caregiver who is not the Owner asks Yui to be backup'
);
select is(
  (select helper_role is null and expiry_rule = '24h' and expires_at = now() + interval '24 hours'
   from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-00000000000a'),
  true,
  'A backup request has no role and expires in 24 hours'
);
select is(
  (select backup_owner_id is null from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000a'),
  true,
  'The backup does not change while pending'
);
select throws_ok(
  $$ select public.request_backup('f5000000-0000-4000-8000-00000000000a',
       'd1000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000004') $$,
  'P0001', 'request_pending', 'The Owner asking again while one is pending is refused'
);
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-00000000000a'),
    'd1000000-0000-4000-8000-000000000004', true) ->> 'approval_reset',
  'false',
  'Accepting a backup request does not reset approval'
);
select is(
  (select backup_owner_id::text || ' ' || owner_id::text || ' ' || approval_state || ' ' || plan_version::text
   from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000a'),
  'd2000000-0000-4000-8000-000000000004 d2000000-0000-4000-8000-000000000003 approved 0',
  'The backup is set; owner, approval state, and plan version are unchanged'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000a' and event_type <> 'reminder.sent'),
  array['backup.requested', 'backup.accepted'],
  'backup.requested then backup.accepted, one primary event each'
);
select is(
  public.request_backup('f5000000-0000-4000-8000-000000000009',
    'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004') ->> 'outcome',
  'requested',
  'The Owner asks Yui to be backup on a low-risk Part'
);
select is(
  public.respond_to_request(
    (select id from public.care_requests where care_step_id = 'f5000000-0000-4000-8000-000000000009'),
    'd1000000-0000-4000-8000-000000000004', false) ->> 'outcome',
  'declined',
  'Yui declines the backup request'
);
select is(
  (select (backup_owner_id is null)::text || ' ' ||
          (select count(*)::text from public.feed_items f
           where f.care_step_id = s.id and f.kind = 'backup_declined'
             and f.recipient_member_id = 'd2000000-0000-4000-8000-000000000002')
   from public.care_steps s where s.id = 'f5000000-0000-4000-8000-000000000009'),
  'true 1',
  'Declining leaves the backup empty and reminds the requester'
);

-- ---------------------------------------------------------------------------
-- volunteer_backup (steps 11 and 12)
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ select public.volunteer_backup('f5000000-0000-4000-8000-00000000000b',
       'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'invalid_input', 'The Owner cannot volunteer as their own backup'
);
select throws_ok(
  $$ select public.volunteer_backup('f5000000-0000-4000-8000-00000000000b',
       'd1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'recipient_read_only', 'A care recipient cannot volunteer'
);
select throws_ok(
  $$ select public.volunteer_backup('f5000000-0000-4000-8000-00000000000b',
       'f1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'part_not_found', 'An outsider volunteering gets part_not_found'
);
select throws_ok(
  $$ select public.volunteer_backup('f5000000-0000-4000-8000-000000000004',
       'd1000000-0000-4000-8000-000000000004') $$,
  'P0001', 'part_closed', 'A completed Part refuses a volunteer'
);
select is(
  (select count(*)::int from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-00000000000b')
  + (select count(*)::int from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-00000000000b'),
  0,
  'Refused volunteers wrote nothing'
);
select is(
  public.volunteer_backup('f5000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-000000000004') ->> 'outcome',
  'volunteered',
  'A member volunteers as backup'
);
select is(
  (select backup_owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000b'),
  'd2000000-0000-4000-8000-000000000004'::uuid,
  'backup_owner_id is the volunteer'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000b' and event_type = 'backup.accepted'
     and payload = '{"volunteered": true}'::jsonb),
  1,
  'One backup.accepted event with volunteered true'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-00000000000b' and kind = 'backup_accepted'
     and recipient_member_id is null),
  1,
  'One household Feed_Item'
);
select throws_ok(
  $$ select public.volunteer_backup('f5000000-0000-4000-8000-00000000000b',
       'd1000000-0000-4000-8000-000000000003') $$,
  'P0001', 'already_claimed', 'A second volunteer is refused while a backup is set'
);
select is(
  public.volunteer_backup('f5000000-0000-4000-8000-00000000000c', 'd1000000-0000-4000-8000-000000000004') ->> 'approval_reset',
  'false',
  'Volunteering on an approved High_Risk_Part does not reset approval'
);
select is(
  (select approval_state || ' ' || plan_version::text from public.care_steps
   where id = 'f5000000-0000-4000-8000-00000000000c'),
  'approved 0',
  'Approval state and plan version are unchanged'
);

-- ---------------------------------------------------------------------------
-- expire_care_requests (steps 13, 14, 15 and the pending request on step 03)
-- ---------------------------------------------------------------------------
select public.request_assignment('f5000000-0000-4000-8000-00000000000d',
  'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003');
select public.request_handover('f5000000-0000-4000-8000-00000000000e',
  'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000004');
select public.request_handover('f5000000-0000-4000-8000-00000000000f',
  'd1000000-0000-4000-8000-000000000002', 'owner', 'd2000000-0000-4000-8000-000000000004');
update public.care_requests set expires_at = now() - interval '1 minute'
where care_step_id in ('f5000000-0000-4000-8000-00000000000d', 'f5000000-0000-4000-8000-00000000000e');

select is(
  public.expire_care_requests('f0000000-0000-4000-8000-000000000001'),
  0,
  'Another household sweep closes nothing here'
);
select is(
  (select count(*)::int from public.care_requests
   where household_id = 'd0000000-0000-4000-8000-000000000001' and status = 'expired'
     and care_step_id in ('f5000000-0000-4000-8000-00000000000d', 'f5000000-0000-4000-8000-00000000000e')),
  0,
  'Nothing in the demo household changed'
);
select is(
  public.expire_care_requests('d0000000-0000-4000-8000-000000000001'),
  2,
  'The sweep closes exactly the two pending requests past expiry'
);
select is(
  (select array_agg(status order by care_step_id) from public.care_requests
   where care_step_id in ('f5000000-0000-4000-8000-00000000000d', 'f5000000-0000-4000-8000-00000000000e',
                          'f5000000-0000-4000-8000-00000000000f')),
  array['expired', 'expired', 'pending'],
  'Requests that are not yet due stay pending'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000d' and event_type <> 'reminder.sent'),
  array['assignment.requested', 'assignment.expired'],
  'An expired Assignment writes assignment.expired'
);
select is(
  (select array_agg(event_type order by created_at) from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000e' and event_type <> 'reminder.sent'),
  array['handover.requested', 'handover.not_accepted'],
  'An expired Handover writes handover.not_accepted'
);
select is(
  (select actor_type || ' ' || (actor_id is null)::text from public.audit_events
   where care_step_id = 'f5000000-0000-4000-8000-00000000000e' and event_type = 'handover.not_accepted'),
  'system true',
  'The sweep records the system as the actor'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'f5000000-0000-4000-8000-00000000000e' and kind = 'handover_expired'
     and recipient_member_id in ('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004')),
  2,
  'Both parties get an in-app expiry reminder'
);
select is(
  (select (select count(*) from public.audit_events where care_step_id = 'f5000000-0000-4000-8000-00000000000f')::int
        + (select count(*) from public.feed_items where care_step_id = 'f5000000-0000-4000-8000-00000000000f')::int),
  4,
  'The request that is not due was not touched (request and reminder events, household and reminder Feed_Items)'
);
select is(
  (select (owner_id is null)::text || ' ' || status from public.care_steps
   where id = 'f5000000-0000-4000-8000-00000000000d'),
  'true pending_review',
  'Expiry leaves the Part without an Owner when there was none'
);
select is(
  (select owner_id from public.care_steps where id = 'f5000000-0000-4000-8000-00000000000e'),
  'd2000000-0000-4000-8000-000000000002'::uuid,
  'Expiry leaves the original holder'
);
select is(
  public.expire_care_requests('d0000000-0000-4000-8000-000000000001'),
  0,
  'Running the sweep again closes nothing'
);
select is(
  public.expire_care_requests(null, now() + interval '2 days'),
  2,
  'A later p_now closes the remaining pending requests of every household'
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('request_assignment', 'request_handover', 'request_backup',
                       'volunteer_backup', 'respond_to_request', 'expire_care_requests')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'anon and authenticated cannot execute any request function'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('request_assignment', 'request_handover', 'request_backup',
                       'volunteer_backup', 'respond_to_request', 'expire_care_requests')
     and has_function_privilege('service_role', p.oid, 'execute')),
  6,
  'service_role can execute all six'
);
set local role authenticated;
select throws_ok(
  $$ select public.request_assignment('f5000000-0000-4000-8000-00000000000d',
       'd1000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003') $$,
  '42501', null, 'A browser session calling request_assignment is denied'
);
select throws_ok(
  $$ select public.respond_to_request('f6000000-0000-4000-8000-00000000ffff',
       'd1000000-0000-4000-8000-000000000003', true) $$,
  '42501', null, 'A browser session calling respond_to_request is denied'
);
reset role;
set local role anon;
select throws_ok(
  $$ select public.expire_care_requests('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'An anonymous session calling expire_care_requests is denied'
);
reset role;

select * from finish();
rollback;
