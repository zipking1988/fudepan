-- Fudepan Care Chain: foundation schema (Phase 1).
--
-- Tables follow .kiro/specs/fudepan-care-chain/design.md. Additions beyond the
-- design are limited to integrity rules the spec already requires:
--   * check constraints for the documented vocabularies (roles, risk levels,
--     care categories, state machine statuses);
--   * high-risk steps must have approval_required = true;
--   * composite foreign keys so a chain, step, or audit event can never point
--     at a record from another household;
--   * care_steps.audit_event_id, which requirements.md lists as a required
--     step field but the design table omits.
--
-- No delete cascades: deleting care records must be an explicit, audited action.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- households
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  constraint households_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.households is
  'A family unit that shares care responsibilities. All care data is scoped to one household.';

-- ---------------------------------------------------------------------------
-- household_members
-- ---------------------------------------------------------------------------
create table public.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  user_id uuid not null references auth.users (id),
  display_name text not null,
  role text not null,
  responsibilities text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint household_members_display_name_not_blank check (length(btrim(display_name)) > 0),
  constraint household_members_role_valid check (
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
  constraint household_members_one_membership_per_user unique (household_id, user_id),
  -- Target for composite foreign keys that keep data inside one household.
  constraint household_members_id_household_unique unique (id, household_id)
);

create index household_members_user_id_idx on public.household_members (user_id);

comment on table public.household_members is
  'People who share responsibility for a household. Access to household data requires an active membership.';

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  uploaded_by uuid not null references auth.users (id),
  -- Supabase Storage object path. Never a public URL.
  image_path text not null,
  original_text text,
  status text not null default 'uploaded',
  created_at timestamptz not null default now(),
  constraint notes_image_path_not_blank check (length(btrim(image_path)) > 0),
  constraint notes_status_valid check (
    status in ('uploaded', 'extracting', 'extraction_failed', 'pending_review')
  ),
  constraint notes_id_household_unique unique (id, household_id)
);

create index notes_household_id_idx on public.notes (household_id);
create index notes_uploaded_by_idx on public.notes (uploaded_by);

comment on table public.notes is
  'A photographed handwritten note. The image lives in Supabase Storage; only its path is stored here.';

-- ---------------------------------------------------------------------------
-- care_chains
-- ---------------------------------------------------------------------------
create table public.care_chains (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  note_id uuid not null,
  title text not null,
  status text not null default 'pending_review',
  risk_level text not null,
  created_by_ai boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_chains_title_not_blank check (length(btrim(title)) > 0),
  constraint care_chains_status_valid check (
    status in (
      'uploaded',
      'extracting',
      'extraction_failed',
      'pending_review',
      'needs_clarification',
      'pending_approval',
      'awaiting_owner_acceptance',
      'approved',
      'in_progress',
      'evidence_required',
      'completed',
      'failed',
      'escalated',
      'cancelled'
    )
  ),
  constraint care_chains_risk_level_valid check (risk_level in ('low', 'medium', 'high')),
  -- The note must belong to the same household as the chain.
  constraint care_chains_note_same_household
    foreign key (note_id, household_id) references public.notes (id, household_id),
  constraint care_chains_id_household_unique unique (id, household_id)
);

create index care_chains_household_id_idx on public.care_chains (household_id);
create index care_chains_note_id_idx on public.care_chains (note_id);

comment on table public.care_chains is
  'A group of related care steps derived from one note.';

-- ---------------------------------------------------------------------------
-- care_steps
-- ---------------------------------------------------------------------------
create table public.care_steps (
  id uuid primary key default gen_random_uuid(),
  care_chain_id uuid not null references public.care_chains (id),
  title text not null,
  description text,
  care_category text not null,
  risk_level text not null,
  owner_id uuid references public.household_members (id),
  backup_owner_id uuid references public.household_members (id),
  due_at timestamptz,
  escalation_at timestamptz,
  status text not null default 'pending_review',
  evidence_required text[] not null default '{}',
  approval_required boolean not null default false,
  source_quote text,
  confidence numeric,
  -- Audit event that created this step. Foreign key added after audit_events exists.
  audit_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint care_steps_title_not_blank check (length(btrim(title)) > 0),
  constraint care_steps_care_category_valid check (
    care_category in (
      'medical',
      'medication',
      'appointment',
      'payment',
      'transport',
      'document',
      'household',
      'communication'
    )
  ),
  constraint care_steps_risk_level_valid check (risk_level in ('low', 'medium', 'high')),
  constraint care_steps_status_valid check (
    status in (
      'uploaded',
      'extracting',
      'extraction_failed',
      'pending_review',
      'needs_clarification',
      'pending_approval',
      'awaiting_owner_acceptance',
      'approved',
      'in_progress',
      'evidence_required',
      'completed',
      'failed',
      'escalated',
      'cancelled'
    )
  ),
  -- Safety policy: a high-risk step can never skip human approval.
  constraint care_steps_high_risk_requires_approval check (risk_level <> 'high' or approval_required),
  constraint care_steps_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint care_steps_backup_differs_from_owner check (
    owner_id is null or backup_owner_id is null or owner_id <> backup_owner_id
  ),
  constraint care_steps_id_chain_unique unique (id, care_chain_id)
);

create index care_steps_care_chain_id_idx on public.care_steps (care_chain_id);
create index care_steps_owner_id_idx on public.care_steps (owner_id);
create index care_steps_backup_owner_id_idx on public.care_steps (backup_owner_id);

comment on table public.care_steps is
  'One care action inside a Care Chain. High-risk steps always require human approval.';

-- ---------------------------------------------------------------------------
-- audit_events
-- ---------------------------------------------------------------------------
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  care_chain_id uuid,
  care_step_id uuid,
  actor_type text not null,
  actor_id uuid,
  event_type text not null,
  -- Must not contain raw sensitive content; mask before writing.
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint audit_events_actor_type_valid check (
    actor_type in ('human', 'ai', 'system', 'mcp', 'crew')
  ),
  constraint audit_events_human_actor_identified check (actor_type <> 'human' or actor_id is not null),
  constraint audit_events_event_type_format check (event_type ~ '^[a-z][a-z0-9_.]*$'),
  constraint audit_events_payload_is_object check (jsonb_typeof(payload) = 'object'),
  constraint audit_events_step_requires_chain check (care_step_id is null or care_chain_id is not null),
  -- The chain must belong to the event's household, and the step to the chain.
  constraint audit_events_chain_same_household
    foreign key (care_chain_id, household_id) references public.care_chains (id, household_id),
  constraint audit_events_step_same_chain
    foreign key (care_step_id, care_chain_id) references public.care_steps (id, care_chain_id)
);

create index audit_events_household_created_idx on public.audit_events (household_id, created_at);
create index audit_events_care_chain_created_idx on public.audit_events (care_chain_id, created_at);
create index audit_events_care_step_id_idx on public.audit_events (care_step_id);

comment on table public.audit_events is
  'Append-only history of every important state change. Clients may read but never modify it.';

alter table public.care_steps
  add constraint care_steps_audit_event_id_fkey
  foreign key (audit_event_id) references public.audit_events (id);

create index care_steps_audit_event_id_idx on public.care_steps (audit_event_id);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger care_chains_set_updated_at
  before update on public.care_chains
  for each row execute function private.set_updated_at();

create trigger care_steps_set_updated_at
  before update on public.care_steps
  for each row execute function private.set_updated_at();

-- Owners must be active members of the household that owns the chain.
-- Enforced in the database so no code path can assign someone from another household.
create function private.assert_care_step_owners_in_household()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  chain_household_id uuid;
  candidate uuid;
begin
  if new.owner_id is null and new.backup_owner_id is null then
    return new;
  end if;

  select c.household_id into chain_household_id
  from public.care_chains c
  where c.id = new.care_chain_id;

  foreach candidate in array array_remove(array[new.owner_id, new.backup_owner_id], null) loop
    if not exists (
      select 1
      from public.household_members m
      where m.id = candidate
        and m.household_id = chain_household_id
        and m.is_active
    ) then
      raise exception 'Care step owner must be an active member of the care chain household'
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

create trigger care_steps_owners_in_household
  before insert or update of owner_id, backup_owner_id, care_chain_id on public.care_steps
  for each row execute function private.assert_care_step_owners_in_household();

revoke all on function private.set_updated_at() from public;
revoke all on function private.assert_care_step_owners_in_household() from public;
