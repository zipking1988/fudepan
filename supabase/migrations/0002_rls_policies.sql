-- Fudepan Phase 1: Row Level Security. Every record is scoped by household membership.

create or replace function public.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = target_household and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.has_household_role(target_household uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = target_household
      and m.user_id = (select auth.uid())
      and m.role = any (allowed_roles)
  );
$$;

revoke all on function public.is_household_member(uuid) from public, anon;
revoke all on function public.has_household_role(uuid, text[]) from public, anon;
grant execute on function public.is_household_member(uuid) to authenticated;
grant execute on function public.has_household_role(uuid, text[]) to authenticated;

alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.notes enable row level security;
alter table public.tasks enable row level security;
alter table public.audit_events enable row level security;

alter table public.households force row level security;
alter table public.members force row level security;
alter table public.notes force row level security;
alter table public.tasks force row level security;
alter table public.audit_events force row level security;

-- households. Creation and first-member bootstrap happen through server-side code (Phase 4).
create policy households_select on public.households
  for select to authenticated
  using (public.is_household_member(id));

create policy households_update on public.households
  for update to authenticated
  using (public.has_household_role(id, array['coordinator']))
  with check (public.has_household_role(id, array['coordinator']));

-- members. Only coordinators manage membership. Members cannot be deleted from the client.
create policy members_select on public.members
  for select to authenticated
  using (public.is_household_member(household_id));

create policy members_insert on public.members
  for insert to authenticated
  with check (public.has_household_role(household_id, array['coordinator']));

create policy members_update on public.members
  for update to authenticated
  using (public.has_household_role(household_id, array['coordinator']) or user_id = (select auth.uid()))
  with check (public.has_household_role(household_id, array['coordinator']) or user_id = (select auth.uid()));

-- notes. No update or delete from clients.
create policy notes_select on public.notes
  for select to authenticated
  using (public.is_household_member(household_id));

create policy notes_insert on public.notes
  for insert to authenticated
  with check (
    public.is_household_member(household_id) and created_by = (select auth.uid())
  );

-- tasks. No delete policy: cancellation is a status change.
create policy tasks_select on public.tasks
  for select to authenticated
  using (public.is_household_member(household_id));

create policy tasks_insert on public.tasks
  for insert to authenticated
  with check (public.is_household_member(household_id));

create policy tasks_update on public.tasks
  for update to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));

-- audit_events. Append-only for clients: select and insert only.
create policy audit_events_select on public.audit_events
  for select to authenticated
  using (public.is_household_member(household_id));

create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (
    public.is_household_member(household_id) and actor_id = (select auth.uid())
  );

-- Defense in depth: strip privileges that RLS policies already do not grant.
revoke all on public.households, public.members, public.notes, public.tasks, public.audit_events
  from anon;
revoke delete, truncate on public.households, public.members, public.notes, public.tasks,
  public.audit_events from authenticated;
revoke update, truncate on public.audit_events from authenticated;
revoke insert on public.households from authenticated;

-- Column-level limits prevent privilege escalation. Role changes, household reassignment and
-- ownership changes go through server-side code only.
revoke update on public.members from authenticated;
grant update (display_name, reminders_enabled) on public.members to authenticated;
revoke update on public.households from authenticated;
grant update (name) on public.households to authenticated;
