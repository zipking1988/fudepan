-- pgTAP tests for the Phase 1 schema, integrity rules, and row-level security.
-- Run with `pnpm test:db` against a local stack (`supabase start` + `supabase db reset`).
-- Relies on the demo household from supabase/seed.sql. Everything is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

-- ---------------------------------------------------------------------------
-- RLS is enabled everywhere
-- ---------------------------------------------------------------------------
select ok(
  (
    select bool_and(c.relrowsecurity)
    from pg_class c
    where c.oid in (
      'public.households'::regclass,
      'public.household_members'::regclass,
      'public.notes'::regclass,
      'public.care_chains'::regclass,
      'public.care_steps'::regclass,
      'public.audit_events'::regclass
    )
  ),
  'RLS is enabled on every care table'
);

-- ---------------------------------------------------------------------------
-- Fixtures (as postgres): a second household and one care chain per household
-- ---------------------------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values (
  '00000000-0000-0000-0000-000000000000',
  'e1000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'outsider.test@example.com',
  now(),
  now()
);

insert into public.households (id, name)
values ('e0000000-0000-4000-8000-000000000001', 'Other household');

insert into public.household_members (id, household_id, user_id, display_name, role)
values (
  'e2000000-0000-4000-8000-000000000001',
  'e0000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Outsider',
  'primary_caregiver'
);

insert into public.notes (id, household_id, uploaded_by, image_path)
values
  (
    'd3000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001/d3000000-0000-4000-8000-000000000001/1763700000000-note.jpg'
  ),
  (
    'e3000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001/e3000000-0000-4000-8000-000000000001/1763700000000-note.jpg'
  );

insert into public.care_chains (id, household_id, note_id, title, risk_level)
values
  (
    'd4000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'Demo chain',
    'high'
  ),
  (
    'e4000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'Other chain',
    'low'
  );

-- ---------------------------------------------------------------------------
-- Integrity rules
-- ---------------------------------------------------------------------------
select throws_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level, approval_required)
     values ('d4000000-0000-4000-8000-000000000001', 'Pick up medication', 'medication', 'high', false) $$,
  '23514',
  null,
  'A high-risk step cannot be saved without approval_required'
);

select lives_ok(
  $$ insert into public.care_steps (id, care_chain_id, title, care_category, risk_level, approval_required, status)
     values ('d5000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001',
             'Pick up medication', 'medication', 'high', true, 'pending_approval') $$,
  'A high-risk step with approval_required is accepted'
);

select throws_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level, owner_id)
     values ('d4000000-0000-4000-8000-000000000001', 'Buy groceries', 'household', 'low',
             'e2000000-0000-4000-8000-000000000001') $$,
  '23514',
  null,
  'A step cannot be owned by a member of another household'
);

select throws_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level, owner_id, backup_owner_id)
     values ('d4000000-0000-4000-8000-000000000001', 'Buy groceries', 'household', 'low',
             'd2000000-0000-4000-8000-000000000002', 'e2000000-0000-4000-8000-000000000001') $$,
  '23514',
  null,
  'A step cannot have a backup owner from another household'
);

select throws_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level, owner_id, backup_owner_id)
     values ('d4000000-0000-4000-8000-000000000001', 'Buy groceries', 'household', 'low',
             'd2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000002') $$,
  '23514',
  null,
  'Owner and backup owner must be different people'
);

select throws_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level, confidence)
     values ('d4000000-0000-4000-8000-000000000001', 'Buy groceries', 'household', 'low', 1.5) $$,
  '23514',
  null,
  'Confidence must be between 0 and 1'
);

select throws_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level)
     values ('d4000000-0000-4000-8000-000000000001', 'Diagnose', 'diagnosis', 'low') $$,
  '23514',
  null,
  'Unknown care categories are rejected'
);

select throws_ok(
  $$ insert into public.care_chains (household_id, note_id, title, risk_level)
     values ('d0000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', 'Mixed', 'low') $$,
  '23503',
  null,
  'A care chain cannot use a note from another household'
);

select throws_ok(
  $$ insert into public.audit_events (household_id, care_chain_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'e4000000-0000-4000-8000-000000000001', 'system', 'care_chain.edited') $$,
  '23503',
  null,
  'An audit event cannot reference a care chain from another household'
);

select throws_ok(
  $$ insert into public.audit_events (household_id, actor_type, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'human', 'care_step.approved') $$,
  '23514',
  null,
  'A human audit event must identify the actor'
);

select throws_ok(
  $$ insert into public.audit_events (household_id, actor_type, event_type, payload)
     values ('d0000000-0000-4000-8000-000000000001', 'system', 'note.uploaded', '[]') $$,
  '23514',
  null,
  'Audit payload must be a JSON object'
);

-- ---------------------------------------------------------------------------
-- service_role (server-side code) can write, and triggers run for it
-- ---------------------------------------------------------------------------
set local role service_role;

select lives_ok(
  $$ insert into public.care_steps (care_chain_id, title, care_category, risk_level, owner_id)
     values ('d4000000-0000-4000-8000-000000000001', 'Buy groceries', 'household', 'low',
             'd2000000-0000-4000-8000-000000000002') $$,
  'service_role can create a step owned by a household member'
);

select lives_ok(
  $$ update public.care_chains set title = 'Demo chain (edited)'
     where id = 'd4000000-0000-4000-8000-000000000001' $$,
  'service_role can edit a care chain'
);

reset role;

-- ---------------------------------------------------------------------------
-- anon has no access
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok(
  'select * from public.households',
  '42501',
  null,
  'anon cannot read households'
);

select throws_ok(
  'select * from public.audit_events',
  '42501',
  null,
  'anon cannot read audit events'
);

reset role;

-- ---------------------------------------------------------------------------
-- A household member sees only their household and cannot write
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';

select results_eq(
  'select id from public.households',
  $$ values ('d0000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees only their own household'
);

select is(
  (select count(*)::int from public.household_members),
  5,
  'Member sees the 5 demo household members only'
);

select results_eq(
  'select id from public.care_chains',
  $$ values ('d4000000-0000-4000-8000-000000000001'::uuid) $$,
  'Member sees only their household care chains'
);

select is(
  (select count(*)::int from public.care_steps),
  2,
  'Member sees the steps of their household chain'
);

select is(
  (select count(*)::int from public.audit_events),
  6,
  'Member sees the seeded audit events of their household'
);

select throws_ok(
  $$ insert into public.households (name) values ('Sneaky household') $$,
  '42501',
  null,
  'Member cannot create households from the client'
);

select throws_ok(
  $$ update public.care_steps set status = 'approved'
     where id = 'd5000000-0000-4000-8000-000000000001' $$,
  '42501',
  null,
  'Member cannot approve a high-risk step directly from the client'
);

select throws_ok(
  $$ insert into public.audit_events (household_id, actor_type, actor_id, event_type)
     values ('d0000000-0000-4000-8000-000000000001', 'human',
             'd1000000-0000-4000-8000-000000000002', 'care_step.approved') $$,
  '42501',
  null,
  'Member cannot write audit events from the client'
);

select throws_ok(
  $$ update public.audit_events set payload = '{}' $$,
  '42501',
  null,
  'Member cannot modify audit events'
);

select throws_ok(
  $$ delete from public.audit_events $$,
  '42501',
  null,
  'Member cannot delete audit events'
);

reset role;

-- ---------------------------------------------------------------------------
-- A member of another household sees nothing from the demo household
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "e1000000-0000-4000-8000-000000000001", "role": "authenticated"}';

select results_eq(
  'select id from public.households',
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid) $$,
  'Outsider sees only their own household'
);

select is(
  (select count(*)::int from public.audit_events
   where household_id = 'd0000000-0000-4000-8000-000000000001'),
  0,
  'Outsider cannot read the demo household audit trail'
);

reset role;

-- ---------------------------------------------------------------------------
-- Deactivated members lose access
-- ---------------------------------------------------------------------------
update public.household_members
set is_active = false
where id = 'd2000000-0000-4000-8000-000000000003';

set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000003", "role": "authenticated"}';

select is_empty(
  'select id from public.households',
  'A deactivated member can no longer see the household'
);

reset role;

select * from finish();

rollback;
