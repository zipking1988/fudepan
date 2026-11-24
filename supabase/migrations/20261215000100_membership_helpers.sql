-- Family app demo parity, migration 2: private helpers for membership functions.
--
-- Additive only: new functions in schema `private`, service_role only, security
-- invoker, `set search_path = ''`. They mirror src/lib/membership/model.ts.
-- Lock order everywhere: user advisory lock -> invite row -> household member
-- rows -> care_steps (by id) -> care_requests.

-- Locks every active member row of a household in id order. A statement that
-- runs after this call (READ COMMITTED) sees every committed membership change,
-- so counting primaries afterwards is safe against concurrent demotions.
create function private.lock_active_members(p_household_id uuid)
returns setof public.household_members
language plpgsql
set search_path = ''
as $$
begin
  return query
  select m.*
  from public.household_members m
  where m.household_id = p_household_id
    and m.is_active
  order by m.id
  for update;
end;
$$;

-- Marks every overdue pending invite of the household expired and writes one
-- system `invite.expired` audit event per newly expired row. A second
-- transaction sees the changed state, so each invite is audited exactly once.
create function private.expire_overdue_invites(p_household_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    with expired as (
      update public.household_invites i
      set state = 'expired', expired_at = now()
      where i.household_id = p_household_id
        and i.state = 'pending'
        and i.expires_at <= now()
      returning i.id, i.role, i.created_at
    )
    select e.id, e.role from expired e order by e.created_at, e.id
  loop
    perform private.write_audit(
      p_household_id, null, null, null, 'system', null, 'invite.expired',
      jsonb_build_object('invite_id', v_row.id, 'role', v_row.role)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- One In_App_Reminder per active Primary_Caregiver except the excluded member,
-- ordered by created_at, id. With p_step_id, the reminder is linked to that Part.
create function private.notify_primaries(
  p_household_id uuid,
  p_exclude_member_id uuid,
  p_kind text,
  p_params jsonb default '{}'::jsonb,
  p_step_id uuid default null
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_chain_id uuid;
  v_note_id uuid;
  v_primary record;
  v_count integer := 0;
begin
  if p_step_id is not null then
    select c.id, c.note_id into v_chain_id, v_note_id
    from public.care_steps s
    join public.care_chains c on c.id = s.care_chain_id
    where s.id = p_step_id;
  end if;

  for v_primary in
    select m.id
    from public.household_members m
    where m.household_id = p_household_id
      and m.role = 'primary_caregiver'
      and m.is_active
      and (p_exclude_member_id is null or m.id <> p_exclude_member_id)
    order by m.created_at, m.id
  loop
    perform private.add_reminder(
      p_household_id, v_note_id, v_chain_id, p_step_id, v_primary.id, p_kind, p_params
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Departure algorithm. Runs AFTER the member row was updated (deactivated, left,
-- or changed to care_recipient), so reminder loops skip the departing member.
-- Releases every Held_Part with no 24-hour block. Returns the number of Parts touched.
create function private.release_departing_member(p_household_id uuid, p_member_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_removed text[];
  v_role text;
  v_audit_id uuid;
  v_owner_audit_id uuid;
  v_request public.care_requests;
  v_other uuid;
  v_other_active boolean;
  v_performer text;
  v_touched integer := 0;
begin
  for v_step in
    select s.*
    from public.care_steps s
    join public.care_chains c on c.id = s.care_chain_id
    where c.household_id = p_household_id
      and s.status not in ('completed', 'cancelled', 'failed')
      and (
        s.owner_id = p_member_id
        or s.driver_id = p_member_id
        or s.companion_id = p_member_id
        or s.backup_owner_id = p_member_id
        or exists (
          select 1
          from public.care_requests r
          where r.care_step_id = s.id
            and r.status = 'pending'
            and (r.from_member_id = p_member_id or r.to_member_id = p_member_id)
        )
      )
    order by s.id
    for update of s
  loop
    select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
    v_touched := v_touched + 1;
    v_owner_audit_id := null;

    v_removed := array[]::text[];
    if v_step.owner_id = p_member_id then v_removed := array_append(v_removed, 'owner'::text); end if;
    if v_step.driver_id = p_member_id then v_removed := array_append(v_removed, 'driver'::text); end if;
    if v_step.companion_id = p_member_id then v_removed := array_append(v_removed, 'companion'::text); end if;
    if v_step.backup_owner_id = p_member_id then v_removed := array_append(v_removed, 'backup_owner'::text); end if;

    if cardinality(v_removed) > 0 then
      update public.care_steps
      set owner_id = case when owner_id = p_member_id then null else owner_id end,
          driver_id = case when driver_id = p_member_id then null else driver_id end,
          companion_id = case when companion_id = p_member_id then null else companion_id end,
          backup_owner_id = case when backup_owner_id = p_member_id then null else backup_owner_id end
      where id = v_step.id;

      foreach v_role in array v_removed loop
        v_audit_id := private.write_audit(
          p_household_id, v_step.care_chain_id, v_step.id, v_chain.note_id,
          'system', null, 'part.released',
          jsonb_build_object('role', v_role, 'member_id', p_member_id, 'reason', 'member_departed')
        );
        if v_role = 'owner' then
          v_owner_audit_id := v_audit_id;
        end if;
      end loop;
    end if;

    for v_request in
      select r.*
      from public.care_requests r
      where r.care_step_id = v_step.id
        and r.status = 'pending'
        and (r.from_member_id = p_member_id or r.to_member_id = p_member_id)
      order by r.created_at, r.id
      for update
    loop
      update public.care_requests
      set status = 'declined', resolved_at = now(), resolved_by = null
      where id = v_request.id;

      perform private.write_audit(
        p_household_id, v_step.care_chain_id, v_step.id, v_chain.note_id,
        'system', null, v_request.kind || '.declined',
        jsonb_build_object('request_id', v_request.id, 'reason', 'member_departed')
      );

      v_other := case
        when v_request.from_member_id = p_member_id then v_request.to_member_id
        else v_request.from_member_id
      end;
      select m.is_active into v_other_active
      from public.household_members m
      where m.id = v_other;
      if coalesce(v_other_active, false) then
        perform private.add_reminder(
          p_household_id, v_chain.note_id, v_step.care_chain_id, v_step.id,
          v_other, v_request.kind || '_declined'
        );
      end if;
    end loop;

    v_performer := case
      when 'owner' = any (v_removed) then 'owner'
      when 'driver' = any (v_removed) then 'driver'
      when 'companion' = any (v_removed) then 'companion'
      else null
    end;
    if v_performer is not null then
      perform private.apply_people_change(v_step.id, v_performer, null);
    end if;

    if v_owner_audit_id is not null then
      perform private.add_feed_item(
        p_household_id, v_chain.note_id, v_step.care_chain_id, v_step.id,
        'part_released', null,
        jsonb_build_object('role', 'owner', 'needs_someone', true, 'reason', 'member_departed'),
        v_owner_audit_id
      );
      perform private.notify_primaries(
        p_household_id, p_member_id, 'part_needs_someone', '{}'::jsonb, v_step.id
      );
    end if;
  end loop;

  return v_touched;
end;
$$;

revoke all on function private.lock_active_members(uuid) from public, anon, authenticated;
revoke all on function private.expire_overdue_invites(uuid) from public, anon, authenticated;
revoke all on function private.notify_primaries(uuid, uuid, text, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.release_departing_member(uuid, uuid) from public, anon, authenticated;

grant execute on function private.lock_active_members(uuid) to service_role;
grant execute on function private.expire_overdue_invites(uuid) to service_role;
grant execute on function private.notify_primaries(uuid, uuid, text, jsonb, uuid) to service_role;
grant execute on function private.release_departing_member(uuid, uuid) to service_role;
