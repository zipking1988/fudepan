-- Demo household seed for LOCAL DEVELOPMENT ONLY.
--
-- Runs automatically after migrations on `supabase db reset`. Never run it
-- against a hosted project (do not use `supabase db push --include-seed`):
-- the demo password below is public.
--
-- All people are fictional. Only first names are stored, and emails use the
-- reserved example.com domain. Every demo user signs in with the local-only
-- password `fudepan-demo`; they can only ever see the fictional demo household.

-- ---------------------------------------------------------------------------
-- Auth users (required by household_members.user_id)
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('fudepan-demo', extensions.gen_salt('bf')),
  now(),
  '{"provider": "email", "providers": ["email"]}'::jsonb,
  '{"demo": true}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    ('d1000000-0000-4000-8000-000000000001'::uuid, 'haruko.demo@example.com'),
    ('d1000000-0000-4000-8000-000000000002'::uuid, 'misa.demo@example.com'),
    ('d1000000-0000-4000-8000-000000000003'::uuid, 'kenta.demo@example.com'),
    ('d1000000-0000-4000-8000-000000000004'::uuid, 'yui.demo@example.com'),
    ('d1000000-0000-4000-8000-000000000005'::uuid, 'aiko.demo@example.com')
) as u (id, email)
on conflict (id) do nothing;

-- Email identities, required for password sign-in.
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  'd1000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000004',
  'd1000000-0000-4000-8000-000000000005'
)
on conflict (provider_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- Household and members
-- ---------------------------------------------------------------------------
insert into public.households (id, name)
values ('d0000000-0000-4000-8000-000000000001', 'Demo household')
on conflict (id) do nothing;

insert into public.household_members (id, household_id, user_id, display_name, role, responsibilities)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'Haruko (Mom)',
    'care_recipient',
    '{}'
  ),
  (
    'd2000000-0000-4000-8000-000000000002',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000002',
    'Misa',
    'primary_caregiver',
    '{medical,appointment,medication}'
  ),
  (
    'd2000000-0000-4000-8000-000000000003',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000003',
    'Kenta',
    'finance_coordinator',
    '{payment,document}'
  ),
  (
    'd2000000-0000-4000-8000-000000000004',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000004',
    'Yui',
    'transport_coordinator',
    '{transport}'
  ),
  (
    'd2000000-0000-4000-8000-000000000005',
    'd0000000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000005',
    'Aiko (home helper)',
    'professional_caregiver',
    '{household}'
  )
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Audit trail for the seeded state. Payloads hold IDs and roles, never names.
-- ---------------------------------------------------------------------------
insert into public.audit_events (household_id, actor_type, event_type, payload)
select
  'd0000000-0000-4000-8000-000000000001',
  'system',
  e.event_type,
  e.payload
from (
  values
    ('household.created', '{"source": "seed"}'::jsonb),
    ('household.member_added', '{"source": "seed", "member_id": "d2000000-0000-4000-8000-000000000001", "role": "care_recipient"}'::jsonb),
    ('household.member_added', '{"source": "seed", "member_id": "d2000000-0000-4000-8000-000000000002", "role": "primary_caregiver"}'::jsonb),
    ('household.member_added', '{"source": "seed", "member_id": "d2000000-0000-4000-8000-000000000003", "role": "finance_coordinator"}'::jsonb),
    ('household.member_added', '{"source": "seed", "member_id": "d2000000-0000-4000-8000-000000000004", "role": "transport_coordinator"}'::jsonb),
    ('household.member_added', '{"source": "seed", "member_id": "d2000000-0000-4000-8000-000000000005", "role": "professional_caregiver"}'::jsonb)
) as e (event_type, payload)
where not exists (
  select 1
  from public.audit_events a
  where a.household_id = 'd0000000-0000-4000-8000-000000000001'
    and a.payload ->> 'source' = 'seed'
);
