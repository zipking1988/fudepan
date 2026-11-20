-- Fudepan Phase 4: task workflow. Tasks change only through the functions below (service role,
-- called from server code). A trigger enforces the transition rules for every writer, including
-- the service role, so no API route can bypass the approval requirement.

-- 1. Browsers can read tasks but not write them.
drop policy tasks_insert on public.tasks;
drop policy tasks_update on public.tasks;
revoke insert, update on public.tasks from authenticated;

-- 2. Browsers may only insert audit events written during note ingestion. Workflow events
--    (approvals, claims, and so on) are written by the functions below.
drop policy audit_events_insert on public.audit_events;
create policy audit_events_insert on public.audit_events
  for insert to authenticated
  with check (
    public.is_household_member(household_id)
    and actor_id = (select auth.uid())
    and event_type in ('note_created', 'task_extracted')
  );

-- 3. Transition rules, enforced for every writer.
create or replace function public.enforce_task_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'new tasks must be drafts';
    end if;
    if new.approved_by is not null then
      raise exception 'new tasks cannot be pre-approved';
    end if;
    return new;
  end if;

  if new.household_id <> old.household_id or new.note_id is distinct from old.note_id then
    raise exception 'task household and note cannot change';
  end if;
  if old.status in ('completed', 'cancelled', 'rejected') then
    raise exception 'task is closed';
  end if;

  if new.status <> old.status then
    if not ((old.status, new.status) in (
      ('draft', 'awaiting_confirmation'), ('draft', 'confirmed'), ('draft', 'cancelled'),
      ('awaiting_confirmation', 'confirmed'), ('awaiting_confirmation', 'rejected'),
      ('awaiting_confirmation', 'cancelled'),
      ('confirmed', 'completed'), ('confirmed', 'cancelled')
    )) then
      raise exception 'invalid status transition % to %', old.status, new.status;
    end if;

    if new.status = 'confirmed' then
      if new.approved_by is null then
        raise exception 'approval requires an approver';
      end if;
      select role into v_role from public.members
        where id = new.approved_by and household_id = new.household_id;
      if v_role is null or v_role not in ('caregiver', 'coordinator') then
        raise exception 'approver must be a caregiver or coordinator';
      end if;
      if old.status = 'draft' and new.risk_level <> 'low' then
        raise exception 'only low-risk drafts can be confirmed without awaiting confirmation';
      end if;
    end if;
  end if;

  if new.approved_by is distinct from old.approved_by
     and not (new.status = 'confirmed' and old.status <> 'confirmed') then
    raise exception 'approver can only be set when a task is approved';
  end if;

  if old.status = 'confirmed' and new.status = 'confirmed' and (
    new.title is distinct from old.title or new.category is distinct from old.category
    or new.risk_level is distinct from old.risk_level or new.due_at is distinct from old.due_at
    or new.location is distinct from old.location or new.notes is distinct from old.notes
  ) then
    raise exception 'confirmed tasks cannot be edited';
  end if;

  return new;
end;
$$;

create trigger tasks_enforce_workflow
  before insert or update on public.tasks
  for each row execute function public.enforce_task_workflow();

-- 4. Draft creation (replaces the Phase 3 function, which depended on browser inserts).
drop function public.create_draft_task(
  uuid, uuid, text, text, text, timestamptz, text, uuid, text, boolean, jsonb
);

create function public.create_draft_task(
  p_actor uuid,
  p_household_id uuid,
  p_note_id uuid,
  p_title text,
  p_category text,
  p_risk_level text,
  p_due_at timestamptz,
  p_location text,
  p_assignee_id uuid,
  p_notes text,
  p_needs_review boolean,
  p_audit_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_id uuid;
begin
  if not exists (
    select 1 from public.members
    where household_id = p_household_id and user_id = p_actor and role in ('caregiver', 'coordinator')
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.tasks (
    household_id, note_id, title, category, risk_level, status,
    due_at, location, assignee_id, notes, needs_review
  )
  values (
    p_household_id, p_note_id, p_title, p_category, p_risk_level, 'draft',
    p_due_at, p_location, p_assignee_id, p_notes, coalesce(p_needs_review, true)
  )
  returning id into v_task_id;

  insert into public.audit_events (household_id, task_id, note_id, actor_id, event_type, payload)
  values (
    p_household_id, v_task_id, p_note_id, p_actor, 'task_updated',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('action', 'draft_created')
  );
  return v_task_id;
end;
$$;

-- 5. All other task actions. The audit event is written in the same transaction.
create function public.apply_task_action(
  p_actor uuid,
  p_task_id uuid,
  p_action text,
  p_changes jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_member public.members%rowtype;
  v_staff boolean;
  v_event text;
  v_new_status text;
  v_assignee uuid;
  v_reason text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'task_not_found';
  end if;
  select * into v_member from public.members
    where household_id = v_task.household_id and user_id = p_actor;
  if not found then
    raise exception 'forbidden';
  end if;
  v_staff := v_member.role in ('caregiver', 'coordinator');
  v_new_status := v_task.status;
  v_event := 'task_updated';

  if p_action in ('claim', 'assign', 'edit', 'submit', 'approve', 'reject', 'cancel') and not v_staff then
    raise exception 'forbidden';
  end if;

  if p_action = 'claim' then
    if v_task.status not in ('draft', 'awaiting_confirmation', 'confirmed') or v_task.assignee_id is not null then
      raise exception 'invalid_state';
    end if;
    update public.tasks set assignee_id = v_member.id where id = v_task.id;

  elsif p_action = 'assign' then
    if v_task.status not in ('draft', 'awaiting_confirmation', 'confirmed') then
      raise exception 'invalid_state';
    end if;
    v_assignee := nullif(p_changes ->> 'assignee_id', '')::uuid;
    if v_assignee is not null and not exists (
      select 1 from public.members where id = v_assignee and household_id = v_task.household_id
    ) then
      raise exception 'invalid_assignee';
    end if;
    update public.tasks set assignee_id = v_assignee where id = v_task.id;

  elsif p_action = 'edit' then
    if v_task.status not in ('draft', 'awaiting_confirmation') then
      raise exception 'invalid_state';
    end if;
    if p_changes ? 'assignee_id' then
      v_assignee := nullif(p_changes ->> 'assignee_id', '')::uuid;
      if v_assignee is not null and not exists (
        select 1 from public.members where id = v_assignee and household_id = v_task.household_id
      ) then
        raise exception 'invalid_assignee';
      end if;
    else
      v_assignee := v_task.assignee_id;
    end if;
    update public.tasks set
      title = case when p_changes ? 'title' then p_changes ->> 'title' else title end,
      category = case when p_changes ? 'category' then p_changes ->> 'category' else category end,
      risk_level = coalesce(p_changes ->> 'risk_level', risk_level),
      due_at = case when p_changes ? 'due_at' then (p_changes ->> 'due_at')::timestamptz else due_at end,
      location = case when p_changes ? 'location' then p_changes ->> 'location' else location end,
      notes = case when p_changes ? 'notes' then p_changes ->> 'notes' else notes end,
      assignee_id = v_assignee,
      needs_review = coalesce((p_changes ->> 'needs_review')::boolean, needs_review)
    where id = v_task.id;

  elsif p_action = 'submit' then
    if v_task.status <> 'draft' then
      raise exception 'invalid_state';
    end if;
    v_new_status := 'awaiting_confirmation';
    v_event := 'task_confirmation_requested';
    update public.tasks set status = v_new_status where id = v_task.id;

  elsif p_action = 'approve' then
    -- High and medium risk tasks must wait in awaiting_confirmation. The trigger also enforces this.
    if not (v_task.status = 'awaiting_confirmation' or (v_task.status = 'draft' and v_task.risk_level = 'low')) then
      raise exception 'invalid_state';
    end if;
    v_new_status := 'confirmed';
    v_event := 'task_approved';
    update public.tasks set status = v_new_status, approved_by = v_member.id, needs_review = false
      where id = v_task.id;

  elsif p_action = 'reject' then
    if v_task.status <> 'awaiting_confirmation' then
      raise exception 'invalid_state';
    end if;
    v_new_status := 'rejected';
    v_event := 'task_rejected';
    update public.tasks set status = v_new_status where id = v_task.id;

  elsif p_action = 'complete' then
    if v_task.status <> 'confirmed' then
      raise exception 'invalid_state';
    end if;
    if not (v_staff or v_task.assignee_id = v_member.id) then
      raise exception 'forbidden';
    end if;
    v_new_status := 'completed';
    v_event := 'task_completed';
    update public.tasks set status = v_new_status where id = v_task.id;

  elsif p_action = 'cancel' then
    if v_task.status not in ('draft', 'awaiting_confirmation', 'confirmed') then
      raise exception 'invalid_state';
    end if;
    v_reason := trim(coalesce(p_changes ->> 'reason', ''));
    if v_reason = '' then
      raise exception 'reason_required';
    end if;
    v_new_status := 'cancelled';
    v_event := 'task_cancelled';
    update public.tasks set status = v_new_status where id = v_task.id;

  else
    raise exception 'invalid_action';
  end if;

  insert into public.audit_events (household_id, task_id, note_id, actor_id, event_type, payload)
  values (
    v_task.household_id, v_task.id, v_task.note_id, p_actor, v_event,
    coalesce(p_payload, '{}'::jsonb)
      || jsonb_build_object('action', p_action, 'from_status', v_task.status, 'to_status', v_new_status)
  );

  return jsonb_build_object('id', v_task.id, 'status', v_new_status);
end;
$$;

revoke all on function public.create_draft_task(
  uuid, uuid, uuid, text, text, text, timestamptz, text, uuid, text, boolean, jsonb
) from public, anon, authenticated;
revoke all on function public.apply_task_action(uuid, uuid, text, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_draft_task(
  uuid, uuid, uuid, text, text, text, timestamptz, text, uuid, text, boolean, jsonb
) to service_role;
grant execute on function public.apply_task_action(uuid, uuid, text, jsonb, jsonb) to service_role;
