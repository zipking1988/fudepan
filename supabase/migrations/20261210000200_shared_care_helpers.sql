-- Family shared care, migration 3: private helpers for the Action_Guard functions.
--
-- Additive only: new functions in schema `private`. No table, column, or row
-- is touched. The public Action_Guard functions (claim, release, requests,
-- approval, ...) arrive in later migrations and call these helpers.
--
-- Every helper: plpgsql, `set search_path = ''`, execute revoked from public,
-- anon, and authenticated, granted to service_role only. Browser roles cannot
-- call them. Helpers are security invoker and rely on the caller (a service
-- role function) already holding the care_steps row lock.
--
-- The rules mirror src/lib/care/rules (approval.ts, requests.ts, defaults.ts)
-- and the reference model in model.ts, which defines the audit and feed
-- accounting:
--   * a primary event writes one audit event and one household Feed_Item;
--   * an In_App_Reminder writes one `reminder.sent` audit event and one
--     Feed_Item addressed to one Member;
--   * a people or Key_Fact change on an approved High_Risk_Part writes
--     `approval.reset` (no Feed_Item) plus a reminder per active Primary_Caregiver.
--
-- Audit payloads hold only IDs, codes, counts, ISO times, and zone names.

-- ---------------------------------------------------------------------------
-- Lookups
-- ---------------------------------------------------------------------------

-- Active membership of the actor in the household, or a null row. Read at the
-- moment of the call so no cached role or status is ever used (Requirement 9.14).
create function private.actor_member(p_household_id uuid, p_user_id uuid)
returns public.household_members
language plpgsql
stable
set search_path = ''
as $$
declare
  v_member public.household_members;
begin
  select m.* into v_member
  from public.household_members m
  where m.household_id = p_household_id
    and m.user_id = p_user_id
    and m.is_active;

  if not found then
    return null;
  end if;
  return v_member;
end;
$$;

-- Number of active Primary_Caregivers right now (Self_Approval rule, 9.5-9.7).
create function private.active_primary_count(p_household_id uuid)
returns integer
language plpgsql
stable
set search_path = ''
as $$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.household_members m
  where m.household_id = p_household_id
    and m.role = 'primary_caregiver'
    and m.is_active;
  return v_count;
end;
$$;

-- Household that owns a Part, through its Care Chain. Null if the Part does not exist.
create function private.step_household_id(p_step_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_household_id uuid;
begin
  select c.household_id into v_household_id
  from public.care_steps s
  join public.care_chains c on c.id = s.care_chain_id
  where s.id = p_step_id;
  return v_household_id;
end;
$$;

-- Closed_Part for claim, release, handover, and request purposes: completed or
-- cancelled. Completion and failure additionally refuse `failed` in their own functions.
create function private.is_part_closed(p_step public.care_steps)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_step.status in ('completed', 'cancelled');
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval rules (mirror approval.ts)
-- ---------------------------------------------------------------------------

-- Requirement 18.6. A stored state wins. A legacy row (null) derives:
-- not_required when approval is not required, approved when the legacy status
-- is approved or completed, otherwise pending.
create function private.effective_approval_state(p_step public.care_steps)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_step.approval_state is not null then
    return p_step.approval_state;
  end if;
  if not p_step.approval_required then
    return 'not_required';
  end if;
  if p_step.status in ('approved', 'completed') then
    return 'approved';
  end if;
  return 'pending';
end;
$$;

-- High_Risk_Part: risk level high, or category appointment, medication,
-- payment, transport, or document (insurance and government paperwork).
create function private.is_high_risk(p_step public.care_steps)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_step.risk_level = 'high'
    or p_step.care_category in ('appointment', 'medication', 'payment', 'transport', 'document');
end;
$$;

-- ---------------------------------------------------------------------------
-- Audit and feed writers
-- ---------------------------------------------------------------------------

-- Inserts one audit event with note_id and created_at = clock_timestamp(), so
-- events written in one transaction keep their order (now() would tie them).
-- When p_note_id is null and a chain is given, note_id comes from the chain.
create function private.write_audit(
  p_household_id uuid,
  p_chain_id uuid,
  p_step_id uuid,
  p_note_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_note_id uuid := p_note_id;
  v_audit_id uuid;
begin
  if v_note_id is null and p_chain_id is not null then
    select c.note_id into v_note_id
    from public.care_chains c
    where c.id = p_chain_id
      and c.household_id = p_household_id;
  end if;

  insert into public.audit_events (
    household_id, care_chain_id, care_step_id, note_id,
    actor_type, actor_id, event_type, payload, created_at
  )
  values (
    p_household_id, p_chain_id, p_step_id, v_note_id,
    p_actor_type, p_actor_id, p_event_type, coalesce(p_payload, '{}'::jsonb), clock_timestamp()
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$$;

-- One household Feed_Item linked to the audit event that caused it.
create function private.add_feed_item(
  p_household_id uuid,
  p_note_id uuid,
  p_chain_id uuid,
  p_step_id uuid,
  p_kind text,
  p_actor_member_id uuid,
  p_params jsonb,
  p_audit_event_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_note_id uuid := p_note_id;
  v_feed_id uuid;
begin
  if v_note_id is null and p_chain_id is not null then
    select c.note_id into v_note_id
    from public.care_chains c
    where c.id = p_chain_id
      and c.household_id = p_household_id;
  end if;

  insert into public.feed_items (
    household_id, note_id, care_chain_id, care_step_id, kind,
    actor_member_id, recipient_member_id, params, audit_event_id
  )
  values (
    p_household_id, v_note_id, p_chain_id, p_step_id, p_kind,
    p_actor_member_id, null, coalesce(p_params, '{}'::jsonb), p_audit_event_id
  )
  returning id into v_feed_id;

  return v_feed_id;
end;
$$;

-- One In_App_Reminder: a `reminder.sent` audit event (channel in_app, system
-- actor) plus one Feed_Item addressed to the recipient only (Requirement 19.3).
create function private.add_reminder(
  p_household_id uuid,
  p_note_id uuid,
  p_chain_id uuid,
  p_step_id uuid,
  p_recipient_member_id uuid,
  p_kind text,
  p_params jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_note_id uuid := p_note_id;
  v_audit_id uuid;
  v_feed_id uuid;
begin
  if v_note_id is null and p_chain_id is not null then
    select c.note_id into v_note_id
    from public.care_chains c
    where c.id = p_chain_id
      and c.household_id = p_household_id;
  end if;

  v_audit_id := private.write_audit(
    p_household_id, p_chain_id, p_step_id, v_note_id,
    'system', null, 'reminder.sent',
    jsonb_build_object(
      'channel', 'in_app',
      'recipient_member_id', p_recipient_member_id,
      'kind', p_kind
    )
  );

  insert into public.feed_items (
    household_id, note_id, care_chain_id, care_step_id, kind,
    actor_member_id, recipient_member_id, params, audit_event_id
  )
  values (
    p_household_id, v_note_id, p_chain_id, p_step_id, p_kind,
    null, p_recipient_member_id, coalesce(p_params, '{}'::jsonb), v_audit_id
  )
  returning id into v_feed_id;

  return v_feed_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval reset on a plan change (9.9, 9.21, 9.22, 9.24, 18.7)
-- ---------------------------------------------------------------------------

-- Shared by apply_people_change and apply_key_fact_change. The caller has
-- already written the holder or fact change and holds the care_steps row lock.
--   * Always stores the materialized effective state (18.7).
--   * High_Risk_Part, state approved: state becomes pending, plan_version + 1,
--     `approval.reset` audit event {changed}, one reminder per active
--     Primary_Caregiver.
--   * High_Risk_Part, state rejected: plan_version + 1, state stays rejected.
--   * Anything else: no state change, no bump.
-- Returns true when approval was reset. p_actor_user_id null writes a system event.
create function private.apply_plan_change(
  p_step_id uuid,
  p_changed text,
  p_actor_user_id uuid
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_household_id uuid;
  v_note_id uuid;
  v_was text;
  v_high boolean;
  v_bump boolean;
  v_reset boolean;
  v_primary record;
begin
  select s.* into v_step
  from public.care_steps s
  where s.id = p_step_id
  for update;

  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;

  select c.household_id, c.note_id into v_household_id, v_note_id
  from public.care_chains c
  where c.id = v_step.care_chain_id;

  v_was := private.effective_approval_state(v_step);
  v_high := private.is_high_risk(v_step);
  v_bump := v_high and v_was in ('approved', 'rejected');
  v_reset := v_high and v_was = 'approved';

  update public.care_steps
  set approval_state = case when v_reset then 'pending' else v_was end,
      plan_version = plan_version + case when v_bump then 1 else 0 end
  where id = p_step_id;

  if v_reset then
    perform private.write_audit(
      v_household_id, v_step.care_chain_id, v_step.id, v_note_id,
      case when p_actor_user_id is null then 'system' else 'human' end,
      p_actor_user_id,
      'approval.reset',
      jsonb_build_object('changed', p_changed)
    );

    for v_primary in
      select m.id
      from public.household_members m
      where m.household_id = v_household_id
        and m.role = 'primary_caregiver'
        and m.is_active
      order by m.created_at, m.id
    loop
      perform private.add_reminder(
        v_household_id, v_note_id, v_step.care_chain_id, v_step.id,
        v_primary.id, 'approval_reset'
      );
    end loop;
  end if;

  return v_reset;
end;
$$;

-- A holder changed: p_changed_role is owner, driver, or companion.
create function private.apply_people_change(
  p_step_id uuid,
  p_changed_role text,
  p_actor_user_id uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_changed_role is null or p_changed_role not in ('owner', 'driver', 'companion') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  return private.apply_plan_change(p_step_id, p_changed_role, p_actor_user_id);
end;
$$;

-- A Key_Fact changed: p_fact is location, appointment_time, or amount.
create function private.apply_key_fact_change(
  p_step_id uuid,
  p_fact text,
  p_actor_user_id uuid default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_fact is null or p_fact not in ('location', 'appointment_time', 'amount') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  return private.apply_plan_change(p_step_id, p_fact, p_actor_user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pending defaults, one helper each
-- ---------------------------------------------------------------------------

-- D-1 and D-7. Assignment and Backup_Request expire 24 hours after the request
-- (rule '24h'). A Handover expires at a human_confirmed Task_Due_Time that is
-- later than the request time (rule 'task_due'), otherwise 24 hours after the
-- request. Mirrors requestExpiry and handoverExpiryWithRule in requests.ts.
create function private.request_expiry(
  p_kind text,
  p_step public.care_steps,
  p_requested_at timestamptz
)
returns table (expires_at timestamptz, expiry_rule text)
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_kind is null or p_kind not in ('assignment', 'handover', 'backup') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if p_kind = 'handover'
     and p_step.task_due_provenance = 'human_confirmed'
     and p_step.task_due_at is not null
     and p_step.task_due_at > p_requested_at then
    return query select p_step.task_due_at, 'task_due'::text;
  else
    return query select p_requested_at + interval '24 hours', '24h'::text;
  end if;
end;
$$;

-- D-2. The Part's Owner or an active Primary_Caregiver of the Part's household
-- may Reopen a failed Part or create a Backup_Request. Pass the row returned by
-- private.actor_member; a null row is never allowed.
create function private.may_reopen_or_request_backup(
  p_actor public.household_members,
  p_step public.care_steps
)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_actor.id is null or not p_actor.is_active then
    return false;
  end if;
  if p_actor.household_id is distinct from private.step_household_id(p_step.id) then
    return false;
  end if;
  return (p_step.owner_id is not null and p_step.owner_id = p_actor.id)
    or p_actor.role = 'primary_caregiver';
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------
revoke all on function private.actor_member(uuid, uuid) from public, anon, authenticated;
revoke all on function private.active_primary_count(uuid) from public, anon, authenticated;
revoke all on function private.step_household_id(uuid) from public, anon, authenticated;
revoke all on function private.is_part_closed(public.care_steps) from public, anon, authenticated;
revoke all on function private.effective_approval_state(public.care_steps) from public, anon, authenticated;
revoke all on function private.is_high_risk(public.care_steps) from public, anon, authenticated;
revoke all on function private.write_audit(uuid, uuid, uuid, uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.add_feed_item(uuid, uuid, uuid, uuid, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.add_reminder(uuid, uuid, uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function private.apply_plan_change(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.apply_people_change(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.apply_key_fact_change(uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.request_expiry(text, public.care_steps, timestamptz)
  from public, anon, authenticated;
revoke all on function private.may_reopen_or_request_backup(public.household_members, public.care_steps)
  from public, anon, authenticated;

grant execute on function private.actor_member(uuid, uuid) to service_role;
grant execute on function private.active_primary_count(uuid) to service_role;
grant execute on function private.step_household_id(uuid) to service_role;
grant execute on function private.is_part_closed(public.care_steps) to service_role;
grant execute on function private.effective_approval_state(public.care_steps) to service_role;
grant execute on function private.is_high_risk(public.care_steps) to service_role;
grant execute on function private.write_audit(uuid, uuid, uuid, uuid, text, uuid, text, jsonb)
  to service_role;
grant execute on function private.add_feed_item(uuid, uuid, uuid, uuid, text, uuid, jsonb, uuid)
  to service_role;
grant execute on function private.add_reminder(uuid, uuid, uuid, uuid, uuid, text, jsonb)
  to service_role;
grant execute on function private.apply_plan_change(uuid, text, uuid) to service_role;
grant execute on function private.apply_people_change(uuid, text, uuid) to service_role;
grant execute on function private.apply_key_fact_change(uuid, text, uuid) to service_role;
grant execute on function private.request_expiry(text, public.care_steps, timestamptz)
  to service_role;
grant execute on function private.may_reopen_or_request_backup(public.household_members, public.care_steps)
  to service_role;
