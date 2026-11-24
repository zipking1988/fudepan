-- Fudepan: proof is optional when a household member marks a task done.
--
-- Replaces public.complete_part (from 20261210000300_shared_care_functions.sql) with the same
-- signature, grants and refusal order, minus the Evidence step:
--   part_not_found, recipient_read_only, part_closed, not_owner, approval_pending.
-- Only the current Owner, an active non-recipient member of the household, can complete, and an
-- approval-required or high-risk task still needs a primary caregiver's confirmation first.
-- Stored proof (part_evidence) and evidence_required labels are kept untouched as optional
-- context. A Part already in status `evidence_required` can now be completed by its Owner.
-- Mirrors decideCompletion in src/lib/care/rules/completion.ts. No table or data changes.
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
  'Server-only. The current Owner completes a Part; approval-required or high-risk Parts must be confirmed first. Proof is optional and never blocks completion.';
revoke all on function public.complete_part(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_part(uuid, uuid) to service_role;
