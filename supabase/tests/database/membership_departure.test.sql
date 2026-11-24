-- pgTAP tests for the departure algorithm (private.release_departing_member) and its
-- link to the Escalation_Checker (family-app-demo-parity Requirements 13.1-13.8).
-- Fake household C: P1 and P2 are primary caregivers, M and M2 are family members.
-- All new rows are fake and rolled back. Fixed escalation clock: 2030-01-10T00:00:00Z.
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- Fixtures (as postgres) ------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'p1.departure.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'p2.departure.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'm.departure.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'm2.departure.test@example.com', now(), now());
insert into public.households (id, name)
values ('c0000000-0000-4000-8000-000000000001', 'Departure household C');
insert into public.household_members (id, household_id, user_id, display_name, role, is_active, created_at)
values
  ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001', 'P1', 'primary_caregiver', true, now() - interval '4 hours'),
  ('c2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002', 'P2', 'primary_caregiver', true, now() - interval '3 hours'),
  ('c2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003', 'M', 'family_member', true, now() - interval '2 hours'),
  ('c2000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004', 'M2', 'family_member', true, now() - interval '1 hour');
insert into public.notes (id, household_id, uploaded_by, image_path, status)
values ('c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        'c0000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001/1763700000000-note.png',
        'pending_review');
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values ('c4000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
        'c3000000-0000-4000-8000-000000000001', 'Departure chain', 'high');
-- s1: approved High_Risk_Part, owner M, driver M, backup owner P2, human-confirmed Respond_By in the past.
-- s2: completed Part owned by M (closed Parts are untouched).
-- s3: low-risk Part owned by P2 with a pending backup request from P2 to M.
-- s4: low-risk Part owned by M2 (rollback test).
-- s5: low-risk Part owned by M, no other holders: only M's owner role is cleared, approval not required.
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status, approval_state,
  owner_id, driver_id, backup_owner_id, respond_by_at, respond_by_timezone, respond_by_provenance, respond_by_set_by
)
values
  ('c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001', 'Clinic visit', 'appointment', 'high', true, 'in_progress', 'approved',
   'c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000003', 'c2000000-0000-4000-8000-000000000002',
   '2030-01-09T00:00:00Z', 'Asia/Tokyo', 'human_confirmed', 'c2000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001', 'Done visit', 'appointment', 'high', true, 'completed', 'approved',
   'c2000000-0000-4000-8000-000000000003', null, null, null, null, null, null),
  ('c5000000-0000-4000-8000-000000000003', 'c4000000-0000-4000-8000-000000000001', 'Shopping', 'household', 'low', false, 'in_progress', 'not_required',
   'c2000000-0000-4000-8000-000000000002', null, null, null, null, null, null),
  ('c5000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000001', 'Laundry', 'household', 'low', false, 'in_progress', 'not_required',
   'c2000000-0000-4000-8000-000000000004', null, null, null, null, null, null),
  ('c5000000-0000-4000-8000-000000000005', 'c4000000-0000-4000-8000-000000000001', 'Garden', 'household', 'low', false, 'in_progress', 'not_required',
   'c2000000-0000-4000-8000-000000000003', null, null, null, null, null, null);
insert into public.care_requests (
  id, household_id, care_chain_id, care_step_id, kind, helper_role, from_member_id, to_member_id, expires_at, expiry_rule
)
values
  ('c6000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'c5000000-0000-4000-8000-000000000001', 'handover', 'owner', 'c2000000-0000-4000-8000-000000000003',
   'c2000000-0000-4000-8000-000000000002', '2031-01-01T00:00:00Z', '24h'),
  ('c6000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'c5000000-0000-4000-8000-000000000003', 'backup', null, 'c2000000-0000-4000-8000-000000000002',
   'c2000000-0000-4000-8000-000000000003', '2031-01-01T00:00:00Z', '24h');

-- A forced failure inside the departure (installed as postgres, active for the rollback test only).
create function public.test_force_departure_failure() returns trigger language plpgsql as $$
begin
  raise exception 'forced_failure';
end;
$$;

set local role service_role;

-- Before the departure: the Part has an Owner, so Respond_By does not escalate it ----------
select is((public.escalate_due_parts('c0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z') ->> 'escalated')::int, 0,
  'A claimed High_Risk_Part is not selectable by the Escalation_Checker');

-- Rollback: a failure inside release_departing_member undoes the whole departure -----------
reset role;
create trigger test_force_departure_failure
  before update of owner_id on public.care_steps
  for each row when (old.owner_id is not null and new.owner_id is null)
  execute function public.test_force_departure_failure();
set local role service_role;
select throws_ok(
  $$ select public.deactivate_member('c0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000004', 'c1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'forced_failure', 'A failure inside the departure raises');
select is((select is_active from public.household_members where id = 'c2000000-0000-4000-8000-000000000004'), true,
  'After the failed departure the member row is unchanged');
select is((select owner_id from public.care_steps where id = 'c5000000-0000-4000-8000-000000000004'),
  'c2000000-0000-4000-8000-000000000004'::uuid, 'After the failed departure the Part still has its Owner');
select is((select count(*)::int from public.audit_events
           where household_id = 'c0000000-0000-4000-8000-000000000001' and event_type in ('member.deactivated', 'part.released')), 0,
  'After the failed departure no departure audit event exists');
select is((select status from public.care_requests where id = 'c6000000-0000-4000-8000-000000000001'), 'pending',
  'After the failed departure the pending request is still pending');
reset role;
drop trigger test_force_departure_failure on public.care_steps;
set local role service_role;

-- Departure of M by P1 ------------------------------------------------------------------
select is((public.deactivate_member('c0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000003',
  'c1000000-0000-4000-8000-000000000001')) ->> 'outcome', 'deactivated', 'P1 removes M');
select is((select is_active from public.household_members where id = 'c2000000-0000-4000-8000-000000000003'), false,
  'M is deactivated');
select is((select row_to_json(t)::jsonb from (
  select owner_id, driver_id, backup_owner_id from public.care_steps where id = 'c5000000-0000-4000-8000-000000000001') t),
  jsonb_build_object('owner_id', null, 'driver_id', null, 'backup_owner_id', 'c2000000-0000-4000-8000-000000000002'),
  'M is cleared as owner and driver; other holders stay');
select is((select approval_state from public.care_steps where id = 'c5000000-0000-4000-8000-000000000001'), 'pending',
  'Approval of the approved High_Risk_Part is reset');
select is((select count(*)::int from public.audit_events where event_type = 'approval.reset'
           and care_step_id = 'c5000000-0000-4000-8000-000000000001' and actor_type = 'system'), 1,
  'A system approval.reset event is written');
select is((select count(*)::int from public.audit_events where event_type = 'part.released'
           and care_step_id = 'c5000000-0000-4000-8000-000000000001' and actor_type = 'system'
           and payload ->> 'reason' = 'member_departed'
           and payload ->> 'member_id' = 'c2000000-0000-4000-8000-000000000003'), 2,
  'One system part.released event per removed role (owner and driver)');
select is((select status from public.care_requests where id = 'c6000000-0000-4000-8000-000000000001'), 'declined',
  'The pending handover from M is declined');
select is((select payload from public.audit_events where event_type = 'handover.declined'
           and care_step_id = 'c5000000-0000-4000-8000-000000000001'),
  jsonb_build_object('request_id', 'c6000000-0000-4000-8000-000000000001', 'reason', 'member_departed'),
  'The decline audit payload holds only a request ID and a reason code');
select is((select status from public.care_requests where id = 'c6000000-0000-4000-8000-000000000002'), 'declined',
  'The pending backup request to M is declined');
select is((select count(*)::int from public.feed_items where recipient_member_id = 'c2000000-0000-4000-8000-000000000002'
           and kind = 'backup_declined'), 1,
  'The other party of a declined request gets a reminder');
select is((select count(*)::int from public.feed_items where recipient_member_id = 'c2000000-0000-4000-8000-000000000002'
           and kind = 'handover_declined'), 1,
  'P2 is told the handover to them was declined');
select is((select count(*)::int from public.feed_items where kind = 'part_released'
           and care_step_id = 'c5000000-0000-4000-8000-000000000001' and recipient_member_id is null
           and params = '{"role": "owner", "needs_someone": true, "reason": "member_departed"}'::jsonb), 1,
  'One needs-someone Feed_Item for the Part left without an Owner');
select is((select count(*)::int from public.feed_items where kind = 'part_needs_someone'
           and care_step_id = 'c5000000-0000-4000-8000-000000000001'
           and recipient_member_id in ('c2000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000002')), 2,
  'Each remaining primary caregiver gets a needs-someone reminder');
select is((select count(*)::int from public.feed_items where kind = 'part_needs_someone'
           and care_step_id = 'c5000000-0000-4000-8000-000000000005'), 2,
  'The low-risk Part left without an Owner also notifies the primaries');
select is((select owner_id from public.care_steps where id = 'c5000000-0000-4000-8000-000000000005'), null,
  'M is cleared from the low-risk Part');
select is((select approval_state from public.care_steps where id = 'c5000000-0000-4000-8000-000000000005'), 'not_required',
  'A Part that needs no approval keeps its approval state');
select is((select owner_id from public.care_steps where id = 'c5000000-0000-4000-8000-000000000002'),
  'c2000000-0000-4000-8000-000000000003'::uuid, 'A completed Part is left untouched');
select is((select count(*)::int from public.audit_events where care_step_id = 'c5000000-0000-4000-8000-000000000002'), 0,
  'A completed Part gets no audit event');
select is((select owner_id from public.care_steps where id = 'c5000000-0000-4000-8000-000000000003'),
  'c2000000-0000-4000-8000-000000000002'::uuid, 'Another member''s Part is left untouched');
select is((select count(*)::int from public.audit_events where event_type = 'member.deactivated'
           and actor_type = 'human' and actor_id = 'c1000000-0000-4000-8000-000000000001'
           and payload = jsonb_build_object('member_id', 'c2000000-0000-4000-8000-000000000003', 'role', 'family_member')), 1,
  'The human member.deactivated event holds IDs and a Role code only');

-- Escalation: the unclaimed High_Risk_Part is now selectable --------------------------------
select is((public.escalate_due_parts('c0000000-0000-4000-8000-000000000001', '2030-01-10T00:00:00Z') ->> 'escalated')::int, 1,
  'A departure that leaves a High_Risk_Part unclaimed makes it selectable by the Escalation_Checker');
select is((select status from public.care_steps where id = 'c5000000-0000-4000-8000-000000000001'), 'escalated',
  'The unclaimed High_Risk_Part is escalated');
select is((select count(*)::int from public.audit_events where event_type = 'part.escalated'
           and care_step_id = 'c5000000-0000-4000-8000-000000000001'), 1,
  'The escalation is audited');

-- No 24-hour block: a High_Risk_Part due within 24 hours is still released ---------------------
reset role;
update public.care_steps
set owner_id = 'c2000000-0000-4000-8000-000000000004', task_due_at = now() + interval '2 hours',
    task_due_provenance = 'human_confirmed', task_due_set_by = 'c2000000-0000-4000-8000-000000000001',
    task_due_timezone = 'Asia/Tokyo', status = 'in_progress'
where id = 'c5000000-0000-4000-8000-000000000004';
update public.care_steps set risk_level = 'high', care_category = 'appointment', approval_required = true,
  approval_state = 'approved' where id = 'c5000000-0000-4000-8000-000000000004';
set local role service_role;
select is((public.leave_household('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004')) ->> 'outcome', 'left',
  'M2 leaves');
select is((select owner_id from public.care_steps where id = 'c5000000-0000-4000-8000-000000000004'), null,
  'A High_Risk_Part due within 24 hours is released on departure (no release block)');
select is((select approval_state from public.care_steps where id = 'c5000000-0000-4000-8000-000000000004'), 'pending',
  'Its approval is reset');

select * from finish();
rollback;
