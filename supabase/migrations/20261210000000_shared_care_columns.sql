-- Family shared care, migration 1: columns and constraints.
--
-- Additive only. Every new column is nullable or has a constant default, and
-- every new constraint is satisfied by existing rows (all new columns start
-- null; plan_version starts at 0). No existing row is rewritten.
--
-- approval_state stays null for existing rows: null means "legacy row, derive on
-- read" (Requirement 18.6). due_at and escalation_at are untouched (legacy,
-- read-only model output; Requirements 12.6, 12.7).

-- ---------------------------------------------------------------------------
-- care_steps: approval, people, times, facts
-- ---------------------------------------------------------------------------
alter table public.care_steps
  add column approval_state text,
  add column approval_decided_by uuid references public.household_members (id),
  add column approval_decided_at timestamptz,
  add column plan_version integer not null default 0,
  add column rejected_at_plan_version integer,
  add column driver_id uuid references public.household_members (id),
  add column companion_id uuid references public.household_members (id),
  add column respond_by_at timestamptz,
  add column respond_by_timezone text,
  add column respond_by_provenance text,
  add column respond_by_set_by uuid references public.household_members (id),
  add column task_due_at timestamptz,
  add column task_due_timezone text,
  add column task_due_provenance text,
  add column task_due_set_by uuid references public.household_members (id),
  add column person_to_ask text,
  add column suggested_role text,
  add column required_amount_minor bigint,
  add column amount_currency text;

alter table public.care_steps
  add constraint care_steps_approval_state_valid check (
    approval_state is null
    or approval_state in ('not_required', 'pending', 'approved', 'rejected')
  ),
  add constraint care_steps_approval_state_requires_approval check (
    approval_state is null or approval_required or approval_state = 'not_required'
  ),
  add constraint care_steps_approval_state_not_required_only_if_optional check (
    approval_state is null or not approval_required or approval_state <> 'not_required'
  ),
  add constraint care_steps_plan_version_non_negative check (plan_version >= 0),
  add constraint care_steps_rejected_plan_version_non_negative check (
    rejected_at_plan_version is null or rejected_at_plan_version >= 0
  ),
  -- Respond_By_Time: all fields null, or all set.
  add constraint care_steps_respond_by_all_or_none check (
    (respond_by_at is null and respond_by_timezone is null
       and respond_by_provenance is null and respond_by_set_by is null)
    or (respond_by_at is not null and respond_by_timezone is not null
       and respond_by_provenance is not null)
  ),
  add constraint care_steps_respond_by_provenance_valid check (
    respond_by_provenance is null
    or respond_by_provenance in ('human_confirmed', 'model_suggested')
  ),
  add constraint care_steps_respond_by_set_by_required check (
    respond_by_provenance is distinct from 'human_confirmed' or respond_by_set_by is not null
  ),
  -- Task_Due_Time: same rules.
  add constraint care_steps_task_due_all_or_none check (
    (task_due_at is null and task_due_timezone is null
       and task_due_provenance is null and task_due_set_by is null)
    or (task_due_at is not null and task_due_timezone is not null
       and task_due_provenance is not null)
  ),
  add constraint care_steps_task_due_provenance_valid check (
    task_due_provenance is null
    or task_due_provenance in ('human_confirmed', 'model_suggested')
  ),
  add constraint care_steps_task_due_set_by_required check (
    task_due_provenance is distinct from 'human_confirmed' or task_due_set_by is not null
  ),
  add constraint care_steps_person_to_ask_length check (
    person_to_ask is null or length(person_to_ask) between 1 and 100
  ),
  add constraint care_steps_suggested_role_length check (
    suggested_role is null or length(suggested_role) <= 100
  ),
  add constraint care_steps_required_amount_non_negative check (
    required_amount_minor is null or required_amount_minor >= 0
  ),
  add constraint care_steps_amount_currency_format check (
    amount_currency is null or amount_currency ~ '^[A-Z]{3}$'
  ),
  add constraint care_steps_amount_and_currency_together check (
    (required_amount_minor is null) = (amount_currency is null)
  );

create index care_steps_driver_id_idx on public.care_steps (driver_id);
create index care_steps_companion_id_idx on public.care_steps (companion_id);

-- ---------------------------------------------------------------------------
-- audit_events.note_id (same-household link to the note)
-- ---------------------------------------------------------------------------
alter table public.audit_events
  add column note_id uuid;

-- MATCH SIMPLE: rows with a null note_id are not checked, so existing rows pass.
alter table public.audit_events
  add constraint audit_events_note_same_household
  foreign key (note_id, household_id) references public.notes (id, household_id);

create index audit_events_note_created_idx on public.audit_events (note_id, created_at);

-- ---------------------------------------------------------------------------
-- household_members.ui_language
-- ---------------------------------------------------------------------------
alter table public.household_members
  add column ui_language text;

alter table public.household_members
  add constraint household_members_ui_language_valid check (
    ui_language is null or ui_language in ('en', 'ja')
  );

-- ---------------------------------------------------------------------------
-- Owners, backups, drivers and companions must be active household members.
-- ---------------------------------------------------------------------------
create or replace function private.assert_care_step_owners_in_household()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  chain_household_id uuid;
  candidate uuid;
begin
  if new.owner_id is null
     and new.backup_owner_id is null
     and new.driver_id is null
     and new.companion_id is null then
    return new;
  end if;

  select c.household_id into chain_household_id
  from public.care_chains c
  where c.id = new.care_chain_id;

  foreach candidate in array array_remove(
    array[new.owner_id, new.backup_owner_id, new.driver_id, new.companion_id],
    null
  ) loop
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

drop trigger care_steps_owners_in_household on public.care_steps;

create trigger care_steps_owners_in_household
  before insert or update of owner_id, backup_owner_id, driver_id, companion_id, care_chain_id
  on public.care_steps
  for each row execute function private.assert_care_step_owners_in_household();

revoke all on function private.assert_care_step_owners_in_household() from public;
