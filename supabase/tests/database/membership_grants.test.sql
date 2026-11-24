-- pgTAP tests for membership grants, RLS, and seeded invariants
-- (family-app-demo-parity migrations 20261215000000 to 20261215000200).
-- Demo household from seed.sql (Misa d1..02 is its primary caregiver) plus a fake
-- household B with one primary and one deactivated member. All new rows are fake
-- and rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Fixtures (as postgres) ------------------------------------------------------
insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'primary.b.grants.test@example.com', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'former.b.grants.test@example.com', now(), now());
insert into public.households (id, name)
values ('b0000000-0000-4000-8000-000000000001', 'Grants household B');
insert into public.household_members (id, household_id, user_id, display_name, role, is_active)
values
  ('b2000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000001', 'B Primary', 'primary_caregiver', true),
  ('b2000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000001',
   'b1000000-0000-4000-8000-000000000002', 'B Former', 'family_member', false);
insert into public.audit_events (household_id, actor_type, event_type, payload)
values ('b0000000-0000-4000-8000-000000000001', 'system', 'household.created', '{}'::jsonb);

-- household_invites: no client grants, RLS on, service role has access ----------
select ok(
  not has_table_privilege('anon', 'public.household_invites', 'select')
  and not has_table_privilege('anon', 'public.household_invites', 'insert')
  and not has_table_privilege('anon', 'public.household_invites', 'update')
  and not has_table_privilege('anon', 'public.household_invites', 'delete'),
  'anon has no privilege on household_invites');
select ok(
  not has_table_privilege('authenticated', 'public.household_invites', 'select')
  and not has_table_privilege('authenticated', 'public.household_invites', 'insert')
  and not has_table_privilege('authenticated', 'public.household_invites', 'update')
  and not has_table_privilege('authenticated', 'public.household_invites', 'delete'),
  'authenticated has no privilege on household_invites');
select ok(
  has_table_privilege('service_role', 'public.household_invites', 'select')
  and has_table_privilege('service_role', 'public.household_invites', 'insert')
  and has_table_privilege('service_role', 'public.household_invites', 'update'),
  'service_role can use household_invites');
select ok((select relrowsecurity from pg_class where oid = 'public.household_invites'::regclass),
  'RLS is enabled on household_invites');
select is((select count(*)::int from pg_policies where tablename = 'household_invites'), 0,
  'household_invites has no policies');

-- households and household_members: no client writes -----------------------------
select ok(
  not has_table_privilege('anon', 'public.households', 'insert')
  and not has_table_privilege('anon', 'public.households', 'update')
  and not has_table_privilege('anon', 'public.households', 'delete')
  and not has_table_privilege('authenticated', 'public.households', 'insert')
  and not has_table_privilege('authenticated', 'public.households', 'update')
  and not has_table_privilege('authenticated', 'public.households', 'delete'),
  'Browser roles cannot write households');
select ok(
  not has_table_privilege('anon', 'public.household_members', 'insert')
  and not has_table_privilege('anon', 'public.household_members', 'update')
  and not has_table_privilege('anon', 'public.household_members', 'delete')
  and not has_table_privilege('authenticated', 'public.household_members', 'insert')
  and not has_table_privilege('authenticated', 'public.household_members', 'update')
  and not has_table_privilege('authenticated', 'public.household_members', 'delete'),
  'Browser roles cannot write household_members');
select ok(
  not has_table_privilege('authenticated', 'public.audit_events', 'update')
  and not has_table_privilege('authenticated', 'public.audit_events', 'delete')
  and not has_table_privilege('anon', 'public.audit_events', 'update')
  and not has_table_privilege('anon', 'public.audit_events', 'delete'),
  'Browser roles cannot update or delete audit events');

-- The ten public functions: service_role only -----------------------------------
select ok(
  not has_function_privilege('anon', 'public.create_household(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_household(uuid,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.create_household(uuid,text,text)', 'execute'),
  'create_household is service_role only');
select ok(
  not has_function_privilege('anon', 'public.create_invite(uuid,uuid,text,bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.create_invite(uuid,uuid,text,bytea)', 'execute')
  and has_function_privilege('service_role', 'public.create_invite(uuid,uuid,text,bytea)', 'execute'),
  'create_invite is service_role only');
select ok(
  not has_function_privilege('anon', 'public.list_invites(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.list_invites(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.list_invites(uuid,uuid)', 'execute'),
  'list_invites is service_role only');
select ok(
  not has_function_privilege('anon', 'public.revoke_invite(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.revoke_invite(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.revoke_invite(uuid,uuid,uuid)', 'execute'),
  'revoke_invite is service_role only');
select ok(
  not has_function_privilege('anon', 'public.preview_invite(bytea)', 'execute')
  and not has_function_privilege('authenticated', 'public.preview_invite(bytea)', 'execute')
  and has_function_privilege('service_role', 'public.preview_invite(bytea)', 'execute'),
  'preview_invite is service_role only');
select ok(
  not has_function_privilege('anon', 'public.accept_invite(bytea,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.accept_invite(bytea,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.accept_invite(bytea,uuid,text)', 'execute'),
  'accept_invite is service_role only');
select ok(
  not has_function_privilege('anon', 'public.change_member_role(uuid,uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.change_member_role(uuid,uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.change_member_role(uuid,uuid,uuid,text)', 'execute'),
  'change_member_role is service_role only');
select ok(
  not has_function_privilege('anon', 'public.deactivate_member(uuid,uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.deactivate_member(uuid,uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.deactivate_member(uuid,uuid,uuid)', 'execute'),
  'deactivate_member is service_role only');
select ok(
  not has_function_privilege('anon', 'public.leave_household(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.leave_household(uuid,uuid)', 'execute')
  and has_function_privilege('service_role', 'public.leave_household(uuid,uuid)', 'execute'),
  'leave_household is service_role only');
select ok(
  not has_function_privilege('anon', 'public.set_member_display_name(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.set_member_display_name(uuid,uuid,text)', 'execute')
  and has_function_privilege('service_role', 'public.set_member_display_name(uuid,uuid,text)', 'execute'),
  'set_member_display_name is service_role only');
select ok(
  not has_function_privilege('authenticated', 'private.release_departing_member(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.expire_overdue_invites(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.lock_active_members(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.notify_primaries(uuid,uuid,text,jsonb,uuid)', 'execute'),
  'Membership helpers are not executable by browser roles');
select ok(
  (select bool_and(p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_household', 'create_invite', 'list_invites', 'revoke_invite', 'preview_invite',
                       'accept_invite', 'change_member_role', 'deactivate_member', 'leave_household',
                       'set_member_display_name')),
  'The ten membership functions are security definer');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_household', 'create_invite', 'list_invites', 'revoke_invite', 'preview_invite',
                       'accept_invite', 'change_member_role', 'deactivate_member', 'leave_household',
                       'set_member_display_name')
     and p.proconfig @> array['search_path=""']),
  10, 'The ten membership functions pin search_path to empty');

-- Seeded invariants --------------------------------------------------------------
select is(
  (select count(*)::int from public.households h
   where not exists (select 1 from public.household_members m
                     where m.household_id = h.id and m.role = 'primary_caregiver' and m.is_active)),
  0, 'Every household has an active primary caregiver');
select is(
  (select count(*)::int from (
     select user_id from public.household_members where is_active group by user_id having count(*) > 1) d),
  0, 'Every account is active in at most one household');
select is(
  (select count(*)::int from public.household_invites), 0, 'The seed adds no invite rows');

-- RLS: a member of A sees nothing of B ---------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "d1000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select is((select count(*)::int from public.household_members where household_id = 'b0000000-0000-4000-8000-000000000001'), 0,
  'A member of household A reads no members of household B');
select is((select count(*)::int from public.audit_events where household_id = 'b0000000-0000-4000-8000-000000000001'), 0,
  'A member of household A reads no audit events of household B');
select ok((select count(*)::int from public.household_members where household_id = 'd0000000-0000-4000-8000-000000000001') >= 5,
  'A member of household A reads the members of household A');
select throws_ok($$ select count(*) from public.household_invites $$, '42501', null,
  'A member cannot read household_invites');
select throws_ok(
  $$ update public.household_members set role = 'primary_caregiver' where user_id = 'd1000000-0000-4000-8000-000000000002' $$,
  '42501', null, 'A member cannot update household_members');
select throws_ok(
  $$ delete from public.household_members where household_id = 'd0000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'A member cannot delete household_members');
select throws_ok(
  $$ insert into public.household_members (household_id, user_id, display_name, role)
     values ('d0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'X', 'family_member') $$,
  '42501', null, 'A member cannot insert household_members');
select throws_ok(
  $$ update public.households set name = 'renamed' $$, '42501', null, 'A member cannot update households');
select throws_ok(
  $$ select public.create_household('d1000000-0000-4000-8000-000000000002', 'Home', 'Misa') $$,
  '42501', null, 'A signed-in member cannot call create_household directly');
select throws_ok(
  $$ select public.accept_invite(decode(repeat('ab', 32), 'hex'), 'd1000000-0000-4000-8000-000000000002', 'Misa') $$,
  '42501', null, 'A signed-in member cannot call accept_invite directly');
select throws_ok(
  $$ select public.deactivate_member('d0000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000002') $$,
  '42501', null, 'A signed-in member cannot call deactivate_member directly');

-- RLS: a deactivated member reads nothing -------------------------------------------
set local request.jwt.claims = '{"sub": "b1000000-0000-4000-8000-000000000002", "role": "authenticated"}';
select is((select count(*)::int from public.household_members), 0,
  'A deactivated member reads no members');
select is((select count(*)::int from public.audit_events), 0,
  'A deactivated member reads no audit events');
select is((select count(*)::int from public.feed_items), 0,
  'A deactivated member reads no feed items');
select is((select count(*)::int from public.households), 0,
  'A deactivated member reads no households');

-- Refusals through the service role: a non-member gets not_found, no data ------------
reset role;
set local role service_role;
select throws_ok(
  $$ select public.list_invites('b0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_found', 'A member of A listing invites of B gets not_found');
select throws_ok(
  $$ select public.create_invite('b0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'family_member', decode(repeat('01', 32), 'hex')) $$,
  'P0001', 'not_found', 'A member of A creating an invite in B gets not_found');
select throws_ok(
  $$ select public.change_member_role('b0000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'family_member') $$,
  'P0001', 'not_found', 'A member of A changing a role in B gets not_found');
select throws_ok(
  $$ select public.deactivate_member('d0000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003') $$,
  'P0001', 'not_primary_caregiver', 'A non-primary member cannot remove another member');
select throws_ok(
  $$ select public.leave_household('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000002') $$,
  'P0001', 'not_found', 'A former member cannot leave again (not_found)');
select throws_ok(
  $$ select public.leave_household('b0000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001') $$,
  'P0001', 'last_primary_caregiver', 'The last primary caregiver cannot leave');
select throws_ok(
  $$ select public.create_household('d1000000-0000-4000-8000-000000000002', 'Home', 'Misa') $$,
  'P0001', 'already_in_household', 'An account active in a household cannot create another');
select is(
  (select count(*)::int from public.household_members where household_id = 'b0000000-0000-4000-8000-000000000001' and is_active),
  1, 'Refusals left household B unchanged');
select is(
  (select count(*)::int from public.audit_events where household_id = 'b0000000-0000-4000-8000-000000000001'), 1,
  'Refusals wrote no audit events');

select * from finish();
rollback;
