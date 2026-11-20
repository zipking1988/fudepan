-- Fudepan Phase 4: invitations, membership functions, and household-level audit event types.
-- All functions here run with the service role only (server-side API routes). They re-check the
-- actor's role in SQL. Members and households can no longer be created from the browser.

-- 1. Allow household-level audit events.
alter table public.audit_events drop constraint audit_events_event_type_check;
alter table public.audit_events add constraint audit_events_event_type_check check (event_type in (
  'note_created', 'task_extracted', 'task_updated', 'task_confirmation_requested',
  'task_approved', 'task_rejected', 'task_completed', 'task_cancelled',
  'calendar_event_created', 'notification_sent',
  'household_created', 'member_joined', 'member_role_changed', 'invitation_revoked'
));

-- 2. Members can only be created by the functions below.
drop policy members_insert on public.members;
revoke insert on public.members from authenticated;

-- 3. Invitations. The raw token is never stored, only its SHA-256 hash.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  role text not null check (role in ('elder', 'caregiver', 'coordinator')),
  invited_email text check (invited_email is null or char_length(invited_email) <= 254),
  token_hash text not null unique check (char_length(token_hash) = 64),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  created_by uuid not null references auth.users (id),
  expires_at timestamptz not null,
  used_by uuid references auth.users (id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_household_idx on public.invitations (household_id, created_at desc);

alter table public.invitations enable row level security;
alter table public.invitations force row level security;

create policy invitations_select on public.invitations
  for select to authenticated
  using (public.has_household_role(household_id, array['coordinator']));

-- Coordinators can list invitations but never read token hashes. No client writes.
revoke all on public.invitations from anon, authenticated;
grant select (id, household_id, role, invited_email, status, created_by, expires_at, used_at, created_at)
  on public.invitations to authenticated;

-- 4. Functions.
create or replace function public.create_household(p_user_id uuid, p_name text, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  if p_name is null or char_length(trim(p_name)) not between 1 and 100 then
    raise exception 'invalid_name';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 100 then
    raise exception 'invalid_name';
  end if;
  if (select count(*) from public.households where created_by = p_user_id) >= 10 then
    raise exception 'too_many_households';
  end if;

  insert into public.households (name, created_by) values (trim(p_name), p_user_id)
  returning id into v_household;

  insert into public.members (household_id, user_id, display_name, role)
  values (v_household, p_user_id, trim(p_display_name), 'coordinator');

  insert into public.audit_events (household_id, actor_id, event_type, payload)
  values (v_household, p_user_id, 'household_created', '{}'::jsonb);

  return v_household;
end;
$$;

create or replace function public.create_invitation(
  p_actor uuid, p_household_id uuid, p_role text, p_email text, p_token_hash text, p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from public.members
    where household_id = p_household_id and user_id = p_actor and role = 'coordinator'
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.invitations (household_id, role, invited_email, token_hash, created_by, expires_at)
  values (p_household_id, p_role, nullif(lower(trim(p_email)), ''), p_token_hash, p_actor, p_expires_at)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.accept_invitation(
  p_user_id uuid, p_email text, p_token_hash text, p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
begin
  if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 100 then
    raise exception 'invalid_name';
  end if;

  select * into v_inv from public.invitations where token_hash = p_token_hash for update;
  if not found or v_inv.status <> 'pending' or v_inv.expires_at <= now() then
    raise exception 'invalid_invitation';
  end if;
  if v_inv.invited_email is not null and lower(coalesce(p_email, '')) <> v_inv.invited_email then
    raise exception 'invalid_invitation';
  end if;
  if exists (
    select 1 from public.members where household_id = v_inv.household_id and user_id = p_user_id
  ) then
    raise exception 'already_member';
  end if;

  insert into public.members (household_id, user_id, display_name, role)
  values (v_inv.household_id, p_user_id, trim(p_display_name), v_inv.role);

  update public.invitations
    set status = 'accepted', used_by = p_user_id, used_at = now()
    where id = v_inv.id;

  insert into public.audit_events (household_id, actor_id, event_type, payload)
  values (
    v_inv.household_id, p_user_id, 'member_joined',
    jsonb_build_object('role', v_inv.role, 'invitation_id', v_inv.id, 'invited_by', v_inv.created_by)
  );
  return v_inv.household_id;
end;
$$;

create or replace function public.revoke_invitation(p_actor uuid, p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
begin
  select * into v_inv from public.invitations where id = p_invitation_id for update;
  if not found then
    raise exception 'invalid_invitation';
  end if;
  if not exists (
    select 1 from public.members
    where household_id = v_inv.household_id and user_id = p_actor and role = 'coordinator'
  ) then
    raise exception 'forbidden';
  end if;
  if v_inv.status <> 'pending' then
    raise exception 'invalid_invitation';
  end if;

  update public.invitations set status = 'revoked' where id = v_inv.id;
  insert into public.audit_events (household_id, actor_id, event_type, payload)
  values (v_inv.household_id, p_actor, 'invitation_revoked', jsonb_build_object('invitation_id', v_inv.id));
end;
$$;

create or replace function public.set_member_role(p_actor uuid, p_member_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.members%rowtype;
  v_coordinators integer;
begin
  if p_role not in ('elder', 'caregiver', 'coordinator') then
    raise exception 'invalid_role';
  end if;
  select * into v_target from public.members where id = p_member_id for update;
  if not found then
    raise exception 'member_not_found';
  end if;
  if not exists (
    select 1 from public.members
    where household_id = v_target.household_id and user_id = p_actor and role = 'coordinator'
  ) then
    raise exception 'forbidden';
  end if;

  if v_target.role = 'coordinator' and p_role <> 'coordinator' then
    select count(*) into v_coordinators from public.members
      where household_id = v_target.household_id and role = 'coordinator';
    if v_coordinators <= 1 then
      raise exception 'last_coordinator';
    end if;
  end if;

  if v_target.role <> p_role then
    update public.members set role = p_role where id = v_target.id;
    insert into public.audit_events (household_id, actor_id, event_type, payload)
    values (
      v_target.household_id, p_actor, 'member_role_changed',
      jsonb_build_object('member_id', v_target.id, 'from', v_target.role, 'to', p_role)
    );
  end if;
end;
$$;

revoke all on function public.create_household(uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_invitation(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.accept_invitation(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.revoke_invitation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_household(uuid, text, text) to service_role;
grant execute on function public.create_invitation(uuid, uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.accept_invitation(uuid, text, text, text) to service_role;
grant execute on function public.revoke_invitation(uuid, uuid) to service_role;
grant execute on function public.set_member_role(uuid, uuid, text) to service_role;
