-- Family app demo parity, migration 3: membership functions.
--
-- Public functions (security definer, `set search_path = ''`, owned by the
-- migration role, executable only by service_role). The caller passes the
-- verified p_user_id from the session. Each function returns a jsonb outcome or
-- raises P0001 with a bare refusal code as the message; a raise rolls back the
-- whole transaction. Outcomes that must commit (expiry, not_pending, unusable)
-- are returned, not raised.
--
-- Behavior, check order, audit event types, and payloads match
-- src/lib/membership/model.ts. Audit payloads hold UUIDs, Role codes, state
-- codes, and reason codes only. Raw Invite_Tokens never reach Postgres.
-- Lock order: user advisory lock -> invite row -> household member rows ->
-- care_steps by id -> care_requests.

-- 1 to 40 characters after trimming whitespace, else null.
create function private.clean_display_name(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := regexp_replace(coalesce(p_value, ''), '^\s+|\s+$', '', 'g');
begin
  if char_length(v_name) between 1 and 40 then
    return v_name;
  end if;
  return null;
end;
$$;

create function private.is_household_role(p_role text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_role in (
    'care_recipient', 'primary_caregiver', 'family_member', 'medical_coordinator',
    'finance_coordinator', 'transport_coordinator', 'emergency_contact', 'professional_caregiver'
  );
$$;

-- Same advisory lock key for create_household and accept_invite.
create function private.lock_user_membership(p_user_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('fudepan.membership:' || p_user_id::text, 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- create_household
-- ---------------------------------------------------------------------------
create function public.create_household(
  p_user_id uuid,
  p_household_name text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household_name text := private.clean_display_name(p_household_name);
  v_display_name text := private.clean_display_name(p_display_name);
  v_household_id uuid;
  v_member_id uuid;
begin
  if p_user_id is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  perform private.lock_user_membership(p_user_id);
  if exists (
    select 1 from public.household_members m where m.user_id = p_user_id and m.is_active
  ) then
    raise exception 'already_in_household' using errcode = 'P0001';
  end if;
  if v_household_name is null or v_display_name is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  insert into public.households (name) values (v_household_name) returning id into v_household_id;
  insert into public.household_members (household_id, user_id, display_name, role, is_active)
  values (v_household_id, p_user_id, v_display_name, 'primary_caregiver', true)
  returning id into v_member_id;

  perform private.write_audit(
    v_household_id, null, null, null, 'human', p_user_id, 'household.created',
    jsonb_build_object('household_id', v_household_id)
  );
  perform private.write_audit(
    v_household_id, null, null, null, 'human', p_user_id, 'member.joined',
    jsonb_build_object('member_id', v_member_id, 'role', 'primary_caregiver')
  );

  return jsonb_build_object(
    'outcome', 'created', 'household_id', v_household_id, 'member_id', v_member_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- create_invite
-- ---------------------------------------------------------------------------
create function public.create_invite(
  p_household_id uuid,
  p_user_id uuid,
  p_role text,
  p_token_hash bytea
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_now timestamptz := now();
  v_pending integer;
  v_invite_id uuid;
  v_expires_at timestamptz := v_now + interval '168 hours';
begin
  -- Serializes invite creation per household (cap check).
  perform 1 from public.households h where h.id = p_household_id for update;
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;
  if p_role is null or not private.is_household_role(p_role)
     or p_token_hash is null or octet_length(p_token_hash) <> 32 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  perform private.expire_overdue_invites(p_household_id);
  select count(*)::integer into v_pending
  from public.household_invites i
  where i.household_id = p_household_id and i.state = 'pending';
  if v_pending >= 20 then
    raise exception 'invite_cap_reached' using errcode = 'P0001';
  end if;

  insert into public.household_invites (
    household_id, role, token_hash, created_by_member_id, created_at, expires_at
  )
  values (p_household_id, p_role, p_token_hash, v_actor.id, v_now, v_expires_at)
  returning id into v_invite_id;

  perform private.write_audit(
    p_household_id, null, null, null, 'human', p_user_id, 'invite.created',
    jsonb_build_object('invite_id', v_invite_id, 'role', p_role)
  );

  return jsonb_build_object(
    'outcome', 'created', 'invite_id', v_invite_id, 'expires_at', private.iso_utc(v_expires_at)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- list_invites (never returns token_hash)
-- ---------------------------------------------------------------------------
create function public.list_invites(p_household_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_rows jsonb;
begin
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;

  perform private.expire_overdue_invites(p_household_id);
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', i.id,
      'role', i.role,
      'creator_member_id', i.created_by_member_id,
      'created_at', private.iso_utc(i.created_at),
      'expires_at', private.iso_utc(i.expires_at),
      'state', i.state
    ) order by i.created_at desc, i.id desc
  ), '[]'::jsonb) into v_rows
  from public.household_invites i
  where i.household_id = p_household_id;

  return jsonb_build_object('outcome', 'listed', 'invites', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- revoke_invite
-- ---------------------------------------------------------------------------
create function public.revoke_invite(
  p_household_id uuid,
  p_invite_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_invite public.household_invites;
begin
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;

  perform private.expire_overdue_invites(p_household_id);
  select i.* into v_invite
  from public.household_invites i
  where i.id = p_invite_id and i.household_id = p_household_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_invite.state <> 'pending' then
    return jsonb_build_object('outcome', 'not_pending', 'state', v_invite.state);
  end if;

  update public.household_invites
  set state = 'revoked', revoked_at = now(), revoked_by_member_id = v_actor.id
  where id = v_invite.id;

  perform private.write_audit(
    p_household_id, null, null, null, 'human', p_user_id, 'invite.revoked',
    jsonb_build_object('invite_id', v_invite.id, 'role', v_invite.role)
  );
  return jsonb_build_object('outcome', 'revoked');
end;
$$;

-- ---------------------------------------------------------------------------
-- preview_invite: unknown, used, revoked, and expired links look identical
-- ---------------------------------------------------------------------------
create function public.preview_invite(p_token_hash bytea)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_household_name text;
  v_creator_name text;
begin
  if p_token_hash is null then
    return jsonb_build_object('outcome', 'unusable');
  end if;
  select i.* into v_invite from public.household_invites i where i.token_hash = p_token_hash;
  if not found then
    return jsonb_build_object('outcome', 'unusable');
  end if;

  perform private.expire_overdue_invites(v_invite.household_id);
  select i.* into v_invite from public.household_invites i where i.id = v_invite.id;
  if v_invite.state <> 'pending' then
    return jsonb_build_object('outcome', 'unusable');
  end if;

  select h.name into v_household_name from public.households h where h.id = v_invite.household_id;
  select m.display_name into v_creator_name
  from public.household_members m where m.id = v_invite.created_by_member_id;

  return jsonb_build_object(
    'outcome', 'usable',
    'household_name', coalesce(v_household_name, ''),
    'creator_display_name', coalesce(v_creator_name, ''),
    'role', v_invite.role,
    'expires_at', private.iso_utc(v_invite.expires_at)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- accept_invite
-- ---------------------------------------------------------------------------
create function public.accept_invite(
  p_token_hash bytea,
  p_user_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.household_invites;
  v_own public.household_members;
  v_name text := private.clean_display_name(p_display_name);
  v_member_id uuid;
  v_audit_id uuid;
begin
  if p_user_id is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  perform private.lock_user_membership(p_user_id);

  select i.* into v_invite
  from public.household_invites i
  where i.token_hash = p_token_hash
  for update;
  if not found or v_invite.state <> 'pending' then
    return jsonb_build_object('outcome', 'unusable');
  end if;
  if v_invite.expires_at <= now() then
    update public.household_invites
    set state = 'expired', expired_at = now()
    where id = v_invite.id;
    perform private.write_audit(
      v_invite.household_id, null, null, null, 'system', null, 'invite.expired',
      jsonb_build_object('invite_id', v_invite.id, 'role', v_invite.role)
    );
    return jsonb_build_object('outcome', 'unusable');
  end if;

  select m.* into v_own
  from public.household_members m
  where m.household_id = v_invite.household_id and m.user_id = p_user_id
  for update;
  if found and v_own.is_active then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.household_members m where m.user_id = p_user_id and m.is_active
  ) then
    raise exception 'one_household_only' using errcode = 'P0001';
  end if;
  if v_name is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if v_own.id is not null then
    update public.household_members
    set is_active = true, role = v_invite.role, display_name = v_name
    where id = v_own.id;
    v_member_id := v_own.id;
    perform private.write_audit(
      v_invite.household_id, null, null, null, 'human', p_user_id, 'member.rejoined',
      jsonb_build_object('member_id', v_member_id, 'role', v_invite.role)
    );
  else
    insert into public.household_members (household_id, user_id, display_name, role, is_active)
    values (v_invite.household_id, p_user_id, v_name, v_invite.role, true)
    returning id into v_member_id;
    perform private.write_audit(
      v_invite.household_id, null, null, null, 'human', p_user_id, 'member.joined',
      jsonb_build_object('member_id', v_member_id, 'role', v_invite.role)
    );
  end if;

  update public.household_invites
  set state = 'accepted', accepted_at = now(), accepted_by_user_id = p_user_id,
      accepted_member_id = v_member_id
  where id = v_invite.id;
  v_audit_id := private.write_audit(
    v_invite.household_id, null, null, null, 'human', p_user_id, 'invite.accepted',
    jsonb_build_object('invite_id', v_invite.id, 'member_id', v_member_id, 'role', v_invite.role)
  );

  perform private.add_feed_item(
    v_invite.household_id, null, null, null, 'member_joined', v_member_id,
    jsonb_build_object('member_id', v_member_id, 'role', v_invite.role), v_audit_id
  );
  perform private.notify_primaries(
    v_invite.household_id, v_member_id, 'member_joined',
    jsonb_build_object('member_id', v_member_id, 'role', v_invite.role)
  );

  return jsonb_build_object('outcome', 'joined', 'role', v_invite.role, 'member_id', v_member_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- change_member_role
-- ---------------------------------------------------------------------------
create function public.change_member_role(
  p_household_id uuid,
  p_member_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_target public.household_members;
  v_audit_id uuid;
begin
  perform private.lock_active_members(p_household_id);
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;
  if p_role is null or not private.is_household_role(p_role) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  select m.* into v_target
  from public.household_members m
  where m.id = p_member_id and m.household_id = p_household_id and m.is_active;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_target.role = 'primary_caregiver' and p_role <> 'primary_caregiver'
     and private.active_primary_count(p_household_id) <= 1 then
    raise exception 'last_primary_caregiver' using errcode = 'P0001';
  end if;
  if v_target.role = p_role then
    return jsonb_build_object('outcome', 'unchanged');
  end if;

  update public.household_members set role = p_role where id = v_target.id;
  v_audit_id := private.write_audit(
    p_household_id, null, null, null, 'human', p_user_id, 'member.role_changed',
    jsonb_build_object('member_id', v_target.id, 'old_role', v_target.role, 'new_role', p_role)
  );
  perform private.add_feed_item(
    p_household_id, null, null, null, 'member_role_changed', v_actor.id,
    jsonb_build_object('member_id', v_target.id, 'role', p_role), v_audit_id
  );
  perform private.add_reminder(
    p_household_id, null, null, null, v_target.id, 'member_role_changed',
    jsonb_build_object('member_id', v_target.id, 'role', p_role)
  );
  if p_role = 'care_recipient' then
    perform private.release_departing_member(p_household_id, v_target.id);
  end if;

  return jsonb_build_object('outcome', 'role_changed', 'role', p_role);
end;
$$;

-- ---------------------------------------------------------------------------
-- deactivate_member
-- ---------------------------------------------------------------------------
create function public.deactivate_member(
  p_household_id uuid,
  p_member_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_target public.household_members;
begin
  perform private.lock_active_members(p_household_id);
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;
  select m.* into v_target
  from public.household_members m
  where m.id = p_member_id and m.household_id = p_household_id and m.is_active;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_target.id = v_actor.id then
    raise exception 'self_target' using errcode = 'P0001';
  end if;
  if v_target.role = 'primary_caregiver' and private.active_primary_count(p_household_id) <= 1 then
    raise exception 'last_primary_caregiver' using errcode = 'P0001';
  end if;

  update public.household_members set is_active = false where id = v_target.id;
  perform private.write_audit(
    p_household_id, null, null, null, 'human', p_user_id, 'member.deactivated',
    jsonb_build_object('member_id', v_target.id, 'role', v_target.role)
  );
  perform private.release_departing_member(p_household_id, v_target.id);

  return jsonb_build_object('outcome', 'deactivated');
end;
$$;

-- ---------------------------------------------------------------------------
-- leave_household
-- ---------------------------------------------------------------------------
create function public.leave_household(p_household_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
begin
  perform private.lock_active_members(p_household_id);
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'primary_caregiver' and private.active_primary_count(p_household_id) <= 1 then
    raise exception 'last_primary_caregiver' using errcode = 'P0001';
  end if;

  update public.household_members set is_active = false where id = v_actor.id;
  perform private.write_audit(
    p_household_id, null, null, null, 'human', p_user_id, 'member.left',
    jsonb_build_object('member_id', v_actor.id, 'role', v_actor.role)
  );
  perform private.release_departing_member(p_household_id, v_actor.id);

  return jsonb_build_object('outcome', 'left');
end;
$$;

-- ---------------------------------------------------------------------------
-- set_member_display_name (own name only)
-- ---------------------------------------------------------------------------
create function public.set_member_display_name(
  p_household_id uuid,
  p_user_id uuid,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_name text := private.clean_display_name(p_display_name);
begin
  select m.* into v_actor
  from public.household_members m
  where m.household_id = p_household_id and m.user_id = p_user_id and m.is_active
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_name is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  update public.household_members set display_name = v_name where id = v_actor.id;
  perform private.write_audit(
    p_household_id, null, null, null, 'human', p_user_id, 'member.display_name_changed',
    jsonb_build_object('member_id', v_actor.id)
  );
  return jsonb_build_object('outcome', 'renamed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------
revoke all on function private.clean_display_name(text) from public, anon, authenticated;
revoke all on function private.is_household_role(text) from public, anon, authenticated;
revoke all on function private.lock_user_membership(uuid) from public, anon, authenticated;
grant execute on function private.clean_display_name(text) to service_role;
grant execute on function private.is_household_role(text) to service_role;
grant execute on function private.lock_user_membership(uuid) to service_role;

revoke all on function public.create_household(uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_invite(uuid, uuid, text, bytea) from public, anon, authenticated;
revoke all on function public.list_invites(uuid, uuid) from public, anon, authenticated;
revoke all on function public.revoke_invite(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.preview_invite(bytea) from public, anon, authenticated;
revoke all on function public.accept_invite(bytea, uuid, text) from public, anon, authenticated;
revoke all on function public.change_member_role(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.deactivate_member(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_household(uuid, uuid) from public, anon, authenticated;
revoke all on function public.set_member_display_name(uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_household(uuid, text, text) to service_role;
grant execute on function public.create_invite(uuid, uuid, text, bytea) to service_role;
grant execute on function public.list_invites(uuid, uuid) to service_role;
grant execute on function public.revoke_invite(uuid, uuid, uuid) to service_role;
grant execute on function public.preview_invite(bytea) to service_role;
grant execute on function public.accept_invite(bytea, uuid, text) to service_role;
grant execute on function public.change_member_role(uuid, uuid, uuid, text) to service_role;
grant execute on function public.deactivate_member(uuid, uuid, uuid) to service_role;
grant execute on function public.leave_household(uuid, uuid) to service_role;
grant execute on function public.set_member_display_name(uuid, uuid, text) to service_role;
