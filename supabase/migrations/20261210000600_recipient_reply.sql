-- Fudepan: the Care_Recipient's two fixed replies (Requirement 13.8 to 13.11, decision D17).
--
-- Additive only. public.send_recipient_reply lets a Care_Recipient tell the
-- family "Thank you" or "I have a question" about one Shared_Care_Event.
-- In one transaction it:
--   1. checks the person is an active Care_Recipient of the note's household
--      (evaluated at processing time),
--   2. refuses a repeat of the same reply on the same note within 10 minutes
--      (returns outcome 'already_sent' and writes nothing),
--   3. writes one `recipient.replied` audit event whose payload is the reply
--      code only, one household Feed_Item, and one In_App_Reminder to every
--      active Primary_Caregiver.
-- It changes no Part, Claim, Helper, Approval_State, Progress_Status or time,
-- and takes no free text. Service role only, like the other Action_Guard
-- functions; p_user_id is the verified signed-in user from the session.

create or replace function public.send_recipient_reply(
  p_note_id uuid,
  p_user_id uuid,
  p_reply text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_note public.notes;
  v_actor public.household_members;
  v_chain_id uuid;
  v_audit_id uuid;
  v_primary record;
  v_notified int := 0;
begin
  if p_reply is null or p_reply not in ('thanks', 'question') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- Lock the note so two taps at once cannot both pass the repeat check.
  select n.* into v_note from public.notes n where n.id = p_note_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;

  v_actor := private.actor_member(v_note.household_id, p_user_id);
  if v_actor.id is null then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;
  if v_actor.role <> 'care_recipient' then
    raise exception 'recipient_only' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.audit_events a
    where a.household_id = v_note.household_id
      and a.note_id = p_note_id
      and a.event_type = 'recipient.replied'
      and a.actor_id = p_user_id
      and a.payload ->> 'reply' = p_reply
      and a.created_at > clock_timestamp() - interval '10 minutes'
  ) then
    return jsonb_build_object('outcome', 'already_sent', 'note_id', p_note_id, 'audit_event_id', null);
  end if;

  -- Newest usable chain of the note, if any, so the event sits in its timeline too.
  select c.id into v_chain_id
  from public.care_chains c
  where c.note_id = p_note_id
    and c.household_id = v_note.household_id
    and c.status <> 'extraction_failed'
  order by c.created_at desc, c.id desc
  limit 1;

  v_audit_id := private.write_audit(
    v_note.household_id, v_chain_id, null, p_note_id,
    'human', p_user_id, 'recipient.replied',
    jsonb_build_object('reply', p_reply)
  );

  perform private.add_feed_item(
    v_note.household_id, p_note_id, v_chain_id, null,
    'recipient_replied', v_actor.id,
    jsonb_build_object('reply', p_reply),
    v_audit_id
  );

  for v_primary in
    select m.id
    from public.household_members m
    where m.household_id = v_note.household_id
      and m.role = 'primary_caregiver'
      and m.is_active
    order by m.id
  loop
    perform private.add_reminder(
      v_note.household_id, p_note_id, v_chain_id, null,
      v_primary.id, 'recipient_replied',
      jsonb_build_object('reply', p_reply)
    );
    v_notified := v_notified + 1;
  end loop;

  return jsonb_build_object(
    'outcome', 'sent',
    'note_id', p_note_id,
    'audit_event_id', v_audit_id,
    'notified_count', v_notified
  );
end;
$$;

comment on function public.send_recipient_reply(uuid, uuid, text) is
  'Server-only. A Care_Recipient''s fixed reply (thanks | question) about a note: one audit event, one Feed_Item, one In_App_Reminder per active Primary_Caregiver. Changes no Part.';

revoke all on function public.send_recipient_reply(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.send_recipient_reply(uuid, uuid, text) to service_role;
