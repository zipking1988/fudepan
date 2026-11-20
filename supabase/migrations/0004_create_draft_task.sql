-- Fudepan Phase 3: create a draft task and its audit event in one transaction, so a task can
-- never exist without an audit event. SECURITY INVOKER: RLS and table policies still apply.
-- The function has no status or approver parameter: new tasks are always drafts.

create or replace function public.create_draft_task(
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
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task_id uuid;
begin
  if v_actor is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.is_household_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
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
    p_household_id, v_task_id, p_note_id, v_actor, 'task_updated',
    coalesce(p_audit_payload, '{}'::jsonb) || jsonb_build_object('action', 'draft_created')
  );

  return v_task_id;
end;
$$;

revoke all on function public.create_draft_task(
  uuid, uuid, text, text, text, timestamptz, text, uuid, text, boolean, jsonb
) from public, anon;
grant execute on function public.create_draft_task(
  uuid, uuid, text, text, text, timestamptz, text, uuid, text, boolean, jsonb
) to authenticated;
