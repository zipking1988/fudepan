-- pgTAP scenario tests for the membership functions (family-app-demo-parity task 5.8).
-- Fixed scenarios that match the reference model in src/lib/membership/model.ts.
-- All rows are fake and rolled back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at)
select '00000000-0000-0000-0000-000000000000', ('f1000000-0000-4000-8000-00000000000' || n)::uuid,
       'authenticated', 'authenticated', 'u' || n || '.functions.test@example.com', now(), now()
from generate_series(1, 5) n;
set local role service_role;

-- create_household ----------------------------------------------------------------
select throws_ok($$ select public.create_household('f1000000-0000-4000-8000-000000000001', '   ', 'Ann') $$,
  'P0001', 'invalid_input', 'A blank household name is refused');
select throws_ok($$ select public.create_household('f1000000-0000-4000-8000-000000000001', 'Home', repeat('x', 41)) $$,
  'P0001', 'invalid_input', 'A 41-character display name is refused');
create temp table h1 as
  select public.create_household('f1000000-0000-4000-8000-000000000001', '  Home  ', 'Ann') as r;
grant select on h1 to service_role;
select is((select r ->> 'outcome' from h1), 'created', 'create_household creates');
select is((select name from public.households where id = (select (r ->> 'household_id')::uuid from h1)), 'Home',
  'The household name is trimmed');
select is((select count(*)::int from public.audit_events where household_id = (select (r ->> 'household_id')::uuid from h1)
           and event_type in ('household.created', 'member.joined') and actor_type = 'human'), 2,
  'Two human audit events are written');
select throws_ok($$ select public.create_household('f1000000-0000-4000-8000-000000000001', 'Again', 'Ann') $$,
  'P0001', 'already_in_household', 'A second household for the same account is refused');

-- create_invite and list_invites -------------------------------------------------------
create temp table i1 as
  select public.create_invite((select (r ->> 'household_id')::uuid from h1),
    'f1000000-0000-4000-8000-000000000001', 'family_member', decode(repeat('a1', 32), 'hex')) as r;
grant select on i1 to service_role;
select is((select r ->> 'outcome' from i1), 'created', 'create_invite creates');
select is((select expires_at - created_at from public.household_invites where id = (select (r ->> 'invite_id')::uuid from i1)),
  interval '7 days', 'The invite expires 7 days after creation');
select is((select payload from public.audit_events where event_type = 'invite.created'),
  jsonb_build_object('invite_id', (select r ->> 'invite_id' from i1), 'role', 'family_member'),
  'invite.created holds an ID and a Role code only');
select is((public.list_invites((select (r ->> 'household_id')::uuid from h1), 'f1000000-0000-4000-8000-000000000001') -> 'invites' -> 0 ->> 'state'),
  'pending', 'list_invites shows the pending invite');
select ok(not (public.list_invites((select (r ->> 'household_id')::uuid from h1), 'f1000000-0000-4000-8000-000000000001')::text like '%token%'),
  'list_invites never returns the token hash');
select throws_ok($$ select public.create_invite((select (r ->> 'household_id')::uuid from h1), 'f1000000-0000-4000-8000-000000000001', 'boss', decode(repeat('a2', 32), 'hex')) $$,
  'P0001', 'invalid_input', 'An unknown Role is refused');

-- preview and accept --------------------------------------------------------------------
select is((public.preview_invite(decode(repeat('a1', 32), 'hex'))), jsonb_build_object(
  'outcome', 'usable', 'household_name', 'Home', 'creator_display_name', 'Ann', 'role', 'family_member',
  'expires_at', (select r ->> 'expires_at' from i1)), 'A pending invite previews household, creator, and Role');
select is(public.preview_invite(decode(repeat('ff', 32), 'hex')), '{"outcome": "unusable"}'::jsonb,
  'An unknown token is unusable');
select throws_ok($$ select public.accept_invite(decode(repeat('a1', 32), 'hex'), 'f1000000-0000-4000-8000-000000000001', 'Ann again') $$,
  'P0001', 'already_member', 'An active member cannot accept (invite stays pending)');
select throws_ok($$ select public.accept_invite(decode(repeat('a1', 32), 'hex'), 'f1000000-0000-4000-8000-000000000002', ' ') $$,
  'P0001', 'invalid_input', 'A blank display name is refused');
select is((select state from public.household_invites where token_hash = decode(repeat('a1', 32), 'hex')), 'pending',
  'Refusals leave the invite pending');
create temp table a1 as
  select public.accept_invite(decode(repeat('a1', 32), 'hex'), 'f1000000-0000-4000-8000-000000000002', 'Bea') as r;
grant select on a1 to service_role;
select is((select r ->> 'outcome' from a1), 'joined', 'accept_invite joins');
select is((select role from public.household_members where user_id = 'f1000000-0000-4000-8000-000000000002'), 'family_member',
  'The member has exactly the invite Role');
select is((select count(*)::int from public.audit_events where event_type in ('member.joined', 'invite.accepted')
           and actor_id = 'f1000000-0000-4000-8000-000000000002'), 2, 'member.joined and invite.accepted are audited');
select is((select count(*)::int from public.feed_items where kind = 'member_joined' and recipient_member_id is null), 1,
  'One member_joined Feed_Item');
select is((select count(*)::int from public.feed_items where kind = 'member_joined' and recipient_member_id is not null), 1,
  'One reminder per other active primary caregiver');
select is(public.accept_invite(decode(repeat('a1', 32), 'hex'), 'f1000000-0000-4000-8000-000000000003', 'Cy'),
  '{"outcome": "unusable"}'::jsonb, 'A used invite is unusable');
select is(public.preview_invite(decode(repeat('a1', 32), 'hex')), '{"outcome": "unusable"}'::jsonb,
  'A used invite previews as unusable');

-- expiry --------------------------------------------------------------------------------
reset role;
insert into public.household_invites (household_id, role, token_hash, created_by_member_id, created_at, expires_at)
select household_id, 'family_member', decode(repeat('b1', 32), 'hex'), id, now() - interval '8 days', now() - interval '1 day'
from public.household_members where user_id = 'f1000000-0000-4000-8000-000000000001';
set local role service_role;
select is(public.accept_invite(decode(repeat('b1', 32), 'hex'), 'f1000000-0000-4000-8000-000000000003', 'Cy'),
  '{"outcome": "unusable"}'::jsonb, 'An expired invite is unusable');
select is((select state from public.household_invites where token_hash = decode(repeat('b1', 32), 'hex')), 'expired',
  'Accepting after expiry marks the invite expired');
select is((select count(*)::int from public.audit_events where event_type = 'invite.expired' and actor_type = 'system'), 1,
  'One system invite.expired event');
select is(public.preview_invite(decode(repeat('b1', 32), 'hex')), '{"outcome": "unusable"}'::jsonb,
  'Expiry is audited exactly once (a later preview adds nothing)');
select is((select count(*)::int from public.audit_events where event_type = 'invite.expired'), 1,
  'Still one invite.expired event');

-- revoke and cap --------------------------------------------------------------------------
select is((public.revoke_invite((select (r ->> 'household_id')::uuid from h1), (select (r ->> 'invite_id')::uuid from i1),
  'f1000000-0000-4000-8000-000000000001')), jsonb_build_object('outcome', 'not_pending', 'state', 'accepted'),
  'Revoking a used invite returns not_pending with the state');
create temp table i2 as
  select public.create_invite((select (r ->> 'household_id')::uuid from h1),
    'f1000000-0000-4000-8000-000000000001', 'care_recipient', decode(repeat('c1', 32), 'hex')) as r;
grant select on i2 to service_role;
select is((public.revoke_invite((select (r ->> 'household_id')::uuid from h1), (select (r ->> 'invite_id')::uuid from i2),
  'f1000000-0000-4000-8000-000000000001')) ->> 'outcome', 'revoked', 'A pending invite is revoked');
select is(public.preview_invite(decode(repeat('c1', 32), 'hex')), '{"outcome": "unusable"}'::jsonb, 'A revoked invite is unusable');
select throws_ok($$ select public.revoke_invite((select (r ->> 'household_id')::uuid from h1), (select (r ->> 'invite_id')::uuid from i2),
  'f1000000-0000-4000-8000-000000000002') $$, 'P0001', 'not_primary_caregiver', 'A non-primary cannot revoke');
select lives_ok($$ select public.create_invite((select (r ->> 'household_id')::uuid from h1), 'f1000000-0000-4000-8000-000000000001',
  'family_member', sha256(('cap' || n)::bytea)) from generate_series(1, 20) n $$, 'Twenty pending invites can be created');
select throws_ok($$ select public.create_invite((select (r ->> 'household_id')::uuid from h1), 'f1000000-0000-4000-8000-000000000001',
  'family_member', sha256('cap21'::bytea)) $$, 'P0001', 'invite_cap_reached', 'The 21st pending invite is refused');

-- roles, last primary, rename, one household ----------------------------------------------
select throws_ok($$ select public.change_member_role((select (r ->> 'household_id')::uuid from h1), (select (r ->> 'member_id')::uuid from h1),
  'f1000000-0000-4000-8000-000000000001', 'family_member') $$, 'P0001', 'last_primary_caregiver',
  'The only primary cannot be demoted');
select is((public.change_member_role((select (r ->> 'household_id')::uuid from h1), (select (r ->> 'member_id')::uuid from a1 ),
  'f1000000-0000-4000-8000-000000000001', 'primary_caregiver')) ->> 'outcome', 'role_changed', 'A primary promotes a member');

select * from finish();
rollback;
