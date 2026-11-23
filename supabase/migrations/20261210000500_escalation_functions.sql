-- Family shared care, migration 6: escalation in the database.
--
-- public.escalate_due_parts(p_household_id, p_now) is the SQL twin of the
-- reference model (src/lib/care/rules/escalation.ts, model.ts escalateDueParts).
-- Requirements 8.13, 12.1-12.14, decision D-3.
--
--   1. Runs public.expire_care_requests first, so expired requests are closed
--      (and their reminders written) in the same sweep.
--   2. Candidates are High_Risk_Parts (private.is_high_risk) that are not
--      completed, cancelled, or failed. A failed Part is checked again only
--      after a Reopen sets it to in_progress. Rows are locked with
--      `for update skip locked`.
--   3. respond_by: respond_by_provenance = 'human_confirmed', respond_by_at <= now,
--      no Owner. task_due: task_due_provenance = 'human_confirmed',
--      task_due_at <= now. due_at and escalation_at are never read.
--   4. One escalation per (care_step_id, deadline_kind, deadline_at): the ledger
--      row step_escalations is the guard. The Part row lock serializes writers,
--      so the existence check and the insert cannot interleave. A Reopen does not
--      clear the ledger; a new confirmed deadline value escalates again.
--   5. On escalation: status = 'escalated' (approval_state and plan_version are
--      not written), one `part.escalated` audit event (payload {reason}), one
--      household Feed_Item (params {reason, notified: [member ids]}), and one
--      In_App_Reminder per active same-household recipient (kind
--      escalated_respond_by or escalated_task_due).
--      Recipients, deduplicated: task_due = Owner + Backup_Owner;
--      respond_by (no Owner) = every active Primary_Caregiver + Backup_Owner.
--
-- Returns {"escalated": n, "expired_requests": n}. Service role only.
-- Idempotent: create or replace.

create or replace function public.escalate_due_parts(
  p_household_id uuid default null,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now timestamptz := p_now;
  v_expired integer;
  v_escalated integer := 0;
  v_step public.care_steps;
  v_chain public.care_chains;
  v_row record;
  v_kind text;
  v_deadline timestamptz;
  v_recipients uuid[];
  v_recipient uuid;
  v_audit_id uuid;
  v_inserted integer;
begin
  if v_now is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- 1. Expire pending requests first (Requirement 8.13).
  v_expired := public.expire_care_requests(p_household_id, v_now);

  -- 2. Candidates, locked per Part. Locked-by-someone-else rows are skipped
  --    and picked up by the next sweep.
  for v_row in
    select s.id as step_id
    from public.care_steps s
    join public.care_chains c on c.id = s.care_chain_id
    where (p_household_id is null or c.household_id = p_household_id)
      and s.status not in ('completed', 'cancelled', 'failed')
      and private.is_high_risk(s)
      and (
        (s.respond_by_provenance = 'human_confirmed'
          and s.respond_by_at <= v_now
          and s.owner_id is null)
        or (s.task_due_provenance = 'human_confirmed'
          and s.task_due_at <= v_now)
      )
    order by c.household_id, s.id
    for update of s skip locked
  loop
    -- Re-read under the lock (the row cannot change now).
    select s.* into v_step from public.care_steps s where s.id = v_row.step_id;
    select c.* into v_chain from public.care_chains c where c.id = v_step.care_chain_id;

    foreach v_kind in array array['respond_by', 'task_due'] loop
      v_deadline := null;
      if v_kind = 'respond_by' then
        if v_step.respond_by_provenance = 'human_confirmed'
           and v_step.respond_by_at <= v_now
           and v_step.owner_id is null then
          v_deadline := v_step.respond_by_at;
        end if;
      else
        if v_step.task_due_provenance = 'human_confirmed'
           and v_step.task_due_at <= v_now then
          v_deadline := v_step.task_due_at;
        end if;
      end if;

      if v_deadline is null then
        continue;
      end if;

      -- One escalation per deadline value (Requirement 12.3, D-3).
      if exists (
        select 1 from public.step_escalations e
        where e.care_step_id = v_step.id
          and e.deadline_kind = v_kind
          and e.deadline_at = v_deadline
      ) then
        continue;
      end if;

      -- Active members of this household only, deduplicated by the query.
      select coalesce(array_agg(m.id order by m.created_at, m.id), '{}'::uuid[])
        into v_recipients
      from public.household_members m
      where m.household_id = v_chain.household_id
        and m.is_active
        and (
          m.id = v_step.backup_owner_id
          or (v_kind = 'task_due' and m.id = v_step.owner_id)
          or (v_kind = 'respond_by' and m.role = 'primary_caregiver')
        );

      update public.care_steps
      set status = 'escalated'
      where id = v_step.id;

      v_audit_id := private.write_audit(
        v_chain.household_id, v_chain.id, v_step.id, v_chain.note_id,
        'system', null, 'part.escalated',
        jsonb_build_object('reason', v_kind)
      );

      insert into public.step_escalations (
        household_id, care_chain_id, care_step_id, deadline_kind, deadline_at, audit_event_id
      )
      values (
        v_chain.household_id, v_chain.id, v_step.id, v_kind, v_deadline, v_audit_id
      )
      on conflict (care_step_id, deadline_kind, deadline_at) do nothing;
      get diagnostics v_inserted = row_count;
      if v_inserted = 0 then
        -- Cannot happen under the Part lock; undo this sweep rather than leave
        -- an escalation event without a ledger row.
        raise exception 'escalation_ledger_conflict' using errcode = 'P0001';
      end if;

      perform private.add_feed_item(
        v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
        'part_escalated', null,
        jsonb_build_object('reason', v_kind, 'notified', to_jsonb(v_recipients)),
        v_audit_id
      );

      foreach v_recipient in array v_recipients loop
        perform private.add_reminder(
          v_chain.household_id, v_chain.note_id, v_chain.id, v_step.id,
          v_recipient, 'escalated_' || v_kind
        );
      end loop;

      v_escalated := v_escalated + 1;
    end loop;
  end loop;

  return jsonb_build_object('escalated', v_escalated, 'expired_requests', v_expired);
end;
$$;

comment on function public.escalate_due_parts(uuid, timestamptz) is
  'Server-only sweep. Expires pending requests, then escalates High_Risk_Parts whose human-confirmed Respond_By_Time (no Owner) or Task_Due_Time has passed, once per deadline value. Never reads due_at or escalation_at, never writes approval_state.';

-- ---------------------------------------------------------------------------
-- Privileges: service role only (repeatable)
-- ---------------------------------------------------------------------------
revoke all on function public.escalate_due_parts(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.escalate_due_parts(uuid, timestamptz) to service_role;
