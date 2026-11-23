-- pgTAP tests for migration 20261210000200_shared_care_helpers.
-- Uses its own household with fake members, so no existing row is read or
-- changed. Everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(67);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   Household H: P1 and P2 active primary caregivers, P3 inactive primary,
--   F family member, R care recipient.
--   Household X: one primary caregiver (outsider).
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, now(), now()
from (
  values
    ('c1000000-0000-4000-8000-000000000001'::uuid, 'p1.helpers.test@example.com'),
    ('c1000000-0000-4000-8000-000000000002'::uuid, 'p2.helpers.test@example.com'),
    ('c1000000-0000-4000-8000-000000000003'::uuid, 'p3.helpers.test@example.com'),
    ('c1000000-0000-4000-8000-000000000004'::uuid, 'f.helpers.test@example.com'),
    ('c1000000-0000-4000-8000-000000000005'::uuid, 'r.helpers.test@example.com'),
    ('c1000000-0000-4000-8000-000000000006'::uuid, 'x.helpers.test@example.com')
) as u (id, email);

insert into public.households (id, name)
values ('c0000000-0000-4000-8000-000000000001', 'Helpers household'),
       ('c0000000-0000-4000-8000-000000000002', 'Helpers outsider household');

insert into public.household_members (id, household_id, user_id, display_name, role, is_active)
values
  ('c2000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000001', 'P One', 'primary_caregiver', true),
  ('c2000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000002', 'P Two', 'primary_caregiver', true),
  ('c2000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000003', 'P Three', 'primary_caregiver', false),
  ('c2000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000004', 'Family', 'family_member', true),
  ('c2000000-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-000000000001',
   'c1000000-0000-4000-8000-000000000005', 'Recipient', 'care_recipient', true),
  ('c2000000-0000-4000-8000-000000000006', 'c0000000-0000-4000-8000-000000000002',
   'c1000000-0000-4000-8000-000000000006', 'Outsider', 'primary_caregiver', true);

insert into public.notes (id, household_id, uploaded_by, image_path, status)
values (
  'c3000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001/c3000000-0000-4000-8000-000000000001/1763700000000-note.png',
  'pending_review'
);
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values ('c4000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001',
        'c3000000-0000-4000-8000-000000000001', 'Fake helpers chain', 'high');

-- Steps: c5..01 approved high, 02 rejected high, 03 pending high, 04 approved low-risk,
-- 05 legacy (null state, status approved) high, 06 legacy no approval required,
-- 07 approved high for key facts, 08 medication low risk, 09 household high risk,
-- 0a legacy pending_review required, 0b legacy in_progress required, 0c legacy completed required,
-- 0d human_confirmed due in the future, 0e model_suggested due in the future,
-- 0f human_confirmed due in the past, 10 no due time (owner P1), 11 stored rejected despite status approved.
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status,
  approval_state, rejected_at_plan_version, owner_id
)
values
  ('c5000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
   'Approved high', 'appointment', 'high', true, 'approved', 'approved', null, 'c2000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002', 'c4000000-0000-4000-8000-000000000001',
   'Rejected high', 'appointment', 'high', true, 'pending_approval', 'rejected', 0, null),
  ('c5000000-0000-4000-8000-000000000003', 'c4000000-0000-4000-8000-000000000001',
   'Pending high', 'appointment', 'high', true, 'pending_approval', 'pending', null, null),
  ('c5000000-0000-4000-8000-000000000004', 'c4000000-0000-4000-8000-000000000001',
   'Approved low risk', 'household', 'low', true, 'approved', 'approved', null, null),
  ('c5000000-0000-4000-8000-000000000005', 'c4000000-0000-4000-8000-000000000001',
   'Legacy approved high', 'appointment', 'high', true, 'approved', null, null, null),
  ('c5000000-0000-4000-8000-000000000006', 'c4000000-0000-4000-8000-000000000001',
   'Legacy no approval', 'household', 'low', false, 'pending_review', null, null, null),
  ('c5000000-0000-4000-8000-000000000007', 'c4000000-0000-4000-8000-000000000001',
   'Approved high for facts', 'appointment', 'high', true, 'approved', 'approved', null, null),
  ('c5000000-0000-4000-8000-000000000008', 'c4000000-0000-4000-8000-000000000001',
   'Medication low risk', 'medication', 'low', true, 'pending_review', null, null, null),
  ('c5000000-0000-4000-8000-000000000009', 'c4000000-0000-4000-8000-000000000001',
   'Household high risk', 'household', 'high', true, 'pending_review', null, null, null),
  ('c5000000-0000-4000-8000-00000000000a', 'c4000000-0000-4000-8000-000000000001',
   'Legacy pending review', 'household', 'low', true, 'pending_review', null, null, null),
  ('c5000000-0000-4000-8000-00000000000b', 'c4000000-0000-4000-8000-000000000001',
   'Legacy in progress', 'household', 'low', true, 'in_progress', null, null, null),
  ('c5000000-0000-4000-8000-00000000000c', 'c4000000-0000-4000-8000-000000000001',
   'Legacy completed', 'household', 'low', true, 'completed', null, null, null),
  ('c5000000-0000-4000-8000-00000000000d', 'c4000000-0000-4000-8000-000000000001',
   'Due confirmed future', 'household', 'low', false, 'in_progress', null, null, null),
  ('c5000000-0000-4000-8000-00000000000e', 'c4000000-0000-4000-8000-000000000001',
   'Due suggested future', 'household', 'low', false, 'in_progress', null, null, null),
  ('c5000000-0000-4000-8000-00000000000f', 'c4000000-0000-4000-8000-000000000001',
   'Due confirmed past', 'household', 'low', false, 'in_progress', null, null, null),
  ('c5000000-0000-4000-8000-000000000010', 'c4000000-0000-4000-8000-000000000001',
   'No due time', 'household', 'low', false, 'in_progress', null, null, 'c2000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000001',
   'Stored beats legacy', 'household', 'low', true, 'approved', 'rejected', 0, null);

update public.care_steps
set task_due_at = '2030-01-02T10:00:00Z', task_due_timezone = 'Asia/Tokyo',
    task_due_provenance = 'human_confirmed', task_due_set_by = 'c2000000-0000-4000-8000-000000000001'
where id = 'c5000000-0000-4000-8000-00000000000d';
update public.care_steps
set task_due_at = '2030-01-02T10:00:00Z', task_due_timezone = 'Asia/Tokyo',
    task_due_provenance = 'model_suggested'
where id = 'c5000000-0000-4000-8000-00000000000e';
update public.care_steps
set task_due_at = '2030-01-02T10:00:00Z', task_due_timezone = 'Asia/Tokyo',
    task_due_provenance = 'human_confirmed', task_due_set_by = 'c2000000-0000-4000-8000-000000000001'
where id = 'c5000000-0000-4000-8000-00000000000f';

-- ---------------------------------------------------------------------------
-- effective_approval_state (Requirement 18.6)
-- ---------------------------------------------------------------------------
select is(
  (select private.effective_approval_state(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-000000000011'),
  'rejected',
  'A stored state wins over the legacy status'
);
select is(
  (select private.effective_approval_state(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-000000000006'),
  'not_required',
  'Legacy row without approval required derives not_required'
);
select is(
  (select private.effective_approval_state(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-00000000000a'),
  'pending',
  'Legacy pending_review row with approval required derives pending'
);
select is(
  (select private.effective_approval_state(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-00000000000b'),
  'pending',
  'Legacy in_progress row with approval required derives pending'
);
select is(
  (select private.effective_approval_state(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-000000000005'),
  'approved',
  'Legacy approved row derives approved'
);
select is(
  (select private.effective_approval_state(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-00000000000c'),
  'approved',
  'Legacy completed row derives approved'
);

-- ---------------------------------------------------------------------------
-- is_high_risk, is_part_closed
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select s.id, private.is_high_risk(s)
     from public.care_steps s
     where s.id in (
       'c5000000-0000-4000-8000-000000000001', -- appointment, high
       'c5000000-0000-4000-8000-000000000004', -- household, low
       'c5000000-0000-4000-8000-000000000006', -- household, low
       'c5000000-0000-4000-8000-000000000008', -- medication, low
       'c5000000-0000-4000-8000-000000000009'  -- household, high
     )
     order by s.id $$,
  $$ values
       ('c5000000-0000-4000-8000-000000000001'::uuid, true),
       ('c5000000-0000-4000-8000-000000000004'::uuid, false),
       ('c5000000-0000-4000-8000-000000000006'::uuid, false),
       ('c5000000-0000-4000-8000-000000000008'::uuid, true),
       ('c5000000-0000-4000-8000-000000000009'::uuid, true) $$,
  'High risk means risk high or an appointment, medication, payment, transport, or document category'
);
select is(
  (select private.is_part_closed(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-00000000000c'),
  true,
  'A completed Part is closed'
);
select is(
  (select private.is_part_closed(s) from public.care_steps s
   where s.id = 'c5000000-0000-4000-8000-00000000000b'),
  false,
  'An in_progress Part is not closed'
);
-- ---------------------------------------------------------------------------
-- actor_member and active_primary_count (evaluated at call time)
-- ---------------------------------------------------------------------------
select is(
  (private.actor_member('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001')).id,
  'c2000000-0000-4000-8000-000000000001'::uuid,
  'actor_member returns the active membership'
);
select is(
  (private.actor_member('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000003')).id,
  null,
  'actor_member returns nothing for an inactive member'
);
select is(
  (private.actor_member('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000006')).id,
  null,
  'actor_member returns nothing for a member of another household'
);
select is(
  (private.actor_member('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000ff')).id,
  null,
  'actor_member returns nothing for an unknown user'
);
select is(
  private.active_primary_count('c0000000-0000-4000-8000-000000000001'),
  2,
  'active_primary_count counts only active primary caregivers'
);
update public.household_members set role = 'family_member'
where id = 'c2000000-0000-4000-8000-000000000002';
select is(
  private.active_primary_count('c0000000-0000-4000-8000-000000000001'),
  1,
  'active_primary_count sees a demotion immediately'
);
select is(
  (private.actor_member('c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002')).role,
  'family_member',
  'actor_member sees the new role immediately'
);
update public.household_members set role = 'primary_caregiver'
where id = 'c2000000-0000-4000-8000-000000000002';
select is(
  private.step_household_id('c5000000-0000-4000-8000-000000000001'),
  'c0000000-0000-4000-8000-000000000001'::uuid,
  'step_household_id resolves the household through the chain'
);

-- ---------------------------------------------------------------------------
-- write_audit, add_feed_item, add_reminder
-- ---------------------------------------------------------------------------
create temp table t_audit_a as
select private.write_audit(
  'c0000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000006', null,
  'human', 'c1000000-0000-4000-8000-000000000001', 'part.test_one', '{"role":"owner"}'::jsonb
) as id;
create temp table t_audit_b as
select private.write_audit(
  'c0000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000006', null,
  'system', null, 'part.test_two'
) as id;

select is(
  (select e.note_id from public.audit_events e where e.id = (select id from t_audit_a)),
  'c3000000-0000-4000-8000-000000000001'::uuid,
  'write_audit takes note_id from the chain when none is given'
);
select ok(
  (select a.created_at < b.created_at
   from public.audit_events a, public.audit_events b
   where a.id = (select id from t_audit_a) and b.id = (select id from t_audit_b)),
  'Events written in one transaction keep their order (clock_timestamp)'
);
select is(
  (select e.payload from public.audit_events e where e.id = (select id from t_audit_b)),
  '{}'::jsonb,
  'write_audit defaults the payload to an empty object'
);
select throws_ok(
  $$ select private.write_audit('c0000000-0000-4000-8000-000000000001', null, null, null,
       'human', null, 'part.test_bad') $$,
  '23514', null,
  'write_audit keeps the human-actor constraint'
);

create temp table t_feed as
select private.add_feed_item(
  'c0000000-0000-4000-8000-000000000001', null, 'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000006', 'part_claimed', 'c2000000-0000-4000-8000-000000000001',
  '{"role":"owner"}'::jsonb, (select id from t_audit_a)
) as id;
select results_eq(
  $$ select f.note_id, f.recipient_member_id, f.actor_member_id, f.kind, f.params, f.audit_event_id
     from public.feed_items f where f.id = (select id from t_feed) $$,
  $$ select 'c3000000-0000-4000-8000-000000000001'::uuid, null::uuid,
            'c2000000-0000-4000-8000-000000000001'::uuid, 'part_claimed',
            '{"role":"owner"}'::jsonb, (select id from t_audit_a) $$,
  'add_feed_item writes one household Feed_Item linked to its audit event'
);

create temp table t_reminder as
select private.add_reminder(
  'c0000000-0000-4000-8000-000000000001', null, 'c4000000-0000-4000-8000-000000000001',
  'c5000000-0000-4000-8000-000000000006', 'c2000000-0000-4000-8000-000000000004', 'approval_reset'
) as id;
select results_eq(
  $$ select f.recipient_member_id, f.actor_member_id, f.kind, f.params
     from public.feed_items f where f.id = (select id from t_reminder) $$,
  $$ select 'c2000000-0000-4000-8000-000000000004'::uuid, null::uuid, 'approval_reset', '{}'::jsonb $$,
  'add_reminder writes a Feed_Item addressed to one Member'
);
select results_eq(
  $$ select e.event_type, e.actor_type, e.payload, e.note_id
     from public.feed_items f join public.audit_events e on e.id = f.audit_event_id
     where f.id = (select id from t_reminder) $$,
  $$ select 'reminder.sent', 'system',
            '{"channel":"in_app","recipient_member_id":"c2000000-0000-4000-8000-000000000004","kind":"approval_reset"}'::jsonb,
            'c3000000-0000-4000-8000-000000000001'::uuid $$,
  'add_reminder writes one reminder.sent event with channel in_app'
);

-- ---------------------------------------------------------------------------
-- apply_people_change
-- ---------------------------------------------------------------------------
select is(
  private.apply_people_change('c5000000-0000-4000-8000-000000000001', 'owner',
    'c1000000-0000-4000-8000-000000000001'),
  true,
  'Changing a holder on an approved High_Risk_Part resets approval'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps
     where id = 'c5000000-0000-4000-8000-000000000001' $$,
  $$ values ('pending'::text, 1) $$,
  'Reset stores pending and bumps plan_version'
);
select results_eq(
  $$ select e.event_type, e.actor_type, e.actor_id, e.payload
     from public.audit_events e
     where e.care_step_id = 'c5000000-0000-4000-8000-000000000001' and e.event_type = 'approval.reset' $$,
  $$ values ('approval.reset'::text, 'human'::text, 'c1000000-0000-4000-8000-000000000001'::uuid,
             '{"changed":"owner"}'::jsonb) $$,
  'Reset writes one approval.reset event naming only the changed role'
);
select results_eq(
  $$ select f.recipient_member_id
     from public.feed_items f join public.audit_events e on e.id = f.audit_event_id
     where f.care_step_id = 'c5000000-0000-4000-8000-000000000001'
       and f.kind = 'approval_reset' and e.event_type = 'reminder.sent'
     order by f.recipient_member_id $$,
  $$ values ('c2000000-0000-4000-8000-000000000001'::uuid), ('c2000000-0000-4000-8000-000000000002'::uuid) $$,
  'Reminders go to each active Primary_Caregiver only'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'c5000000-0000-4000-8000-000000000001' and event_type = 'reminder.sent'),
  2,
  'One reminder.sent event per reminder'
);
select is(
  (select count(*)::int from public.feed_items
   where care_step_id = 'c5000000-0000-4000-8000-000000000001' and recipient_member_id is null),
  0,
  'approval.reset itself has no household Feed_Item'
);
select is(
  private.apply_people_change('c5000000-0000-4000-8000-000000000001', 'driver',
    'c1000000-0000-4000-8000-000000000001'),
  false,
  'A second change while pending does not reset again'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps
     where id = 'c5000000-0000-4000-8000-000000000001' $$,
  $$ values ('pending'::text, 1) $$,
  'Pending stays pending and plan_version does not bump'
);

select is(
  private.apply_people_change('c5000000-0000-4000-8000-000000000002', 'companion',
    'c1000000-0000-4000-8000-000000000001'),
  false,
  'A people change on a rejected High_Risk_Part is not a reset'
);
select results_eq(
  $$ select approval_state, plan_version, rejected_at_plan_version from public.care_steps
     where id = 'c5000000-0000-4000-8000-000000000002' $$,
  $$ values ('rejected'::text, 1, 0) $$,
  'Rejected stays rejected, and plan_version bumps past rejected_at_plan_version'
);
select is(
  (select count(*)::int from public.audit_events
   where care_step_id = 'c5000000-0000-4000-8000-000000000002'),
  0,
  'A rejected Part gets no approval.reset or reminders'
);

select is(
  private.apply_people_change('c5000000-0000-4000-8000-000000000004', 'owner',
    'c1000000-0000-4000-8000-000000000001'),
  false,
  'A people change on an approved non-High_Risk_Part does not reset'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps
     where id = 'c5000000-0000-4000-8000-000000000004' $$,
  $$ values ('approved'::text, 0) $$,
  'Non-high-risk approved state is kept and plan_version does not bump'
);

select is(
  private.apply_people_change('c5000000-0000-4000-8000-000000000005', 'owner', null),
  true,
  'A legacy approved High_Risk_Part resets on a people change'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps
     where id = 'c5000000-0000-4000-8000-000000000005' $$,
  $$ values ('pending'::text, 1) $$,
  'The derived state is materialized as pending'
);
select is(
  (select e.actor_type from public.audit_events e
   where e.care_step_id = 'c5000000-0000-4000-8000-000000000005' and e.event_type = 'approval.reset'),
  'system',
  'Without an actor user the reset event is a system event'
);

select is(
  private.apply_people_change('c5000000-0000-4000-8000-000000000006', 'owner', null),
  false,
  'A change on a Part that needs no approval is not a reset'
);
select is(
  (select approval_state from public.care_steps where id = 'c5000000-0000-4000-8000-000000000006'),
  'not_required',
  'The derived not_required state is materialized'
);
select is(
  private.apply_people_change('c5000000-0000-4000-8000-00000000000a', 'owner', null),
  false,
  'A legacy pending Part is not reset by a people change'
);
select is(
  (select approval_state from public.care_steps where id = 'c5000000-0000-4000-8000-00000000000a'),
  'pending',
  'A legacy pending Part materializes pending'
);

select throws_ok(
  $$ select private.apply_people_change('c5000000-0000-4000-8000-000000000001', 'backup', null) $$,
  'P0001', 'invalid_input',
  'apply_people_change refuses a role that is not owner, driver, or companion'
);
select throws_ok(
  $$ select private.apply_people_change('c5000000-0000-4000-8000-0000000000aa', 'owner', null) $$,
  'P0001', 'part_not_found',
  'apply_people_change refuses an unknown Part'
);

-- ---------------------------------------------------------------------------
-- apply_key_fact_change
-- ---------------------------------------------------------------------------
select is(
  private.apply_key_fact_change('c5000000-0000-4000-8000-000000000007', 'location',
    'c1000000-0000-4000-8000-000000000002'),
  true,
  'Changing a Key_Fact on an approved High_Risk_Part resets approval'
);
select results_eq(
  $$ select e.payload from public.audit_events e
     where e.care_step_id = 'c5000000-0000-4000-8000-000000000007' and e.event_type = 'approval.reset' $$,
  $$ values ('{"changed":"location"}'::jsonb) $$,
  'The reset event names the changed Key_Fact'
);
select results_eq(
  $$ select approval_state, plan_version from public.care_steps
     where id = 'c5000000-0000-4000-8000-000000000007' $$,
  $$ values ('pending'::text, 1) $$,
  'Key_Fact reset stores pending and bumps plan_version'
);
select throws_ok(
  $$ select private.apply_key_fact_change('c5000000-0000-4000-8000-000000000007', 'owner', null) $$,
  'P0001', 'invalid_input',
  'apply_key_fact_change refuses an unknown fact'
);

-- ---------------------------------------------------------------------------
-- request_expiry (D-1, D-7)
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('assignment', s, '2029-12-31T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-00000000000d' $$,
  $$ values ('2030-01-01T10:00:00Z'::timestamptz, '24h'::text) $$,
  'An Assignment expires 24 hours after the request, whatever the Task_Due_Time'
);
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('backup', s, '2029-12-31T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-00000000000d' $$,
  $$ values ('2030-01-01T10:00:00Z'::timestamptz, '24h'::text) $$,
  'A Backup_Request expires 24 hours after the request'
);
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('handover', s, '2029-12-31T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-00000000000d' $$,
  $$ values ('2030-01-02T10:00:00Z'::timestamptz, 'task_due'::text) $$,
  'A Handover expires at a confirmed future Task_Due_Time'
);
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('handover', s, '2029-12-31T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-00000000000e' $$,
  $$ values ('2030-01-01T10:00:00Z'::timestamptz, '24h'::text) $$,
  'A model-suggested Task_Due_Time is ignored (24 hours)'
);
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('handover', s, '2030-01-03T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-00000000000f' $$,
  $$ values ('2030-01-04T10:00:00Z'::timestamptz, '24h'::text) $$,
  'A Handover past its Task_Due_Time expires 24 hours after the request (D-7)'
);
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('handover', s, '2030-01-02T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-00000000000f' $$,
  $$ values ('2030-01-03T10:00:00Z'::timestamptz, '24h'::text) $$,
  'A Task_Due_Time equal to the request time is not later, so 24 hours applies'
);
select results_eq(
  $$ select r.expires_at, r.expiry_rule
     from public.care_steps s,
          lateral private.request_expiry('handover', s, '2029-12-31T10:00:00Z') r
     where s.id = 'c5000000-0000-4000-8000-000000000010' $$,
  $$ values ('2030-01-01T10:00:00Z'::timestamptz, '24h'::text) $$,
  'A Handover with no Task_Due_Time expires 24 hours after the request'
);
select throws_ok(
  $$ select * from public.care_steps s,
       lateral private.request_expiry('swap', s, now())
     where s.id = 'c5000000-0000-4000-8000-000000000010' $$,
  'P0001', 'invalid_input',
  'request_expiry refuses an unknown kind'
);

-- ---------------------------------------------------------------------------
-- may_reopen_or_request_backup (D-2)
-- ---------------------------------------------------------------------------
select is(
  (select private.may_reopen_or_request_backup(
     (select m from public.household_members m where m.id = 'c2000000-0000-4000-8000-000000000001'), s)
   from public.care_steps s where s.id = 'c5000000-0000-4000-8000-000000000010'),
  true,
  'The Owner may reopen or request a backup'
);
select is(
  (select private.may_reopen_or_request_backup(
     (select m from public.household_members m where m.id = 'c2000000-0000-4000-8000-000000000002'), s)
   from public.care_steps s where s.id = 'c5000000-0000-4000-8000-000000000010'),
  true,
  'An active Primary_Caregiver who is not the Owner may reopen or request a backup'
);
select is(
  (select private.may_reopen_or_request_backup(
     (select m from public.household_members m where m.id = 'c2000000-0000-4000-8000-000000000004'), s)
   from public.care_steps s where s.id = 'c5000000-0000-4000-8000-000000000010'),
  false,
  'A family member who is not the Owner may not'
);
select is(
  (select private.may_reopen_or_request_backup(
     (select m from public.household_members m where m.id = 'c2000000-0000-4000-8000-000000000003'), s)
   from public.care_steps s where s.id = 'c5000000-0000-4000-8000-000000000010'),
  false,
  'An inactive Primary_Caregiver may not'
);
select is(
  (select private.may_reopen_or_request_backup(
     (select m from public.household_members m where m.id = 'c2000000-0000-4000-8000-000000000006'), s)
   from public.care_steps s where s.id = 'c5000000-0000-4000-8000-000000000010'),
  false,
  'A Primary_Caregiver of another household may not'
);
select is(
  (select private.may_reopen_or_request_backup(private.actor_member(
     'c0000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-0000000000ff'), s)
   from public.care_steps s where s.id = 'c5000000-0000-4000-8000-000000000010'),
  false,
  'No actor (null row) may not'
);

-- ---------------------------------------------------------------------------
-- Privileges: service role only, empty search_path
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('actor_member', 'active_primary_count', 'step_household_id', 'is_part_closed',
       'effective_approval_state', 'is_high_risk', 'write_audit', 'add_feed_item', 'add_reminder',
       'apply_plan_change', 'apply_people_change', 'apply_key_fact_change', 'request_expiry',
       'may_reopen_or_request_backup')
     and (has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))),
  0,
  'No helper is executable by anon or authenticated'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('actor_member', 'active_primary_count', 'step_household_id', 'is_part_closed',
       'effective_approval_state', 'is_high_risk', 'write_audit', 'add_feed_item', 'add_reminder',
       'apply_plan_change', 'apply_people_change', 'apply_key_fact_change', 'request_expiry',
       'may_reopen_or_request_backup')
     and has_function_privilege('service_role', p.oid, 'execute')),
  14,
  'All 14 helpers are executable by service_role'
);
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('actor_member', 'active_primary_count', 'step_household_id', 'is_part_closed',
       'effective_approval_state', 'is_high_risk', 'write_audit', 'add_feed_item', 'add_reminder',
       'apply_plan_change', 'apply_people_change', 'apply_key_fact_change', 'request_expiry',
       'may_reopen_or_request_backup')
     and p.proconfig @> array['search_path=""']),
  14,
  'All 14 helpers pin an empty search_path'
);

select * from finish();
rollback;
