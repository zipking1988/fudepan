-- Family app demo parity, migration 1: household invites.
--
-- Additive only: one new table. The raw Invite_Token never reaches Postgres;
-- only its sha256 (32 bytes) is stored. The table is reachable only through the
-- service-role membership functions (RLS on, no policy, no client grants).
--
-- Expiry is exactly 7 days (168 hours, DST-independent) after creation.

create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  role text not null,
  token_hash bytea not null,
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  state text not null default 'pending',
  accepted_by_user_id uuid references auth.users (id),
  accepted_member_id uuid,
  accepted_at timestamptz,
  revoked_by_member_id uuid,
  revoked_at timestamptz,
  expired_at timestamptz,
  constraint household_invites_token_hash_len check (octet_length(token_hash) = 32),
  constraint household_invites_token_hash_unique unique (token_hash),
  constraint household_invites_role_valid check (
    role in (
      'care_recipient',
      'primary_caregiver',
      'family_member',
      'medical_coordinator',
      'finance_coordinator',
      'transport_coordinator',
      'emergency_contact',
      'professional_caregiver'
    )
  ),
  constraint household_invites_state_valid check (state in ('pending', 'accepted', 'revoked', 'expired')),
  constraint household_invites_ttl check (expires_at = created_at + interval '168 hours'),
  constraint household_invites_accepted_fields check (
    (state = 'accepted')
    = (accepted_at is not null and accepted_by_user_id is not null and accepted_member_id is not null)
  ),
  constraint household_invites_revoked_fields check ((state = 'revoked') = (revoked_at is not null)),
  constraint household_invites_expired_fields check ((state = 'expired') = (expired_at is not null)),
  constraint household_invites_creator_same_household
    foreign key (created_by_member_id, household_id)
    references public.household_members (id, household_id),
  constraint household_invites_accepted_member_same_household
    foreign key (accepted_member_id, household_id)
    references public.household_members (id, household_id),
  constraint household_invites_revoker_same_household
    foreign key (revoked_by_member_id, household_id)
    references public.household_members (id, household_id)
);

create index household_invites_household_idx
  on public.household_invites (household_id, created_at desc);
create index household_invites_pending_idx
  on public.household_invites (household_id, expires_at) where state = 'pending';

alter table public.household_invites enable row level security;
-- No policy: no client role can read or write a row.

revoke all on table public.household_invites from public, anon, authenticated;
grant all on table public.household_invites to service_role;

-- Defense in depth: membership changes happen only through service-role functions.
revoke insert, update, delete, truncate
  on table public.households, public.household_members from anon, authenticated;

comment on table public.household_invites is
  'Single-use household invites. Stores only sha256(token). Service role only; no client grants.';
