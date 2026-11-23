-- Fudepan: save human-provided appointment details atomically.
--
-- Additive only. Builds on the columns from 20261201000000 (already applied):
--   * two integrity checks on those columns;
--   * public.save_appointment_clarification(), which, in one transaction,
--       1. locks the step,
--       2. checks the person is an active member of the step's household,
--       3. checks the step is an appointment step and the input is valid,
--       4. writes appointment_location / appointment_time / appointment_timezone,
--       5. writes one `appointment_clarified` audit event.
--     Either both the step change and the audit event commit, or neither does.
--
-- The function never touches due_at (family deadline), escalation_at,
-- status, approval_required, or source_quote (the original note quote), so the
-- approval gate and the AI extraction stay exactly as they were.
--
-- Called only by server code with the service role. p_user_id is the verified
-- signed-in user from the session. Browser roles cannot execute it.

-- ---------------------------------------------------------------------------
-- Integrity checks on the appointment columns (all rows are null today)
-- ---------------------------------------------------------------------------
alter table public.care_steps
  add constraint care_steps_appointment_location_valid check (
    appointment_location is null
    or length(btrim(appointment_location)) between 1 and 200
  ),
  -- An appointment instant is only meaningful with the time zone it was given in.
  add constraint care_steps_appointment_time_has_zone check (
    (appointment_time is null) = (appointment_timezone is null)
  );

-- ---------------------------------------------------------------------------
-- Save appointment details + audit event
-- ---------------------------------------------------------------------------
create function public.save_appointment_clarification(
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
  v_household_id uuid;
  v_member_id uuid;
  v_location text := btrim(p_location);
  v_audit_id uuid;
begin
  select s.* into v_step
  from public.care_steps s
  where s.id = p_step_id
  for update;

  if not found then
    raise exception 'step_not_found' using errcode = 'P0001';
  end if;

  select c.household_id into v_household_id
  from public.care_chains c
  where c.id = v_step.care_chain_id;

  -- Membership is checked here, inside the same transaction as the write.
  select m.id into v_member_id
  from public.household_members m
  where m.household_id = v_household_id
    and m.user_id = p_user_id
    and m.is_active;

  if v_member_id is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if v_step.care_category <> 'appointment' then
    raise exception 'not_appointment' using errcode = 'P0001';
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

  update public.care_steps
  set appointment_location = v_location,
      appointment_time = p_appointment_time,
      appointment_timezone = p_timezone
  where id = p_step_id;

  insert into public.audit_events (
    household_id, care_chain_id, care_step_id, actor_type, actor_id, event_type, payload
  )
  values (
    v_household_id,
    v_step.care_chain_id,
    v_step.id,
    'human',
    p_user_id,
    'appointment_clarified',
    jsonb_build_object(
      'location', v_location,
      'appointment_time', to_char(p_appointment_time at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'timezone', p_timezone,
      'clarified_by', p_user_id,
      'clarified_by_member_id', v_member_id,
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
  )
  returning id into v_audit_id;

  return jsonb_build_object('audit_event_id', v_audit_id, 'care_chain_id', v_step.care_chain_id);
end;
$$;

comment on function public.save_appointment_clarification(uuid, uuid, text, timestamptz, text) is
  'Server-only. Saves human-provided appointment location/time/zone and its appointment_clarified audit event in one transaction.';

revoke all on function public.save_appointment_clarification(uuid, uuid, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.save_appointment_clarification(uuid, uuid, text, timestamptz, text)
  to service_role;
