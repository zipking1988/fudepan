-- Family shared care, migration 4: public Action_Guard functions.
--
-- Tasks 8.2 to 8.6 of the family-shared-care spec appended their functions to
-- THIS file; task 8.6 registered it. A registered migration is never re-applied
-- when the file grows, so later tasks must add a NEW migration file instead.
-- Every function is written with `create or replace`, and every privilege
-- statement is repeatable, so running the whole file again is safe.
--
-- Contents so far:
--   8.2  claim_part, release_part
--   8.3  request_assignment, request_handover, request_backup, volunteer_backup,
--        respond_to_request, expire_care_requests (+ private helpers for requests)
--   8.4  decide_approval, resubmit_part
--   8.5  complete_part, report_part_failed, reopen_part, record_evidence
--   8.6  confirm_part_time, save_part_amount, resolve_missing_detail,
--        mark_feed_seen, set_member_language, save_appointment_clarification (replaced)
--
-- All functions: plpgsql, `set search_path = ''`, security invoker, lock the
-- care_steps row first, resolve the actor with private.actor_member at call
-- time, raise P0001 with a refusal code, execute for service_role only.
-- p_user_id is the verified signed-in user passed by server code.
-- The rules mirror src/lib/care/rules/claims.ts; audit and feed accounting
-- mirrors model.ts: one primary audit event and one household Feed_Item per
-- success, plus approval.reset and reminders from private.apply_people_change.
-- Audit payloads hold only IDs and codes.

-- ---------------------------------------------------------------------------
-- 8.2 claim_part
-- ---------------------------------------------------------------------------
create or replace function public.claim_part(
  p_step_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_household_id uuid;
  v_actor public.household_members;
  v_holder uuid;
  v_event text;
  v_audit_id uuid;
  v_reset boolean;
begin
  select s.* into v_step
  from public.care_steps s
  where s.id = p_step_id
  for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_household_id := v_chain.household_id;
  v_actor := private.actor_member(v_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('owner', 'driver', 'companion') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_role <> 'owner' and v_step.care_category not in ('appointment', 'transport') then
    raise exception 'role_not_offered' using errcode = 'P0001';
  end if;
  v_holder := case p_role
    when 'owner' then v_step.owner_id
    when 'driver' then v_step.driver_id
    else v_step.companion_id
  end;
  if v_holder is not null then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  update public.care_steps
  set owner_id = case when p_role = 'owner' then v_actor.id else owner_id end,
      driver_id = case when p_role = 'driver' then v_actor.id else driver_id end,
      companion_id = case when p_role = 'companion' then v_actor.id else companion_id end,
      status = case
        when p_role = 'owner' and status = 'pending_review' then 'in_progress'
        else status
      end
  where id = p_step_id;

  v_event := case p_role
    when 'owner' then 'part.claimed'
    when 'driver' then 'part.driver_volunteered'
    else 'part.companion_volunteered'
  end;
  v_audit_id := private.write_audit(
    v_household_id, v_step.care_chain_id, v_step.id, v_chain.note_id,
    'human', p_user_id, v_event,
    jsonb_build_object('role', p_role, 'member_id', v_actor.id)
  );
  perform private.add_feed_item(
    v_household_id, v_chain.note_id, v_step.care_chain_id, v_step.id,
    'part_claimed', v_actor.id, jsonb_build_object('role', p_role), v_audit_id
  );
  v_reset := private.apply_people_change(p_step_id, p_role, p_user_id);

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_step.care_chain_id,
    'note_id', v_chain.note_id,
    'outcome', 'claimed',
    'approval_reset', v_reset
  );
end;
$$;

comment on function public.claim_part(uuid, uuid, text) is
  'Server-only. A Member claims owner, driver, or companion on a Part. First claim wins under the row lock.';

-- ---------------------------------------------------------------------------
-- 8.2 release_part
-- ---------------------------------------------------------------------------
create or replace function public.release_part(
  p_step_id uuid,
  p_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_household_id uuid;
  v_actor public.household_members;
  v_holder uuid;
  v_audit_id uuid;
  v_reset boolean;
begin
  select s.* into v_step
  from public.care_steps s
  where s.id = p_step_id
  for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_household_id := v_chain.household_id;
  v_actor := private.actor_member(v_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('owner', 'driver', 'companion') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_holder := case p_role
    when 'owner' then v_step.owner_id
    when 'driver' then v_step.driver_id
    else v_step.companion_id
  end;
  if v_holder is distinct from v_actor.id then
    raise exception 'not_holder' using errcode = 'P0001';
  end if;
  -- Requirement 7.2: only a human_confirmed Task_Due_Time blocks, and it blocks
  -- when it is overdue or within the next 24 hours (RELEASE_WINDOW_HOURS).
  if private.is_high_risk(v_step)
     and v_step.task_due_provenance = 'human_confirmed'
     and v_step.task_due_at is not null
     and v_step.task_due_at <= now() + interval '24 hours' then
    raise exception 'release_blocked_due_soon' using errcode = 'P0001';
  end if;

  update public.care_steps
  set owner_id = case when p_role = 'owner' then null else owner_id end,
      driver_id = case when p_role = 'driver' then null else driver_id end,
      companion_id = case when p_role = 'companion' then null else companion_id end
  where id = p_step_id;

  v_audit_id := private.write_audit(
    v_household_id, v_step.care_chain_id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'part.released',
    jsonb_build_object('role', p_role, 'member_id', v_actor.id)
  );
  perform private.add_feed_item(
    v_household_id, v_chain.note_id, v_step.care_chain_id, v_step.id,
    'part_released', v_actor.id,
    jsonb_build_object('role', p_role, 'needs_someone', true), v_audit_id
  );
  v_reset := private.apply_people_change(p_step_id, p_role, p_user_id);

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_step.care_chain_id,
    'note_id', v_chain.note_id,
    'outcome', 'released',
    'approval_reset', v_reset
  );
end;
$$;

comment on function public.release_part(uuid, uuid, text) is
  'Server-only. The holder of a role releases it. Blocked for High_Risk_Parts due within 24 hours or overdue.';

-- ---------------------------------------------------------------------------
-- 8.3 private helpers for requests
-- ---------------------------------------------------------------------------

-- ISO 8601 UTC text, the form used in audit payloads (matches toISOString()).
create or replace function private.iso_utc(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

-- Creates the pending request, its `<kind>.requested` audit event, one household
-- Feed_Item, and one In_App_Reminder to the receiver. The caller holds the
-- care_steps row lock and has already checked the actor and the role rules.
-- Receiver rule (Requirements 8.2, 5.14): active, same household, not a
-- Care_Recipient, not the requester; for a Backup_Request also not the Owner.
create or replace function private.create_care_request(
  p_step public.care_steps,
  p_chain public.care_chains,
  p_actor public.household_members,
  p_user_id uuid,
  p_kind text,
  p_helper_role text,
  p_to_member_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_receiver public.household_members;
  v_expires_at timestamptz;
  v_rule text;
  v_request_id uuid;
  v_audit_id uuid;
  v_payload jsonb;
begin
  select m.* into v_receiver
  from public.household_members m
  where m.id = p_to_member_id
    and m.household_id = p_chain.household_id
    and m.is_active
    and m.role <> 'care_recipient'
    and m.id <> p_actor.id;
  if not found or (p_kind = 'backup' and v_receiver.id = p_step.owner_id) then
    raise exception 'receiver_not_eligible' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.care_requests r
    where r.care_step_id = p_step.id and r.kind = p_kind
      and coalesce(r.helper_role, '-') = coalesce(p_helper_role, '-')
      and r.status = 'pending'
  ) then
    raise exception 'request_pending' using errcode = 'P0001';
  end if;

  select e.expires_at, e.expiry_rule into v_expires_at, v_rule
  from private.request_expiry(p_kind, p_step, now()) e;

  begin
    insert into public.care_requests (
      household_id, care_chain_id, care_step_id, kind, helper_role,
      from_member_id, to_member_id, status, expires_at, expiry_rule
    )
    values (
      p_chain.household_id, p_chain.id, p_step.id, p_kind, p_helper_role,
      p_actor.id, v_receiver.id, 'pending', v_expires_at, v_rule
    )
    returning id into v_request_id;
  exception when unique_violation then
    raise exception 'request_pending' using errcode = 'P0001';
  end;

  v_payload := jsonb_build_object(
    'request_id', v_request_id,
    'receiver_member_id', v_receiver.id,
    'expires_at', private.iso_utc(v_expires_at),
    'expiry_rule', v_rule
  );
  if p_helper_role is not null then
    v_payload := v_payload || jsonb_build_object('role', p_helper_role);
  end if;

  v_audit_id := private.write_audit(
    p_chain.household_id, p_chain.id, p_step.id, p_chain.note_id,
    'human', p_user_id, p_kind || '.requested', v_payload
  );
  perform private.add_feed_item(
    p_chain.household_id, p_chain.note_id, p_chain.id, p_step.id,
    p_kind || '_requested', p_actor.id,
    jsonb_build_object('request_id', v_request_id), v_audit_id
  );
  perform private.add_reminder(
    p_chain.household_id, p_chain.note_id, p_chain.id, p_step.id,
    v_receiver.id, p_kind || '_requested'
  );

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', p_chain.id,
    'note_id', p_chain.note_id,
    'outcome', 'requested',
    'approval_reset', false,
    'request_id', v_request_id
  );
end;
$$;

-- The expired branch shared by respond_to_request and expire_care_requests
-- (Requirements 8.6, 8.9, 8.11, 8.12). Marks the request expired, writes the
-- not-accepted audit event and household Feed_Item, and reminds both parties.
-- No holder changes. p_actor_user_id null is the system sweeper.
create or replace function private.close_care_request_expired(
  p_request public.care_requests,
  p_chain public.care_chains,
  p_actor_user_id uuid,
  p_actor_member_id uuid
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_event text;
  v_payload jsonb;
  v_audit_id uuid;
begin
  update public.care_requests
  set status = 'expired', resolved_at = now(), resolved_by = p_actor_member_id
  where id = p_request.id;

  v_event := case p_request.kind
    when 'assignment' then 'assignment.expired'
    when 'handover' then 'handover.not_accepted'
    else 'backup.expired'
  end;
  v_payload := jsonb_build_object('request_id', p_request.id);
  if p_request.helper_role is not null then
    v_payload := v_payload || jsonb_build_object('role', p_request.helper_role);
  end if;

  v_audit_id := private.write_audit(
    p_chain.household_id, p_chain.id, p_request.care_step_id, p_chain.note_id,
    case when p_actor_user_id is null then 'system' else 'human' end,
    p_actor_user_id, v_event, v_payload
  );
  perform private.add_feed_item(
    p_chain.household_id, p_chain.note_id, p_chain.id, p_request.care_step_id,
    replace(v_event, '.', '_'), p_actor_member_id,
    jsonb_build_object('request_id', p_request.id), v_audit_id
  );
  perform private.add_reminder(
    p_chain.household_id, p_chain.note_id, p_chain.id, p_request.care_step_id,
    p_request.from_member_id, p_request.kind || '_expired'
  );
  perform private.add_reminder(
    p_chain.household_id, p_chain.note_id, p_chain.id, p_request.care_step_id,
    p_request.to_member_id, p_request.kind || '_expired'
  );
  return v_audit_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8.3 request_assignment
-- ---------------------------------------------------------------------------
create or replace function public.request_assignment(
  p_step_id uuid,
  p_user_id uuid,
  p_to_member_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;
  return private.create_care_request(
    v_step, v_chain, v_actor, p_user_id, 'assignment', 'owner', p_to_member_id
  );
end;
$$;

comment on function public.request_assignment(uuid, uuid, uuid) is
  'Server-only. A Primary_Caregiver asks another Member to take the Owner role. Nothing changes until the receiver accepts.';

-- ---------------------------------------------------------------------------
-- 8.3 request_handover
-- ---------------------------------------------------------------------------
create or replace function public.request_handover(
  p_step_id uuid,
  p_user_id uuid,
  p_role text,
  p_to_member_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_holder uuid;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if p_role is null or p_role not in ('owner', 'driver', 'companion') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_holder := case p_role
    when 'owner' then v_step.owner_id
    when 'driver' then v_step.driver_id
    else v_step.companion_id
  end;
  if v_holder is distinct from v_actor.id then
    raise exception 'not_holder' using errcode = 'P0001';
  end if;
  return private.create_care_request(
    v_step, v_chain, v_actor, p_user_id, 'handover', p_role, p_to_member_id
  );
end;
$$;

comment on function public.request_handover(uuid, uuid, text, uuid) is
  'Server-only. The holder of a role asks another Member to take it. The holder keeps the role until the receiver accepts.';

-- ---------------------------------------------------------------------------
-- 8.3 request_backup
-- ---------------------------------------------------------------------------
create or replace function public.request_backup(
  p_step_id uuid,
  p_user_id uuid,
  p_to_member_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if not private.may_reopen_or_request_backup(v_actor, v_step) then
    raise exception 'not_allowed_backup_request' using errcode = 'P0001';
  end if;
  return private.create_care_request(
    v_step, v_chain, v_actor, p_user_id, 'backup', null, p_to_member_id
  );
end;
$$;

comment on function public.request_backup(uuid, uuid, uuid) is
  'Server-only. The Owner or an active Primary_Caregiver asks another Member to be Backup_Owner (D-2).';

-- ---------------------------------------------------------------------------
-- 8.3 volunteer_backup
-- ---------------------------------------------------------------------------
create or replace function public.volunteer_backup(
  p_step_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_audit_id uuid;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if v_step.owner_id is not null and v_step.owner_id = v_actor.id then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if v_step.backup_owner_id is not null then
    raise exception 'already_claimed' using errcode = 'P0001';
  end if;

  update public.care_steps set backup_owner_id = v_actor.id where id = p_step_id;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'backup.accepted',
    jsonb_build_object('volunteered', true)
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'backup_accepted', v_actor.id, jsonb_build_object('volunteered', true), v_audit_id
  );

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'volunteered',
    'approval_reset', false
  );
end;
$$;

comment on function public.volunteer_backup(uuid, uuid) is
  'Server-only. A Member volunteers as Backup_Owner when none is set (Requirement 5.17). Approval is unaffected.';

-- ---------------------------------------------------------------------------
-- 8.3 respond_to_request
-- ---------------------------------------------------------------------------
-- Only the receiver answers. Committed outcomes ('expired', and the
-- holder_changed decline) are returned as results so they are not rolled back.
create or replace function public.respond_to_request(
  p_request_id uuid,
  p_user_id uuid,
  p_accept boolean
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_request public.care_requests;
  v_step public.care_steps;
  v_chain public.care_chains;
  v_member public.household_members;
  v_role text;
  v_current uuid;
  v_event text;
  v_payload jsonb;
  v_audit_id uuid;
  v_reset boolean := false;
begin
  if p_accept is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- Lock order: care_steps first, then care_requests.
  select r.* into v_request from public.care_requests r where r.id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  select s.* into v_step from public.care_steps s where s.id = v_request.care_step_id for update;
  select r.* into v_request from public.care_requests r where r.id = p_request_id for update;
  select c.* into v_chain from public.care_chains c where c.id = v_request.care_chain_id;

  -- The receiver, active or not: an inactive receiver gets receiver_not_eligible.
  select m.* into v_member
  from public.household_members m
  where m.household_id = v_request.household_id and m.user_id = p_user_id;
  if not found or v_member.id <> v_request.to_member_id then
    raise exception 'request_not_found' using errcode = 'P0001';
  end if;
  if v_member.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'request_not_pending' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;

  v_role := case v_request.kind
    when 'assignment' then 'owner'
    when 'handover' then v_request.helper_role
    else null
  end;
  v_payload := jsonb_build_object('request_id', v_request.id);
  if v_role is not null then
    v_payload := v_payload || jsonb_build_object('role', v_role);
  end if;

  -- Decline
  if not p_accept then
    update public.care_requests
    set status = 'declined', resolved_at = now(), resolved_by = v_member.id
    where id = v_request.id;
    v_audit_id := private.write_audit(
      v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
      'human', p_user_id, v_request.kind || '.declined',
      jsonb_build_object('request_id', v_request.id)
    );
    perform private.add_feed_item(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      v_request.kind || '_declined', v_member.id,
      jsonb_build_object('request_id', v_request.id), v_audit_id
    );
    perform private.add_reminder(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      v_request.from_member_id, v_request.kind || '_declined'
    );
    return jsonb_build_object(
      'audit_event_id', v_audit_id, 'care_chain_id', v_chain.id, 'note_id', v_chain.note_id,
      'outcome', 'declined', 'approval_reset', false, 'request_id', v_request.id
    );
  end if;

  -- Accept after expiry: commit the expiry, never raise (Requirement 8.11).
  if now() >= v_request.expires_at then
    v_audit_id := private.close_care_request_expired(v_request, v_chain, p_user_id, v_member.id);
    return jsonb_build_object(
      'audit_event_id', v_audit_id, 'care_chain_id', v_chain.id, 'note_id', v_chain.note_id,
      'outcome', 'expired', 'approval_reset', false, 'request_id', v_request.id
    );
  end if;
  if not v_member.is_active then
    raise exception 'receiver_not_eligible' using errcode = 'P0001';
  end if;

  if v_request.kind = 'backup' then
    if v_step.owner_id is not null and v_step.owner_id = v_member.id then
      raise exception 'receiver_not_eligible' using errcode = 'P0001';
    end if;
    update public.care_steps set backup_owner_id = v_member.id where id = v_step.id;
  else
    v_current := case v_role
      when 'owner' then v_step.owner_id
      when 'driver' then v_step.driver_id
      else v_step.companion_id
    end;
    -- Requester no longer holds the role: close as declined by the system.
    if v_request.kind = 'handover' and v_current is distinct from v_request.from_member_id then
      update public.care_requests
      set status = 'declined', resolved_at = now(), resolved_by = v_member.id
      where id = v_request.id;
      v_audit_id := private.write_audit(
        v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
        'human', p_user_id, 'handover.declined',
        jsonb_build_object('request_id', v_request.id, 'reason', 'holder_changed')
      );
      perform private.add_feed_item(
        v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
        'handover_declined', v_member.id,
        jsonb_build_object('request_id', v_request.id), v_audit_id
      );
      perform private.add_reminder(
        v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
        v_request.from_member_id, 'handover_declined'
      );
      return jsonb_build_object(
        'audit_event_id', v_audit_id, 'care_chain_id', v_chain.id, 'note_id', v_chain.note_id,
        'outcome', 'declined', 'reason', 'holder_changed',
        'approval_reset', false, 'request_id', v_request.id
      );
    end if;
    -- An Owner cannot also be the Backup_Owner (table constraint).
    if v_role = 'owner' and v_step.backup_owner_id = v_member.id then
      raise exception 'receiver_not_eligible' using errcode = 'P0001';
    end if;
    update public.care_steps
    set owner_id = case when v_role = 'owner' then v_member.id else owner_id end,
        driver_id = case when v_role = 'driver' then v_member.id else driver_id end,
        companion_id = case when v_role = 'companion' then v_member.id else companion_id end,
        status = case
          when v_role = 'owner' and status = 'pending_review' then 'in_progress'
          else status
        end
    where id = v_step.id;
  end if;

  update public.care_requests
  set status = 'accepted', resolved_at = now(), resolved_by = v_member.id
  where id = v_request.id;

  v_event := v_request.kind || '.accepted';
  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, v_event, v_payload
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    v_request.kind || '_accepted', v_member.id,
    jsonb_build_object('request_id', v_request.id), v_audit_id
  );
  if v_role is not null and v_current is distinct from v_member.id then
    v_reset := private.apply_people_change(v_step.id, v_role, p_user_id);
  end if;

  return jsonb_build_object(
    'audit_event_id', v_audit_id, 'care_chain_id', v_chain.id, 'note_id', v_chain.note_id,
    'outcome', 'accepted', 'approval_reset', v_reset, 'request_id', v_request.id
  );
end;
$$;

comment on function public.respond_to_request(uuid, uuid, boolean) is
  'Server-only. The receiver accepts or declines a request. Accepting after expires_at commits the expiry and returns outcome expired.';

-- ---------------------------------------------------------------------------
-- 8.3 expire_care_requests
-- ---------------------------------------------------------------------------
-- Closes every pending request whose expires_at <= p_now (null household: all).
-- One transaction, Part lock before request lock. Returns how many it closed.
create or replace function public.expire_care_requests(
  p_household_id uuid default null,
  p_now timestamptz default now()
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_row record;
  v_request public.care_requests;
  v_chain public.care_chains;
  v_count integer := 0;
  v_step_id uuid;
begin
  for v_row in
    select r.id, r.care_step_id
    from public.care_requests r
    where r.status = 'pending'
      and r.expires_at <= coalesce(p_now, now())
      and (p_household_id is null or r.household_id = p_household_id)
    order by r.expires_at, r.id
  loop
    select s.id into v_step_id from public.care_steps s where s.id = v_row.care_step_id for update;
    select r.* into v_request from public.care_requests r where r.id = v_row.id for update;
    if v_step_id is null or v_request.status <> 'pending' then
      continue;
    end if;
    select c.* into v_chain from public.care_chains c where c.id = v_request.care_chain_id;
    perform private.close_care_request_expired(v_request, v_chain, null, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

comment on function public.expire_care_requests(uuid, timestamptz) is
  'Server-only. Closes pending requests past expires_at, writes expiry audit events and in-app reminders, leaves holders unchanged.';

-- ---------------------------------------------------------------------------
-- Privileges: service role only (repeatable)
-- ---------------------------------------------------------------------------
revoke all on function public.claim_part(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.release_part(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_part(uuid, uuid, text) to service_role;
grant execute on function public.release_part(uuid, uuid, text) to service_role;
revoke all on function private.iso_utc(timestamptz) from public, anon, authenticated;
revoke all on function private.create_care_request(public.care_steps, public.care_chains, public.household_members, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function private.close_care_request_expired(public.care_requests, public.care_chains, uuid, uuid) from public, anon, authenticated;
grant execute on function private.iso_utc(timestamptz) to service_role;
grant execute on function private.create_care_request(public.care_steps, public.care_chains, public.household_members, uuid, text, text, uuid) to service_role;
grant execute on function private.close_care_request_expired(public.care_requests, public.care_chains, uuid, uuid) to service_role;
revoke all on function public.request_assignment(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.request_handover(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.request_backup(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.volunteer_backup(uuid, uuid) from public, anon, authenticated;
revoke all on function public.respond_to_request(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.expire_care_requests(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.request_assignment(uuid, uuid, uuid) to service_role;
grant execute on function public.request_handover(uuid, uuid, text, uuid) to service_role;
grant execute on function public.request_backup(uuid, uuid, uuid) to service_role;
grant execute on function public.volunteer_backup(uuid, uuid) to service_role;
grant execute on function public.respond_to_request(uuid, uuid, boolean) to service_role;
grant execute on function public.expire_care_requests(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 8.4 decide_approval
-- ---------------------------------------------------------------------------
-- Mirrors decideApproval in src/lib/care/rules/approval.ts. The actor's active
-- status, role, and the count of active Primary_Caregivers are read here, at
-- processing time, under the care_steps row lock (Requirement 9.14).
-- Refusal order: part_not_found, recipient_read_only, not_primary_caregiver,
-- approval_not_required, then for approve: resubmission_required,
-- self_approval_blocked; part_closed is checked last. Progress status is never
-- touched (Requirement 9.8).
create or replace function public.decide_approval(
  p_step_id uuid,
  p_user_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_state text;
  v_is_owner boolean;
  v_self boolean := false;
  v_audit_id uuid;
begin
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'primary_caregiver' then
    raise exception 'not_primary_caregiver' using errcode = 'P0001';
  end if;
  v_state := private.effective_approval_state(v_step);
  if v_state = 'not_required' then
    raise exception 'approval_not_required' using errcode = 'P0001';
  end if;

  if p_decision = 'approve' then
    if v_state = 'rejected' then
      raise exception 'resubmission_required' using errcode = 'P0001';
    end if;
    v_is_owner := v_step.owner_id is not null and v_step.owner_id = v_actor.id;
    if v_is_owner and private.active_primary_count(v_chain.household_id) >= 2 then
      raise exception 'self_approval_blocked' using errcode = 'P0001';
    end if;
    v_self := v_is_owner;
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;

  if p_decision = 'approve' then
    update public.care_steps
    set approval_state = 'approved',
        approval_decided_by = v_actor.id,
        approval_decided_at = now()
    where id = p_step_id;
    v_audit_id := private.write_audit(
      v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
      'human', p_user_id, 'approval.given',
      jsonb_build_object('self_approval', v_self)
    );
    perform private.add_feed_item(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      'approval_given', v_actor.id,
      jsonb_build_object('self_approval', v_self), v_audit_id
    );
  else
    update public.care_steps
    set approval_state = 'rejected',
        approval_decided_by = v_actor.id,
        approval_decided_at = now(),
        rejected_at_plan_version = plan_version
    where id = p_step_id;
    v_audit_id := private.write_audit(
      v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
      'human', p_user_id, 'approval.rejected',
      jsonb_build_object('plan_version', v_step.plan_version)
    );
    perform private.add_feed_item(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      'approval_rejected', v_actor.id, '{}'::jsonb, v_audit_id
    );
  end if;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'approval_state', case when p_decision = 'approve' then 'approved' else 'rejected' end,
    'self_approval', v_self
  );
end;
$$;

comment on function public.decide_approval(uuid, uuid, text) is
  'Server-only. An active Primary_Caregiver approves or rejects a Part. Self-approval only for the Owner when exactly one Primary_Caregiver is active. Progress status is untouched.';

-- ---------------------------------------------------------------------------
-- 8.4 resubmit_part
-- ---------------------------------------------------------------------------
-- Mirrors canResubmit. Owner only, state must be rejected, and the request
-- needs a non-blank explanation, new Evidence (ids of this Part added since the
-- rejection), or a changed plan (plan_version > rejected_at_plan_version).
-- The explanation text stays in part_resubmissions; the audit payload names only
-- which kinds were added and the evidence count.
create or replace function public.resubmit_part(
  p_step_id uuid,
  p_user_id uuid,
  p_explanation text default null,
  p_evidence_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  -- Trim all whitespace (tabs and newlines too), like String.trim().
  v_explanation text := nullif(
    regexp_replace(coalesce(p_explanation, ''), '^\s+|\s+$', '', 'g'), ''
  );
  v_ids uuid[] := coalesce(p_evidence_ids, '{}');
  v_valid integer;
  v_plan_changed boolean;
  v_added jsonb := '[]'::jsonb;
  v_resubmission_id uuid;
  v_audit_id uuid;
  v_primary record;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_step.owner_id is null or v_step.owner_id <> v_actor.id then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  if private.effective_approval_state(v_step) <> 'rejected' then
    raise exception 'not_rejected' using errcode = 'P0001';
  end if;

  if v_explanation is not null and length(v_explanation) > 1000 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  -- Evidence ids must be distinct items of this Part added since the rejection.
  select count(distinct e.id)::integer into v_valid
  from public.part_evidence e
  where e.id = any (v_ids)
    and e.care_step_id = v_step.id
    and (v_step.approval_decided_at is null or e.created_at >= v_step.approval_decided_at);
  if v_valid <> (select count(distinct x)::integer from unnest(v_ids) as x) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_ids := coalesce(array(select distinct x from unnest(v_ids) as x order by x), '{}');

  v_plan_changed := v_step.rejected_at_plan_version is not null
    and v_step.plan_version > v_step.rejected_at_plan_version;
  if v_explanation is null and cardinality(v_ids) = 0 and not v_plan_changed then
    raise exception 'resubmission_empty' using errcode = 'P0001';
  end if;

  insert into public.part_resubmissions (
    household_id, care_chain_id, care_step_id, submitted_by,
    explanation, evidence_ids, plan_changed
  )
  values (
    v_chain.household_id, v_chain.id, v_step.id, v_actor.id,
    v_explanation, v_ids, v_plan_changed
  )
  returning id into v_resubmission_id;

  update public.care_steps set approval_state = 'pending' where id = p_step_id;

  if v_explanation is not null then
    v_added := v_added || to_jsonb('explanation'::text);
  end if;
  if cardinality(v_ids) > 0 then
    v_added := v_added || to_jsonb('evidence'::text);
  end if;
  if v_plan_changed then
    v_added := v_added || to_jsonb('changed_plan'::text);
  end if;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'approval.resubmitted',
    jsonb_build_object(
      'resubmission_id', v_resubmission_id,
      'added', v_added,
      'evidence_count', cardinality(v_ids)
    )
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'approval_resubmitted', v_actor.id,
    jsonb_build_object('added', v_added), v_audit_id
  );
  for v_primary in
    select m.id
    from public.household_members m
    where m.household_id = v_chain.household_id
      and m.role = 'primary_caregiver'
      and m.is_active
    order by m.created_at, m.id
  loop
    perform private.add_reminder(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      v_primary.id, 'approval_resubmitted'
    );
  end loop;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'resubmitted',
    'approval_state', 'pending',
    'resubmission_id', v_resubmission_id,
    'added', v_added
  );
end;
$$;

comment on function public.resubmit_part(uuid, uuid, text, uuid[]) is
  'Server-only. The Owner resubmits a rejected Part with an explanation, new Evidence, or a changed plan. Explanation text is stored only in part_resubmissions.';

revoke all on function public.decide_approval(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.resubmit_part(uuid, uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.decide_approval(uuid, uuid, text) to service_role;
grant execute on function public.resubmit_part(uuid, uuid, text, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 8.5 complete_part
-- ---------------------------------------------------------------------------
-- Mirrors decideCompletion in src/lib/care/rules/completion.ts.
-- Refusal order: part_not_found, recipient_read_only, part_closed (completed,
-- cancelled, or failed), not_owner, approval_pending. The Approval_State is
-- checked, never the Progress_Status, so `evidence_required` and `escalated`
-- never lock an approved Part. Missing required Evidence is a committed RESULT:
-- the status becomes `evidence_required`, `part.evidence_missing` is written,
-- and the function returns outcome 'evidence_required' with the missing labels.
-- Approval_State is never changed here.
create or replace function public.complete_part(
  p_step_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_state text;
  v_missing jsonb;
  v_audit_id uuid;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_step.status in ('completed', 'cancelled', 'failed') then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if v_step.owner_id is null or v_step.owner_id <> v_actor.id then
    raise exception 'not_owner' using errcode = 'P0001';
  end if;
  v_state := private.effective_approval_state(v_step);
  if (v_step.approval_required and v_state <> 'approved')
     or (private.is_high_risk(v_step) and v_state in ('pending', 'rejected')) then
    raise exception 'approval_pending' using errcode = 'P0001';
  end if;

  -- Required labels with no attached item, in the order required.
  select coalesce(jsonb_agg(to_jsonb(r.label) order by r.ord), '[]'::jsonb)
  into v_missing
  from unnest(v_step.evidence_required) with ordinality as r(label, ord)
  where not exists (
    select 1 from public.part_evidence e
    where e.care_step_id = v_step.id and e.label = r.label
  );

  if jsonb_array_length(v_missing) > 0 then
    update public.care_steps set status = 'evidence_required' where id = p_step_id;
    v_audit_id := private.write_audit(
      v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
      'human', p_user_id, 'part.evidence_missing',
      jsonb_build_object('missing_count', jsonb_array_length(v_missing))
    );
    perform private.add_feed_item(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      'evidence_missing', v_actor.id,
      jsonb_build_object('missing_count', jsonb_array_length(v_missing)), v_audit_id
    );
    return jsonb_build_object(
      'audit_event_id', v_audit_id,
      'care_chain_id', v_chain.id,
      'note_id', v_chain.note_id,
      'outcome', 'evidence_required',
      'approval_reset', false,
      'missing', v_missing
    );
  end if;

  update public.care_steps set status = 'completed' where id = p_step_id;
  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'part.completed', '{}'::jsonb
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'completed', v_actor.id, '{}'::jsonb, v_audit_id
  );
  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'completed',
    'approval_reset', false
  );
end;
$$;

comment on function public.complete_part(uuid, uuid) is
  'Server-only. The Owner completes an approved Part. Missing required Evidence commits status evidence_required and returns outcome evidence_required with the missing labels.';

-- ---------------------------------------------------------------------------
-- 8.5 report_part_failed
-- ---------------------------------------------------------------------------
-- Mirrors decideFailure. Owner, Driver, or Companion. Order: part_not_found,
-- recipient_read_only, part_closed, not_holder, invalid_input (reason code).
create or replace function public.report_part_failed(
  p_step_id uuid,
  p_user_id uuid,
  p_reason_code text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_audit_id uuid;
  v_primary record;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_step.status in ('completed', 'cancelled', 'failed') then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if v_actor.id is distinct from v_step.owner_id
     and v_actor.id is distinct from v_step.driver_id
     and v_actor.id is distinct from v_step.companion_id then
    raise exception 'not_holder' using errcode = 'P0001';
  end if;
  -- The reason is a short code, never free text (audit payloads hold codes only).
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,59}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  update public.care_steps set status = 'failed' where id = p_step_id;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'part.failed',
    jsonb_build_object('reason_code', p_reason_code)
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'part_failed', v_actor.id,
    jsonb_build_object('reason_code', p_reason_code, 'needs_attention', true), v_audit_id
  );
  for v_primary in
    select m.id
    from public.household_members m
    where m.household_id = v_chain.household_id
      and m.role = 'primary_caregiver'
      and m.is_active
    order by m.created_at, m.id
  loop
    perform private.add_reminder(
      v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
      v_primary.id, 'part_failed'
    );
  end loop;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'failed',
    'approval_reset', false
  );
end;
$$;

comment on function public.report_part_failed(uuid, uuid, text) is
  'Server-only. The Owner, Driver, or Companion reports that a Part could not be done. Sets status failed and reminds active Primary_Caregivers.';

-- ---------------------------------------------------------------------------
-- 8.5 reopen_part
-- ---------------------------------------------------------------------------
-- Mirrors decideReopen and D-2. Order: part_not_found, recipient_read_only,
-- not_failed, not_allowed_reopen. status becomes in_progress; approval_state and
-- the step_escalations ledger are untouched (D-3: an old deadline is not
-- escalated again).
create or replace function public.reopen_part(
  p_step_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_audit_id uuid;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_step.status <> 'failed' then
    raise exception 'not_failed' using errcode = 'P0001';
  end if;
  if not private.may_reopen_or_request_backup(v_actor, v_step) then
    raise exception 'not_allowed_reopen' using errcode = 'P0001';
  end if;

  update public.care_steps set status = 'in_progress' where id = p_step_id;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'part.reopened', '{}'::jsonb
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'part_reopened', v_actor.id, '{}'::jsonb, v_audit_id
  );
  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'reopened',
    'approval_reset', false
  );
end;
$$;

comment on function public.reopen_part(uuid, uuid) is
  'Server-only. The Owner or an active Primary_Caregiver reopens a failed Part (D-2). Approval_State and the escalation ledger are unchanged.';

-- ---------------------------------------------------------------------------
-- 8.5 record_evidence
-- ---------------------------------------------------------------------------
-- Mirrors Model.recordEvidence. Order: part_not_found, recipient_read_only,
-- not_holder (Owner, Driver, or Companion), invalid_input. Text and storage
-- path live only in part_evidence; the audit payload names the kind and the
-- evidence id. Photo and file paths must be
-- {household_id}/{step_id}/{epoch_ms}-evidence.{jpg|png|webp|pdf}.
-- Status is not changed: complete_part decides what the Evidence satisfies.
create or replace function public.record_evidence(
  p_step_id uuid,
  p_user_id uuid,
  p_label text,
  p_kind text,
  p_storage_path text default null,
  p_text text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_label text := regexp_replace(coalesce(p_label, ''), '^\s+|\s+$', '', 'g');
  v_evidence_id uuid;
  v_audit_id uuid;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_actor.id is distinct from v_step.owner_id
     and v_actor.id is distinct from v_step.driver_id
     and v_actor.id is distinct from v_step.companion_id then
    raise exception 'not_holder' using errcode = 'P0001';
  end if;

  if length(v_label) not between 1 and 200
     or p_kind is null or p_kind not in ('photo', 'file', 'text') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if p_kind = 'text' then
    if p_storage_path is not null
       or p_text is null
       or length(regexp_replace(p_text, '^\s+|\s+$', '', 'g')) not between 1 and 2000 then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
  else
    if p_text is not null
       or p_storage_path is null
       or p_storage_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]{13}-evidence\.(jpg|png|webp|pdf)$'
       or not starts_with(
         p_storage_path, v_chain.household_id::text || '/' || v_step.id::text || '/'
       ) then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.part_evidence (
      household_id, care_chain_id, care_step_id, label, kind,
      storage_path, text_body, added_by
    )
    values (
      v_chain.household_id, v_chain.id, v_step.id, v_label, p_kind,
      p_storage_path, p_text, v_actor.id
    )
    returning id into v_evidence_id;
  exception when unique_violation then
    raise exception 'invalid_input' using errcode = 'P0001';
  end;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'evidence.uploaded',
    jsonb_build_object('kind', p_kind, 'evidence_id', v_evidence_id)
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'evidence_added', v_actor.id, jsonb_build_object('kind', p_kind), v_audit_id
  );
  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'recorded',
    'approval_reset', false,
    'evidence_id', v_evidence_id
  );
end;
$$;

comment on function public.record_evidence(uuid, uuid, text, text, text, text) is
  'Server-only. The Owner, Driver, or Companion attaches photo, file, or text Evidence. Text and path are stored only in part_evidence, never in the audit payload.';

revoke all on function public.complete_part(uuid, uuid) from public, anon, authenticated;
revoke all on function public.report_part_failed(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.reopen_part(uuid, uuid) from public, anon, authenticated;
revoke all on function public.record_evidence(uuid, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.complete_part(uuid, uuid) to service_role;
grant execute on function public.report_part_failed(uuid, uuid, text) to service_role;
grant execute on function public.reopen_part(uuid, uuid) to service_role;
grant execute on function public.record_evidence(uuid, uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8.6 Part details: times, amounts, Missing_Details, feed marker, language
-- ---------------------------------------------------------------------------
-- Contents: confirm_part_time, save_part_amount, resolve_missing_detail,
-- mark_feed_seen, set_member_language, and a replaced
-- save_appointment_clarification (same signature, same old refusal codes).
--
-- Key_Facts (Requirements 9.9, 9.24) are the appointment location, the
-- appointment time, and the required amount. A change to one of them on an
-- approved High_Risk_Part resets approval through private.apply_key_fact_change.
-- Task_Due_Time and Respond_By_Time are NOT Key_Facts; confirming them never
-- resets approval. Audit payloads hold codes, IDs, ISO times, zone names, and
-- flags. Amounts, answers, and locations stay in the tables.
--
-- appointment_time has no provenance column. Only humans write it (this file's
-- confirm_part_time and save_appointment_clarification), so a stored appointment
-- time is a human_confirmed time by construction. The AI draft never writes it.

-- ---------------------------------------------------------------------------
-- 8.6 confirm_part_time
-- ---------------------------------------------------------------------------
-- p_kind: 'appointment' (appointment_time + appointment_timezone, appointment
-- Parts only, a Key_Fact), 'respond_by' (respond_by_*), or 'task_due'
-- (task_due_*). respond_by_* and task_due_* are written as a group with
-- provenance 'human_confirmed' and *_set_by = the actor's Member id. A new value
-- replaces the old one, whatever its provenance; a model_suggested value is
-- never counted as confirmed.
-- DEFAULT (pending confirmation): any active non-recipient household Member may
-- confirm a time. The design does not name a narrower role.
-- Order: part_not_found, recipient_read_only, part_closed, invalid_input.
-- invalid_input: unknown kind, missing time, unknown IANA zone (checked against
-- pg_timezone_names), time outside 2000-01-01 to 2100-12-31 UTC, or kind
-- 'appointment' on a Part that is not an appointment.
-- One time.confirmed audit event {kind, timezone, at, member_id}; one household
-- Feed_Item: kind missing_detail_resolved when the call supplies the first
-- confirmed time (appointment time was empty, or a High_Risk_Part had no
-- human_confirmed Respond_By/Task_Due time), otherwise time_confirmed.
create or replace function public.confirm_part_time(
  p_step_id uuid,
  p_user_id uuid,
  p_kind text,
  p_at timestamptz,
  p_timezone text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_resolves boolean;
  v_changed boolean := false;
  v_audit_id uuid;
  v_reset boolean := false;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('appointment', 'respond_by', 'task_due')
     or p_at is null
     or p_timezone is null
     or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone)
     or p_at < timestamptz '2000-01-01 00:00:00+00'
     or p_at >= timestamptz '2101-01-01 00:00:00+00'
     or (p_kind = 'appointment' and v_step.care_category <> 'appointment') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  if p_kind = 'appointment' then
    v_resolves := v_step.appointment_time is null;
    v_changed := v_step.appointment_time is distinct from p_at;
    update public.care_steps
    set appointment_time = p_at, appointment_timezone = p_timezone
    where id = p_step_id;
  else
    v_resolves := private.is_high_risk(v_step)
      and v_step.respond_by_provenance is distinct from 'human_confirmed'
      and v_step.task_due_provenance is distinct from 'human_confirmed';
    if p_kind = 'respond_by' then
      update public.care_steps
      set respond_by_at = p_at, respond_by_timezone = p_timezone,
          respond_by_provenance = 'human_confirmed', respond_by_set_by = v_actor.id
      where id = p_step_id;
    else
      update public.care_steps
      set task_due_at = p_at, task_due_timezone = p_timezone,
          task_due_provenance = 'human_confirmed', task_due_set_by = v_actor.id
      where id = p_step_id;
    end if;
  end if;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'time.confirmed',
    jsonb_build_object(
      'kind', p_kind,
      'timezone', p_timezone,
      'at', private.iso_utc(p_at),
      'member_id', v_actor.id
    )
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    case when v_resolves then 'missing_detail_resolved' else 'time_confirmed' end,
    v_actor.id, jsonb_build_object('kind', p_kind), v_audit_id
  );
  if p_kind = 'appointment' and v_changed then
    v_reset := private.apply_key_fact_change(p_step_id, 'appointment_time', p_user_id);
  end if;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'confirmed',
    'approval_reset', v_reset
  );
end;
$$;

comment on function public.confirm_part_time(uuid, uuid, text, timestamptz, text) is
  'Server-only. A Member confirms an appointment, Respond_By, or Task_Due time (human_confirmed, set_by = Member). An appointment time is a Key_Fact change.';

-- ---------------------------------------------------------------------------
-- 8.6 save_part_amount
-- ---------------------------------------------------------------------------
-- The required amount of a payment Part, in minor units, with an ISO 4217-shaped
-- currency code (three capital letters, not looked up). A Key_Fact: when the
-- amount or currency changes on an approved High_Risk_Part, approval resets.
-- Order: part_not_found, recipient_read_only, part_closed, invalid_input
-- (not a payment Part, negative amount, bad currency).
-- Audit missing_detail.resolved {kind: 'amount', changed}: the amount is never
-- in the payload.
create or replace function public.save_part_amount(
  p_step_id uuid,
  p_user_id uuid,
  p_amount_minor bigint,
  p_currency text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_actor public.household_members;
  v_changed boolean;
  v_audit_id uuid;
  v_reset boolean := false;
begin
  select s.* into v_step from public.care_steps s where s.id = p_step_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if v_step.care_category <> 'payment'
     or p_amount_minor is null or p_amount_minor < 0
     or p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_changed := v_step.required_amount_minor is distinct from p_amount_minor
    or v_step.amount_currency is distinct from p_currency;
  update public.care_steps
  set required_amount_minor = p_amount_minor, amount_currency = p_currency
  where id = p_step_id;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'missing_detail.resolved',
    jsonb_build_object('kind', 'amount', 'changed', v_changed)
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'missing_detail_resolved', v_actor.id, jsonb_build_object('kind', 'amount'), v_audit_id
  );
  if v_changed then
    v_reset := private.apply_key_fact_change(p_step_id, 'amount', p_user_id);
  end if;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'saved',
    'approval_reset', v_reset
  );
end;
$$;

comment on function public.save_part_amount(uuid, uuid, bigint, text) is
  'Server-only. A Member saves the required amount of a payment Part. A Key_Fact change. The amount is never written to audit payloads.';

-- ---------------------------------------------------------------------------
-- 8.6 resolve_missing_detail
-- ---------------------------------------------------------------------------
-- A Member answers one stored Missing_Detail. The answer text stays in
-- part_missing_details; the audit payload holds the kind and detail id only.
-- A Person_To_Ask answer is text and never becomes an Owner. A 'location'
-- answer (1 to 200 characters) is also written to appointment_location through
-- the Key_Fact path. 'time' and 'amount' details are refused with
-- invalid_input: a time is cleared only by confirm_part_time (a typed answer
-- never counts, see missing-details.ts) and an amount only by save_part_amount,
-- so a typed value is never taken as a confirmed critical detail.
-- Order: part_not_found (also for another household), recipient_read_only,
-- part_closed, invalid_input (blank or over 500 characters, kind time/amount,
-- already resolved).
create or replace function public.resolve_missing_detail(
  p_detail_id uuid,
  p_user_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step_id uuid;
  v_step public.care_steps;
  v_chain public.care_chains;
  v_detail public.part_missing_details;
  v_actor public.household_members;
  v_answer text := regexp_replace(coalesce(p_answer, ''), '^\s+|\s+$', '', 'g');
  v_changed boolean := false;
  v_audit_id uuid;
  v_reset boolean := false;
begin
  -- Lock order: care_steps first, as everywhere else.
  select d.care_step_id into v_step_id
  from public.part_missing_details d where d.id = p_detail_id;
  if v_step_id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select s.* into v_step from public.care_steps s where s.id = v_step_id for update;
  select d.* into v_detail from public.part_missing_details d where d.id = p_detail_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_actor := private.actor_member(v_chain.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;
  if length(v_answer) not between 1 and 500
     or v_detail.resolved_at is not null
     or v_detail.kind in ('time', 'amount')
     or (v_detail.kind = 'location' and length(v_answer) > 200) then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  update public.part_missing_details
  set resolved_at = now(), resolved_by = v_actor.id, answer = v_answer
  where id = p_detail_id;

  if v_detail.kind = 'location' then
    v_changed := v_step.appointment_location is distinct from v_answer;
    update public.care_steps set appointment_location = v_answer where id = v_step_id;
  end if;

  v_audit_id := private.write_audit(
    v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'missing_detail.resolved',
    jsonb_build_object('kind', v_detail.kind, 'detail_id', v_detail.id)
  );
  perform private.add_feed_item(
    v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
    'missing_detail_resolved', v_actor.id, jsonb_build_object('kind', v_detail.kind), v_audit_id
  );
  if v_changed then
    v_reset := private.apply_key_fact_change(v_step_id, 'location', p_user_id);
  end if;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_chain.id,
    'note_id', v_chain.note_id,
    'outcome', 'resolved',
    'approval_reset', v_reset
  );
end;
$$;

comment on function public.resolve_missing_detail(uuid, uuid, text) is
  'Server-only. A Member answers a stored Missing_Detail. The answer stays in part_missing_details. A location answer is a Key_Fact change.';

-- ---------------------------------------------------------------------------
-- 8.6 mark_feed_seen
-- ---------------------------------------------------------------------------
-- Moves the Member's "seen up to" marker forward (never back, never into the
-- future) and stamps seen_at on the In_App_Reminders addressed to the Member
-- that were created at or before that time. Any active Member may call it,
-- including the Care_Recipient: it is a read marker.
-- No audit event: opening the feed changes no care record, decision, or
-- responsibility, and an event per page view would bury the real trail.
-- Refusal: part_not_found when the caller is not an active Member of the household.
create or replace function public.mark_feed_seen(
  p_household_id uuid,
  p_user_id uuid,
  p_seen_at timestamptz default now()
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor public.household_members;
  v_seen timestamptz := least(coalesce(p_seen_at, now()), clock_timestamp());
begin
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;

  insert into public.member_feed_state (member_id, household_id, last_seen_at)
  values (v_actor.id, p_household_id, v_seen)
  on conflict (member_id) do update
  set last_seen_at = greatest(public.member_feed_state.last_seen_at, excluded.last_seen_at);

  update public.feed_items
  set seen_at = v_seen
  where household_id = p_household_id
    and recipient_member_id = v_actor.id
    and seen_at is null
    and created_at <= v_seen;
end;
$$;

comment on function public.mark_feed_seen(uuid, uuid, timestamptz) is
  'Server-only. Moves the Member feed marker forward and marks addressed reminders seen. Writes no audit event: it is a read marker.';

-- ---------------------------------------------------------------------------
-- 8.6 set_member_language
-- ---------------------------------------------------------------------------
-- Sets the Member's own display language ('en' or 'ja') in one household.
-- Order: part_not_found (not an active Member), invalid_input (other language).
-- A call that does not change the language writes nothing. A change writes one
-- member.language_changed audit event whose payload is the language only.
create or replace function public.set_member_language(
  p_user_id uuid,
  p_household_id uuid,
  p_language text
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_actor public.household_members;
begin
  v_actor := private.actor_member(p_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if p_language is null or p_language not in ('en', 'ja') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  if v_actor.ui_language is not distinct from p_language then
    return;
  end if;

  update public.household_members set ui_language = p_language where id = v_actor.id;
  perform private.write_audit(
    p_household_id, null, null, null,
    'human', p_user_id, 'member.language_changed',
    jsonb_build_object('language', p_language)
  );
end;
$$;

comment on function public.set_member_language(uuid, uuid, text) is
  'Server-only. A Member sets their own display language (en or ja). Audited with the language only.';

-- ---------------------------------------------------------------------------
-- 8.6 save_appointment_clarification (replaced)
-- ---------------------------------------------------------------------------
-- Same signature, same old refusal codes (step_not_found, not_allowed,
-- not_appointment, invalid_input), same appointment_clarified payload, so the
-- existing page keeps working. New: recipient_read_only, part_closed, note_id on
-- the audit event, one household Feed_Item, and a Key_Fact change for the
-- location and for the appointment time when each value changes. The saved
-- time is a human-entered (human_confirmed) time; see the header of 8.6.
-- Return keeps audit_event_id and care_chain_id and adds note_id, outcome, and
-- approval_reset.
create or replace function public.save_appointment_clarification(
  p_step_id uuid,
  p_user_id uuid,
  p_location text,
  p_appointment_time timestamptz,
  p_timezone text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_step public.care_steps;
  v_chain public.care_chains;
  v_household_id uuid;
  v_actor public.household_members;
  v_location text := btrim(p_location);
  v_audit_id uuid;
  v_reset boolean := false;
  v_reset_time boolean := false;
  v_location_changed boolean;
  v_time_changed boolean;
begin
  select s.* into v_step
  from public.care_steps s
  where s.id = p_step_id
  for update;

  if not found then
    raise exception 'step_not_found' using errcode = 'P0001';
  end if;

  select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;
  v_household_id := v_chain.household_id;

  -- Membership is checked here, inside the same transaction as the write.
  v_actor := private.actor_member(v_household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_actor.role = 'care_recipient' then
    raise exception 'recipient_read_only' using errcode = 'P0001';
  end if;
  if v_step.care_category <> 'appointment' then
    raise exception 'not_appointment' using errcode = 'P0001';
  end if;
  if private.is_part_closed(v_step) then
    raise exception 'part_closed' using errcode = 'P0001';
  end if;

  if v_location is null
    or length(v_location) = 0
    or length(v_location) > 200
    or p_appointment_time is null
    or p_timezone is null
    or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_timezone)
  then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_location_changed := v_step.appointment_location is distinct from v_location;
  v_time_changed := v_step.appointment_time is distinct from p_appointment_time;

  update public.care_steps
  set appointment_location = v_location,
      appointment_time = p_appointment_time,
      appointment_timezone = p_timezone
  where id = p_step_id;

  v_audit_id := private.write_audit(
    v_household_id, v_step.care_chain_id, v_step.id, v_chain.note_id,
    'human', p_user_id, 'appointment_clarified',
    jsonb_build_object(
      'location', v_location,
      'appointment_time', to_char(p_appointment_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'timezone', p_timezone,
      'clarified_by', p_user_id,
      'clarified_by_member_id', v_actor.id,
      -- Corrections keep what was there before, so nothing is silently lost.
      'previous', case
        when v_step.appointment_location is null and v_step.appointment_time is null then null
        else jsonb_build_object(
          'location', v_step.appointment_location,
          'appointment_time', to_char(v_step.appointment_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
          'timezone', v_step.appointment_timezone
        )
      end
    )
  );
  perform private.add_feed_item(
    v_household_id, v_chain.note_id, v_step.care_chain_id, v_step.id,
    'appointment_clarified', v_actor.id, '{}'::jsonb, v_audit_id
  );

  if v_location_changed then
    v_reset := private.apply_key_fact_change(p_step_id, 'location', p_user_id);
  end if;
  if v_time_changed then
    v_reset_time := private.apply_key_fact_change(p_step_id, 'appointment_time', p_user_id);
  end if;

  return jsonb_build_object(
    'audit_event_id', v_audit_id,
    'care_chain_id', v_step.care_chain_id,
    'note_id', v_chain.note_id,
    'outcome', 'saved',
    'approval_reset', v_reset or v_reset_time
  );
end;
$$;

comment on function public.save_appointment_clarification(uuid, uuid, text, timestamptz, text) is
  'Server-only. Saves human-provided appointment location/time/zone and its appointment_clarified audit event in one transaction. Location and time are Key_Facts: a change resets approval of an approved High_Risk_Part.';

-- ---------------------------------------------------------------------------
-- 8.6 privileges: service role only
-- ---------------------------------------------------------------------------
revoke all on function public.confirm_part_time(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.save_part_amount(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.resolve_missing_detail(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_feed_seen(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.set_member_language(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_appointment_clarification(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.confirm_part_time(uuid, uuid, text, timestamptz, text) to service_role;
grant execute on function public.save_part_amount(uuid, uuid, bigint, text) to service_role;
grant execute on function public.resolve_missing_detail(uuid, uuid, text) to service_role;
grant execute on function public.mark_feed_seen(uuid, uuid, timestamptz) to service_role;
grant execute on function public.set_member_language(uuid, uuid, text) to service_role;
grant execute on function public.save_appointment_clarification(uuid, uuid, text, timestamptz, text)
  to service_role;
