-- Fudepan Care Chain: row-level security (Phase 1).
--
-- Access model for this phase:
--   * anon: no access to any care table.
--   * authenticated: may READ rows of households where they are an active member.
--     No client-side writes. Care data changes must go through server code
--     (Route Handlers / Server Actions) that checks authorization and records an
--     audit event for every change. Later phases add narrowly scoped write
--     policies or functions where a feature needs them.
--   * service_role: server-only key, bypasses RLS. Never exposed to the browser.
--   * audit_events: no update or delete grants for any client role.

-- ---------------------------------------------------------------------------
-- Membership helper
-- ---------------------------------------------------------------------------
-- security definer so policies can read household_members without recursing
-- into household_members' own policy. Lives in the unexposed `private` schema.
create function private.current_user_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.household_id
  from public.household_members m
  where m.user_id = (select auth.uid())
    and m.is_active;
$$;

revoke all on function private.current_user_household_ids() from public;
grant usage on schema private to authenticated;
grant execute on function private.current_user_household_ids() to authenticated;

-- ---------------------------------------------------------------------------
-- Table privileges (defense in depth alongside RLS)
-- ---------------------------------------------------------------------------
revoke all on table
  public.households,
  public.household_members,
  public.notes,
  public.care_chains,
  public.care_steps,
  public.audit_events
from anon, authenticated;

grant select on table
  public.households,
  public.household_members,
  public.notes,
  public.care_chains,
  public.care_steps,
  public.audit_events
to authenticated;

grant all on table
  public.households,
  public.household_members,
  public.notes,
  public.care_chains,
  public.care_steps,
  public.audit_events
to service_role;

-- ---------------------------------------------------------------------------
-- Enable RLS
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.notes enable row level security;
alter table public.care_chains enable row level security;
alter table public.care_steps enable row level security;
alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Read policies: active members see only their own households' data
-- ---------------------------------------------------------------------------
create policy "Members can view their households"
  on public.households
  for select
  to authenticated
  using (id in (select private.current_user_household_ids()));

create policy "Members can view fellow household members"
  on public.household_members
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

create policy "Members can view household notes"
  on public.notes
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

create policy "Members can view household care chains"
  on public.care_chains
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));

create policy "Members can view household care steps"
  on public.care_steps
  for select
  to authenticated
  using (
    care_chain_id in (
      select c.id
      from public.care_chains c
      where c.household_id in (select private.current_user_household_ids())
    )
  );

create policy "Members can view household audit events"
  on public.audit_events
  for select
  to authenticated
  using (household_id in (select private.current_user_household_ids()));
