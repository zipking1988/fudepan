-- pgTAP tests for migration 20261210000100_shared_care_tables.
-- Relies on the demo household from supabase/seed.sql plus an outsider household
-- created here. All fixtures are fake and everything is rolled back.
begin;
create extension if not exists pgtap with schema extensions;

select plan(104);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres)
--   Demo household: Misa (primary caregiver, d2..02), Kenta (finance, d2..03),
--   Haruko (care recipient, d2..01).
--   Outsider household: two members, so a request can have a distinct from and to.
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000022',
   'authenticated', 'authenticated', 'outsider.one.tables.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'e1000000-0000-4000-8000-000000000023',
   'authenticated', 'authenticated', 'outsider.two.tables.test@example.com', now(), now());
insert into public.households (id, name)
values ('e0000000-0000-4000-8000-000000000022', 'Outsider household');
insert into public.household_members (id, household_id, user_id, display_name, role)
values
  ('e2000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000022',
   'e1000000-0000-4000-8000-000000000022', 'Outsider One', 'primary_caregiver'),
  ('e2000000-0000-4000-8000-000000000023', 'e0000000-0000-4000-8000-000000000022',
   'e1000000-0000-4000-8000-000000000023', 'Outsider Two', 'finance_coordinator');

insert into public.notes (id, household_id, uploaded_by, image_path, status)
values
  ('b1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'd1000000-0000-4000-8000-000000000002',
   'd0000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/1763700000000-note.png',
   'pending_review'),
  ('b1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'e1000000-0000-4000-8000-000000000022',
   'e0000000-0000-4000-8000-000000000022/b1000000-0000-4000-8000-000000000002/1763700000000-note.png',
   'pending_review');
insert into public.care_chains (id, household_id, note_id, title, risk_level)
values
  ('b2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001', 'Fake demo chain', 'high'),
  ('b2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b1000000-0000-4000-8000-000000000002', 'Fake outsider chain', 'high');
insert into public.care_steps (
  id, care_chain_id, title, care_category, risk_level, approval_required, status, source_quote
)
values
  ('b3000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
   'Fake demo step', 'appointment', 'high', true, 'pending_review', 'Hospital?'),
  ('b3000000-0000-4000-8000-000000000002', 'b2000000-0000-4000-8000-000000000002',
   'Fake outsider step', 'appointment', 'high', true, 'pending_review', 'Hospital?');

-- Audit events that feed items and escalations point at
insert into public.audit_events (id, household_id, actor_type, event_type)
values
  ('ae000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'system', 'test.feed_a'),
  ('ae000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022', 'system', 'test.feed_b'),
  ('ae000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001', 'system', 'test.escalation_a'),
  ('ae000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-000000000022', 'system', 'test.escalation_b');

-- care_requests: one pending assignment per household
insert into public.care_requests (
  id, household_id, care_chain_id, care_step_id, kind, helper_role,
  from_member_id, to_member_id, expires_at, expiry_rule
)
values
  ('c1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001',
   'assignment', 'owner', 'd2000000-0000-4000-8000-000000000002',
   'd2000000-0000-4000-8000-000000000003', now() + interval '1 day', '24h'),
  ('c1000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002',
   'assignment', 'owner', 'e2000000-0000-4000-8000-000000000022',
   'e2000000-0000-4000-8000-000000000023', now() + interval '1 day', '24h');

-- part_evidence
insert into public.part_evidence (
  id, household_id, care_chain_id, care_step_id, label, kind, storage_path, added_by
)
values
  ('c2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001',
   'other', 'photo',
   'd0000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001/1763700000000-evidence.png',
   'd2000000-0000-4000-8000-000000000002'),
  ('c2000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002',
   'other', 'photo',
   'e0000000-0000-4000-8000-000000000022/b3000000-0000-4000-8000-000000000002/1763700000000-evidence.png',
   'e2000000-0000-4000-8000-000000000022');

-- part_missing_details
insert into public.part_missing_details (
  id, household_id, care_chain_id, care_step_id, kind, question_code
)
values
  ('c3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001',
   'date', 'missing_date'),
  ('c3000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002',
   'date', 'missing_date');

-- part_resubmissions
insert into public.part_resubmissions (
  id, household_id, care_chain_id, care_step_id, submitted_by, explanation
)
values
  ('c4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001',
   'd2000000-0000-4000-8000-000000000002', 'Fake explanation'),
  ('c4000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002',
   'e2000000-0000-4000-8000-000000000022', 'Fake explanation');

-- feed_items: A1 household item, A2 reminder addressed to Kenta, B1 outsider item
insert into public.feed_items (
  id, household_id, kind, recipient_member_id, audit_event_id
)
values
  ('c5000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'event_created', null, 'ae000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001',
   'reminder_respond_by', 'd2000000-0000-4000-8000-000000000003',
   'ae000000-0000-4000-8000-000000000001'),
  ('c5000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-000000000022',
   'event_created', null, 'ae000000-0000-4000-8000-000000000002');

-- member_feed_state: Misa and Kenta in the demo household, one outsider
insert into public.member_feed_state (member_id, household_id)
values
  ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000001'),
  ('d2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000001'),
  ('e2000000-0000-4000-8000-000000000022', 'e0000000-0000-4000-8000-000000000022');

-- Service-only tables
insert into public.recognition_runs (id, household_id, note_id, status)
values
  ('c6000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001', 'running'),
  ('c6000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b1000000-0000-4000-8000-000000000002', 'queued');
insert into public.step_escalations (
  id, household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id
)
values
  ('c7000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   'b2000000-0000-4000-8000-000000000001', 'b3000000-0000-4000-8000-000000000001',
   'task_due', '2026-12-04 01:00:00+00', 'ae000000-0000-4000-8000-000000000003'),
  ('c7000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000022',
   'b2000000-0000-4000-8000-000000000002', 'b3000000-0000-4000-8000-000000000002',
   'task_due', '2026-12-04 01:00:00+00', 'ae000000-0000-4000-8000-000000000004');
insert into public.household_sweeps (household_id)
values ('d0000000-0000-4000-8000-000000000001')
on conflict (household_id) do nothing;

-- ---------------------------------------------------------------------------
-- Schema shape: RLS is on for every new table, and the bucket is private
-- ---------------------------------------------------------------------------
select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('care_requests', 'part_evidence', 'part_missing_details',
                       'part_resubmissions', 'feed_items', 'member_feed_state',
                       'recognition_runs', 'step_escalations', 'household_sweeps')
     and c.relrowsecurity),
  9,
  'Row-level security is enabled on all nine new tables'
);
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename in ('recognition_runs', 'step_escalations', 'household_sweeps')),
  0,
  'The three service-only tables have no policy for any client role'
);
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'public'
     and tablename in ('care_requests', 'part_evidence', 'part_missing_details',
                       'part_resubmissions', 'feed_items', 'member_feed_state')
     and cmd <> 'SELECT'),
  0,
  'The six member-readable tables have select policies only'
);
select results_eq(
  $$ select public, file_size_limit, allowed_mime_types
     from storage.buckets where id = 'evidence' $$,
  $$ values (false, 10485760::bigint,
             array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]) $$,
  'The evidence bucket is private with a 10 MB limit and image/PDF types only'
);
select is(
  (select count(*)::int
   from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and roles && array['anon', 'authenticated', 'public']::name[]
     and (coalesce(qual, '') || coalesce(with_check, '')) like '%evidence%'),
  0,
  'No Storage policy gives anon or authenticated access to the evidence bucket'
);

-- ---------------------------------------------------------------------------
-- A demo household member (Misa) sees only demo rows on every readable table
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select results_eq(
  'select id from public.care_requests',
  $$ values ('c1000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees only their household care requests'
);
select results_eq(
  'select id from public.part_evidence',
  $$ values ('c2000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees only their household evidence'
);
select results_eq(
  'select id from public.part_missing_details',
  $$ values ('c3000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees only their household missing details'
);
select results_eq(
  'select id from public.part_resubmissions',
  $$ values ('c4000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees only their household resubmissions'
);
select results_eq(
  'select id from public.feed_items',
  $$ values ('c5000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees the household feed item and not a reminder addressed to someone else'
);
select is_empty(
  'select id from public.feed_items where recipient_member_id is not null',
  'Misa cannot see the reminder addressed to Kenta'
);
select results_eq(
  'select member_id from public.member_feed_state',
  $$ values ('d2000000-0000-4000-8000-000000000002'::uuid) $$,
  'Member sees only their own feed state'
);

-- Service-only tables are unreadable
select throws_ok('select * from public.recognition_runs', '42501', null,
  'Member cannot read recognition_runs');
select throws_ok('select * from public.step_escalations', '42501', null,
  'Member cannot read step_escalations');
select throws_ok('select * from public.household_sweeps', '42501', null,
  'Member cannot read household_sweeps');

-- No client writes on any readable table
select throws_ok(
  $$ insert into public.care_requests (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'Member cannot insert care_requests');
select throws_ok(
  $$ update public.care_requests set status = 'accepted' $$,
  '42501', null, 'Member cannot update care_requests');
select throws_ok(
  $$ delete from public.care_requests $$,
  '42501', null, 'Member cannot delete care_requests');
select throws_ok(
  $$ insert into public.part_evidence (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'Member cannot insert part_evidence');
select throws_ok(
  $$ update public.part_evidence set label = 'x' $$,
  '42501', null, 'Member cannot update part_evidence');
select throws_ok(
  $$ delete from public.part_evidence $$,
  '42501', null, 'Member cannot delete part_evidence');
select throws_ok(
  $$ insert into public.part_missing_details (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'Member cannot insert part_missing_details');
select throws_ok(
  $$ update public.part_missing_details set answer = 'x' $$,
  '42501', null, 'Member cannot update part_missing_details');
select throws_ok(
  $$ delete from public.part_missing_details $$,
  '42501', null, 'Member cannot delete part_missing_details');
select throws_ok(
  $$ insert into public.part_resubmissions (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'Member cannot insert part_resubmissions');
select throws_ok(
  $$ update public.part_resubmissions set explanation = 'x' $$,
  '42501', null, 'Member cannot update part_resubmissions');
select throws_ok(
  $$ delete from public.part_resubmissions $$,
  '42501', null, 'Member cannot delete part_resubmissions');
select throws_ok(
  $$ insert into public.feed_items (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'Member cannot insert feed_items');
select throws_ok(
  $$ update public.feed_items set seen_at = now() $$,
  '42501', null, 'Member cannot update feed_items');
select throws_ok(
  $$ delete from public.feed_items $$,
  '42501', null, 'Member cannot delete feed_items');
select throws_ok(
  $$ insert into public.member_feed_state (member_id, household_id)
     values ('d2000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'Member cannot insert member_feed_state');
select throws_ok(
  $$ update public.member_feed_state set last_seen_at = now() $$,
  '42501', null, 'Member cannot update member_feed_state');
select throws_ok(
  $$ delete from public.member_feed_state $$,
  '42501', null, 'Member cannot delete member_feed_state');

-- audit_events stays append-only for client roles
select throws_ok(
  $$ insert into public.audit_events (household_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'system', 'test.client_write') $$,
  '42501', null, 'Member cannot insert audit_events');
select throws_ok(
  $$ update public.audit_events set payload = '{}' $$,
  '42501', null, 'Member cannot update audit_events');
select throws_ok(
  $$ delete from public.audit_events $$,
  '42501', null, 'Member cannot delete audit_events');

-- The evidence bucket has no client access
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('evidence', 'd0000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001/1763700000000-evidence.png') $$,
  '42501', null, 'Member cannot upload to the evidence bucket');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'evidence'),
  0,
  'Member cannot list objects in the evidence bucket'
);

reset role;

-- ---------------------------------------------------------------------------
-- Kenta (the addressee) sees his reminder; Haruko (another member) does not
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select results_eq(
  'select id from public.feed_items order by id',
  $$ values ('c5000000-0000-4000-8000-000000000001'::uuid),
            ('c5000000-0000-4000-8000-000000000002'::uuid) $$,
  'The addressed member sees the household item and their own reminder'
);
select results_eq(
  'select member_id from public.member_feed_state',
  $$ values ('d2000000-0000-4000-8000-000000000003'::uuid) $$,
  'Kenta sees only his own feed state'
);

reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select results_eq(
  'select id from public.feed_items',
  $$ values ('c5000000-0000-4000-8000-000000000001'::uuid) $$,
  'The care recipient does not see a reminder addressed to another member'
);

reset role;

-- ---------------------------------------------------------------------------
-- A member of the outsider household sees nothing from the demo household
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000022", "role": "authenticated"}';

select results_eq(
  'select id from public.care_requests',
  $$ values ('c1000000-0000-4000-8000-000000000002'::uuid) $$,
  'Outsider sees only their own care requests'
);
select results_eq(
  'select id from public.part_evidence',
  $$ values ('c2000000-0000-4000-8000-000000000002'::uuid) $$,
  'Outsider sees only their own evidence'
);
select results_eq(
  'select id from public.part_missing_details',
  $$ values ('c3000000-0000-4000-8000-000000000002'::uuid) $$,
  'Outsider sees only their own missing details'
);
select results_eq(
  'select id from public.part_resubmissions',
  $$ values ('c4000000-0000-4000-8000-000000000002'::uuid) $$,
  'Outsider sees only their own resubmissions'
);
select results_eq(
  'select id from public.feed_items',
  $$ values ('c5000000-0000-4000-8000-000000000003'::uuid) $$,
  'Outsider sees only their own feed items'
);
select results_eq(
  'select member_id from public.member_feed_state',
  $$ values ('e2000000-0000-4000-8000-000000000022'::uuid) $$,
  'Outsider sees only their own feed state'
);
select is_empty(
  $$ select 1 from public.feed_items where household_id = 'd0000000-0000-4000-8000-000000000001' $$,
  'Outsider cannot see a demo household reminder'
);

reset role;

-- ---------------------------------------------------------------------------
-- anon: no read and no write on any new table
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok('select * from public.care_requests', '42501', null, 'anon cannot read care_requests');
select throws_ok('select * from public.part_evidence', '42501', null, 'anon cannot read part_evidence');
select throws_ok('select * from public.part_missing_details', '42501', null, 'anon cannot read part_missing_details');
select throws_ok('select * from public.part_resubmissions', '42501', null, 'anon cannot read part_resubmissions');
select throws_ok('select * from public.feed_items', '42501', null, 'anon cannot read feed_items');
select throws_ok('select * from public.member_feed_state', '42501', null, 'anon cannot read member_feed_state');
select throws_ok('select * from public.recognition_runs', '42501', null, 'anon cannot read recognition_runs');
select throws_ok('select * from public.step_escalations', '42501', null, 'anon cannot read step_escalations');
select throws_ok('select * from public.household_sweeps', '42501', null, 'anon cannot read household_sweeps');

select throws_ok(
  $$ insert into public.care_requests (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert care_requests');
select throws_ok(
  $$ insert into public.part_evidence (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert part_evidence');
select throws_ok(
  $$ insert into public.part_missing_details (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert part_missing_details');
select throws_ok(
  $$ insert into public.part_resubmissions (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert part_resubmissions');
select throws_ok(
  $$ insert into public.feed_items (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert feed_items');
select throws_ok(
  $$ insert into public.member_feed_state (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert member_feed_state');
select throws_ok(
  $$ insert into public.recognition_runs (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert recognition_runs');
select throws_ok(
  $$ insert into public.step_escalations (household_id) values ('d0000000-0000-4000-8000-000000000001') $$,
  '42501', null, 'anon cannot insert step_escalations');
select throws_ok(
  $$ insert into public.household_sweeps (household_id) values ('e0000000-0000-4000-8000-000000000022') $$,
  '42501', null, 'anon cannot insert household_sweeps');

select throws_ok($$ update public.care_requests set status = 'accepted' $$, '42501', null, 'anon cannot update care_requests');
select throws_ok($$ update public.part_evidence set label = 'x' $$, '42501', null, 'anon cannot update part_evidence');
select throws_ok($$ update public.part_missing_details set answer = 'x' $$, '42501', null, 'anon cannot update part_missing_details');
select throws_ok($$ update public.part_resubmissions set explanation = 'x' $$, '42501', null, 'anon cannot update part_resubmissions');
select throws_ok($$ update public.feed_items set seen_at = now() $$, '42501', null, 'anon cannot update feed_items');
select throws_ok($$ update public.member_feed_state set last_seen_at = now() $$, '42501', null, 'anon cannot update member_feed_state');
select throws_ok($$ update public.recognition_runs set status = 'failed' $$, '42501', null, 'anon cannot update recognition_runs');
select throws_ok($$ update public.step_escalations set deadline_kind = 'respond_by' $$, '42501', null, 'anon cannot update step_escalations');
select throws_ok($$ update public.household_sweeps set last_run_at = now() $$, '42501', null, 'anon cannot update household_sweeps');

select throws_ok($$ delete from public.care_requests $$, '42501', null, 'anon cannot delete care_requests');
select throws_ok($$ delete from public.part_evidence $$, '42501', null, 'anon cannot delete part_evidence');
select throws_ok($$ delete from public.part_missing_details $$, '42501', null, 'anon cannot delete part_missing_details');
select throws_ok($$ delete from public.part_resubmissions $$, '42501', null, 'anon cannot delete part_resubmissions');
select throws_ok($$ delete from public.feed_items $$, '42501', null, 'anon cannot delete feed_items');
select throws_ok($$ delete from public.member_feed_state $$, '42501', null, 'anon cannot delete member_feed_state');
select throws_ok($$ delete from public.recognition_runs $$, '42501', null, 'anon cannot delete recognition_runs');
select throws_ok($$ delete from public.step_escalations $$, '42501', null, 'anon cannot delete step_escalations');
select throws_ok($$ delete from public.household_sweeps $$, '42501', null, 'anon cannot delete household_sweeps');

select throws_ok(
  $$ update public.audit_events set payload = '{}' $$,
  '42501', null, 'anon cannot update audit_events');
select throws_ok(
  $$ delete from public.audit_events $$,
  '42501', null, 'anon cannot delete audit_events');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name)
     values ('evidence', 'd0000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000001/1763700000000-evidence.png') $$,
  '42501', null, 'anon cannot upload to the evidence bucket');

reset role;

-- ---------------------------------------------------------------------------
-- service_role reads and writes the service-only tables
-- ---------------------------------------------------------------------------
set local role service_role;

select is(
  (select count(*)::int from public.recognition_runs
   where id in ('c6000000-0000-4000-8000-000000000001', 'c6000000-0000-4000-8000-000000000002')),
  2,
  'service_role reads recognition_runs across households'
);
select lives_ok(
  $$ insert into public.household_sweeps (household_id)
     values ('e0000000-0000-4000-8000-000000000022') $$,
  'service_role can insert household_sweeps'
);

reset role;

-- ---------------------------------------------------------------------------
-- care_requests: one pending request per step, kind, and role
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'assignment', 'owner',
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004',
       now() + interval '1 day', '24h'
     ) $$,
  '23505', null,
  'A second pending assignment for the same step and role is rejected'
);
select lives_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'handover', 'driver',
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004',
       now() + interval '1 day', '24h'
     ) $$,
  'A pending handover for another role on the same step is accepted'
);
select throws_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'handover', 'driver',
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003',
       now() + interval '1 day', '24h'
     ) $$,
  '23505', null,
  'A second pending handover for the same step and role is rejected'
);
select lives_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, status, expires_at, expiry_rule, resolved_at, resolved_by
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'assignment', 'owner',
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004',
       'declined', now() + interval '1 day', '24h', now(), 'd2000000-0000-4000-8000-000000000004'
     ) $$,
  'A resolved request does not block the same step, kind, and role'
);
select lives_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'backup', null,
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000004',
       now() + interval '1 day', 'task_due'
     ) $$,
  'A pending backup request with no role is accepted'
);
select throws_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'backup', null,
       'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000003',
       now() + interval '1 day', 'task_due'
     ) $$,
  '23505', null,
  'A second pending backup request for the same step is rejected'
);
select throws_ok(
  $$ insert into public.care_requests (
       household_id, care_chain_id, care_step_id, kind, helper_role,
       from_member_id, to_member_id, expires_at, expiry_rule
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'handover', 'companion',
       'd2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000022',
       now() + interval '1 day', '24h'
     ) $$,
  '23503', null,
  'A care request to a member of another household is rejected'
);

-- ---------------------------------------------------------------------------
-- step_escalations: one escalation per step, deadline kind, and deadline value
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.step_escalations (
       household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'task_due', '2026-12-04 01:00:00+00',
       'ae000000-0000-4000-8000-000000000003'
     ) $$,
  '23505', null,
  'A second escalation for the same step, kind, and deadline is rejected'
);
select lives_ok(
  $$ insert into public.step_escalations (
       household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'task_due', '2026-12-05 01:00:00+00',
       'ae000000-0000-4000-8000-000000000003'
     ) $$,
  'A changed deadline value can escalate again'
);
select lives_ok(
  $$ insert into public.step_escalations (
       household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id
     ) values (
       'd0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001', 'respond_by', '2026-12-04 01:00:00+00',
       'ae000000-0000-4000-8000-000000000003'
     ) $$,
  'A different deadline kind with the same time can escalate'
);

-- ---------------------------------------------------------------------------
-- recognition_runs: at most one active run per note
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.recognition_runs (household_id, note_id, status)
     values ('d0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'queued') $$,
  '23505', null,
  'A second active run for the same note is rejected'
);
select lives_ok(
  $$ insert into public.recognition_runs (household_id, note_id, status)
     values ('d0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'failed') $$,
  'A finished run does not block the active run'
);
select lives_ok(
  $$ update public.recognition_runs set status = 'failed'
     where id = 'c6000000-0000-4000-8000-000000000001' $$,
  'The active run can finish'
);
select lives_ok(
  $$ insert into public.recognition_runs (household_id, note_id, status)
     values ('d0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'queued') $$,
  'A new run is accepted once no run is active for the note'
);
select throws_ok(
  $$ insert into public.recognition_runs (household_id, note_id, status)
     values ('d0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002', 'failed') $$,
  '23503', null,
  'A run cannot point at a note of another household'
);

select * from finish();
rollback;
