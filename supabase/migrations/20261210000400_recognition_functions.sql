-- Family shared care, migration 5: recognition as a server job.
--
-- This file is built up over several tasks (12.1, then 12.2). Every statement
-- is `create or replace`, so the file can be re-applied safely with
-- `psql -f` until task 12.2 registers it with the migration history.
--
-- Task 12.1 contents:
--   * private.can_upload_notes   replaced: every active Member may upload,
--                                including `care_recipient` (Requirement 1.4).
--   * public.complete_note_upload replaced: same signature, refusals, and
--                                return value (the `note.uploaded` audit event
--                                id). In the same transaction it now also
--                                  - sets audit_events.note_id,
--                                  - queues a recognition run (status queued,
--                                    attempt 1), and
--                                  - writes the household Feed_Item
--                                    `event_created` (params state =
--                                    recognizing, shown as "Being read").
--                                A repeat call is refused with
--                                `upload_not_pending` as before, so no second
--                                run, audit event, or Feed_Item can appear.
--
-- Task 12.2 contents (this file is registered with the migration history by
-- that task; later changes need a new migration):
--   * start_recognition_run          claim a queued run, take over an expired
--                                    lease, or start a retry of a failed run.
--   * save_care_chain_draft          one transaction: chain, Parts, missing
--                                    details, extraction_succeeded event,
--                                    audit_event_id backfill, note, run, feed.
--   * fail_recognition_run           failed run, note extraction_failed.
--   * resume_stale_recognition_runs  sweeper support (re-queue or fail).
--   * private.usable_draft_id, private.fail_run_locked, private.draft_text,
--     private.draft_timestamptz      helpers.
--
-- Audit payloads and Feed_Item params hold IDs and codes only, never image
-- data, paths, file names, note text, titles, or names.

-- ---------------------------------------------------------------------------
-- Who may upload a note
-- ---------------------------------------------------------------------------
create or replace function private.can_upload_notes(p_household_id uuid, p_user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members m
    where m.household_id = p_household_id
      and m.user_id = p_user_id
      and m.is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Complete: note, audit event, Feed_Item, and queued run commit together
-- ---------------------------------------------------------------------------
create or replace function public.complete_note_upload(
  p_note_id uuid,
  p_user_id uuid,
  p_size_bytes integer,
  p_content_type text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  r public.note_uploads;
  v_audit_id uuid;
  v_member_id uuid;
begin
  select * into r
  from public.note_uploads u
  where u.note_id = p_note_id
  for update;

  if not found or r.uploaded_by <> p_user_id then
    raise exception 'upload_not_found' using errcode = 'P0001';
  end if;
  if r.status <> 'pending' then
    raise exception 'upload_not_pending' using errcode = 'P0001';
  end if;
  if r.expires_at <= now() then
    raise exception 'upload_expired' using errcode = 'P0001';
  end if;
  if p_content_type is distinct from r.content_type
    or p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 10485760 then
    raise exception 'upload_invalid' using errcode = 'P0001';
  end if;
  -- Membership can change between reserving and completing.
  if not private.can_upload_notes(r.household_id, p_user_id) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  select m.id into v_member_id
  from public.household_members m
  where m.household_id = r.household_id
    and m.user_id = p_user_id
    and m.is_active;

  insert into public.notes (id, household_id, uploaded_by, image_path, status)
  values (r.note_id, r.household_id, r.uploaded_by, r.object_path, 'uploaded');

  v_audit_id := private.write_audit(
    r.household_id, null, null, r.note_id,
    'human', p_user_id, 'note.uploaded',
    jsonb_build_object(
      'note_id', r.note_id,
      'content_type', r.content_type,
      'size_bytes', p_size_bytes,
      'status', 'uploaded'
    )
  );

  insert into public.recognition_runs (household_id, note_id, status, attempt, started_by)
  values (r.household_id, r.note_id, 'queued', 1, p_user_id);

  perform private.add_feed_item(
    r.household_id, r.note_id, null, null,
    'event_created', v_member_id,
    jsonb_build_object('state', 'recognizing'),
    v_audit_id
  );

  update public.note_uploads
  set status = 'completed', completed_at = now(), size_bytes = p_size_bytes
  where note_id = p_note_id;

  return v_audit_id;
end;
$$;

-- Privileges are unchanged by `create or replace`; restated so a re-run is explicit.
revoke all on function private.can_upload_notes(uuid, uuid) from public;
grant execute on function private.can_upload_notes(uuid, uuid) to service_role;
revoke all on function public.complete_note_upload(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.complete_note_upload(uuid, uuid, integer, text) to service_role;

-- ===========================================================================
-- Task 12.2: recognition run functions
-- ===========================================================================
--
-- Refusal codes (all from src/lib/care/rules/refusals.ts, P0001):
--   part_not_found  the note or run does not exist, or the caller is not an
--                   active Member of its household (same answer for both).
--   invalid_input   bad lease length, bad reason code, malformed draft, a run
--                   that is not running or whose lease has expired, a draft
--                   that breaks a safety rule.
-- `recognition_running` is NOT raised: a second start returns the existing
-- active run with outcome 'already_running' so the caller can show "Being
-- read". The design's `run_not_running` and `recognition_done` codes are not
-- in refusals.ts, so they are reported as `invalid_input` and as outcome
-- 'done' respectively.
--
-- Lock order everywhere: notes row first, then the recognition_runs row.
--
-- Event types written: extraction_started, extraction_succeeded,
-- extraction_failed (the underscore names already used by the timeline).
-- Feed kinds written: event_created (retry only), event_ready,
-- event_unreadable.
--
-- ---------------------------------------------------------------------------
-- save_care_chain_draft: the p_draft jsonb payload (built by task 12.4)
-- ---------------------------------------------------------------------------
-- {
--   "chain_title":  text, 1..200 characters after trimming        (required)
--   "overall_risk": 'low' | 'medium' | 'high'                      (required)
--   "steps": [                                  1..50 items        (required)
--     {
--       "title":              text, 1..200                         (required)
--       "description":        text <= 1000, or null/absent
--       "care_category":      'medical' | 'medication' | 'appointment' |
--                            'payment' | 'transport' | 'document' |
--                            'household' | 'communication'        (required)
--       "risk_level":         'low' | 'medium' | 'high'            (required)
--       "suggested_role":     text <= 100 or null. Stored as text only; never
--                            creates an Owner, Driver, or Companion.
--       "person_to_ask":      text 1..100 or null. Text only.
--       "evidence_required":  array of text <= 200 each (max 50); absent = []
--       "approval_required":  boolean                              (required)
--       "approval_state":     'pending' when approval_required, otherwise
--                            'not_required'                        (required;
--                            a mismatch is refused, never repaired)
--       "source_quote":       text <= 500 or null
--       "confidence":         number 0..1 or null
--       "due_at":             ISO 8601 timestamptz or null
--       "escalation_at":      ISO 8601 timestamptz or null
--     }
--   ],
--   "ambiguities": [                            only entries that name a step
--     {
--       "step_index": integer, zero-based index into "steps"       (required)
--       "kind":       'date' | 'time' | 'location' | 'person' |
--                     'document' | 'amount' | 'contact'            (required)
--       "question":   text 1..500 or null  (-> part_missing_details.ai_question;
--                     question_code is always 'ai_question')
--     }
--   ]
-- }
-- Other keys are ignored. Rules applied in SQL (Requirement 2.3, 2.6, 5.3, 10.6):
--   * a Part with risk_level 'high', or category medical, medication,
--     appointment, payment, transport, or document, must have
--     approval_required = true;
--   * due_at and escalation_at are NEVER written for appointment Parts (they
--     are ignored, not refused); respond_by_* and task_due_* are never written;
--   * owner_id, backup_owner_id, driver_id, companion_id stay null;
--   * every Part starts with status 'pending_review'.
--
-- Return value: { outcome: 'created' | 'existing', created, care_chain_id,
--   audit_event_id (null when existing), note_id, step_count, ambiguity_count }.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The newest Usable_Draft of a note: a Care_Chain whose status is not
-- extraction_failed (Requirement: Usable_Draft). Null if none.
create or replace function private.usable_draft_id(p_note_id uuid)
returns uuid
language sql
stable
set search_path = ''
as $$
  select c.id
  from public.care_chains c
  where c.note_id = p_note_id
    and c.status <> 'extraction_failed'
  order by c.created_at desc, c.id desc
  limit 1;
$$;

-- Reads a text field of a draft object. Absent or JSON null gives null when
-- p_required is false. A non-string, an empty required value, or a value
-- longer than p_max after trimming raises invalid_input. An empty optional
-- value becomes null.
create or replace function private.draft_text(
  p_obj jsonb,
  p_key text,
  p_max integer,
  p_required boolean default false
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_type text := jsonb_typeof(p_obj -> p_key);
  v_text text;
begin
  if v_type is null or v_type = 'null' then
    if p_required then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    return null;
  end if;
  if v_type <> 'string' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_text := btrim(p_obj ->> p_key);
  if v_text = '' then
    if p_required then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    return null;
  end if;
  if length(v_text) > p_max then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  return v_text;
end;
$$;

-- Reads an optional timestamp field. Anything that is not an ISO string is refused.
create or replace function private.draft_timestamptz(p_obj jsonb, p_key text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_type text := jsonb_typeof(p_obj -> p_key);
begin
  if v_type is null or v_type = 'null' then
    return null;
  end if;
  if v_type <> 'string' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  begin
    return (p_obj ->> p_key)::timestamptz;
  exception when others then
    raise exception 'invalid_input' using errcode = 'P0001';
  end;
end;
$$;

-- Marks a locked run failed, sets the note to extraction_failed, writes the
-- extraction_failed event (reason code only) and the event_unreadable
-- Feed_Item. The caller holds the note and run locks and has checked that the
-- note has no Usable_Draft. Returns the audit event id.
create or replace function private.fail_run_locked(
  p_run public.recognition_runs,
  p_reason_code text,
  p_retryable boolean
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_audit_id uuid;
begin
  update public.recognition_runs
  set status = 'failed', lease_expires_at = null, failure_reason = p_reason_code
  where id = p_run.id;

  update public.notes
  set status = 'extraction_failed'
  where id = p_run.note_id;

  v_audit_id := private.write_audit(
    p_run.household_id, null, null, p_run.note_id,
    'system', null, 'extraction_failed',
    jsonb_build_object(
      'note_id', p_run.note_id,
      'run_id', p_run.id,
      'attempt', p_run.attempt,
      'reason', p_reason_code,
      'retryable', p_retryable
    )
  );

  perform private.add_feed_item(
    p_run.household_id, p_run.note_id, null, null,
    'event_unreadable', null,
    jsonb_build_object('reason', p_reason_code, 'retryable', p_retryable, 'attempt', p_run.attempt),
    v_audit_id
  );

  return v_audit_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- start_recognition_run
-- ---------------------------------------------------------------------------
-- p_user_id: the Member asking (upload completion or Retry); null means the
-- sweeper, which may claim an existing queued run but never create one.
-- Outcomes (returned, not raised):
--   'started'          the run is now running with a lease. Includes a queued
--                      run, a takeover of an expired lease (attempt + 1, at
--                      most 3 attempts), and a retry of a failed run (a new
--                      run row, attempt = highest attempt + 1).
--   'already_running'  another run holds a live lease. Nothing is written.
--   'done'             the note already has a Usable_Draft (care_chain_id is
--                      set). An active run is marked superseded.
--   'failed'           the lease had expired on the third attempt, so the run
--                      was failed with reason lease_expired.
-- Return: { outcome, started, run_id, attempt, note_id, household_id,
--           care_chain_id, lease_expires_at }
create or replace function public.start_recognition_run(
  p_note_id uuid,
  p_user_id uuid,
  p_lease_seconds integer default 180
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_note public.notes;
  v_member public.household_members;
  v_run public.recognition_runs;
  v_chain_id uuid;
  v_audit_id uuid;
  v_attempt integer;
  v_lease timestamptz;
  v_retry boolean := false;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select * into v_note from public.notes n where n.id = p_note_id for update;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;

  if p_user_id is not null then
    v_member := private.actor_member(v_note.household_id, p_user_id);
    if v_member.id is null then
      raise exception 'part_not_found' using errcode = 'P0001';
    end if;
  end if;

  select * into v_run
  from public.recognition_runs r
  where r.note_id = p_note_id and r.status in ('queued', 'running')
  for update;

  v_chain_id := private.usable_draft_id(p_note_id);
  if v_chain_id is not null then
    if v_run.id is not null then
      update public.recognition_runs
      set status = 'superseded', lease_expires_at = null, care_chain_id = v_chain_id
      where id = v_run.id;
    else
      select r.* into v_run
      from public.recognition_runs r
      where r.note_id = p_note_id
      order by r.created_at desc, r.attempt desc, r.id desc
      limit 1;
    end if;
    return jsonb_build_object(
      'outcome', 'done', 'started', false, 'run_id', v_run.id, 'attempt', v_run.attempt,
      'note_id', p_note_id, 'household_id', v_note.household_id,
      'care_chain_id', v_chain_id, 'lease_expires_at', null
    );
  end if;

  v_lease := now() + make_interval(secs => p_lease_seconds);

  if v_run.id is not null then
    if v_run.status = 'running' and v_run.lease_expires_at > now() then
      return jsonb_build_object(
        'outcome', 'already_running', 'started', false, 'run_id', v_run.id,
        'attempt', v_run.attempt, 'note_id', p_note_id, 'household_id', v_note.household_id,
        'care_chain_id', null, 'lease_expires_at', private.iso_utc(v_run.lease_expires_at)
      );
    end if;

    v_attempt := v_run.attempt;
    if v_run.status = 'running' then
      -- The earlier worker died: this is the next attempt, up to three.
      if v_run.attempt >= 3 then
        perform private.fail_run_locked(v_run, 'lease_expired', true);
        return jsonb_build_object(
          'outcome', 'failed', 'started', false, 'run_id', v_run.id,
          'attempt', v_run.attempt, 'note_id', p_note_id, 'household_id', v_note.household_id,
          'care_chain_id', null, 'lease_expires_at', null
        );
      end if;
      v_attempt := v_run.attempt + 1;
    end if;

    update public.recognition_runs
    set status = 'running', attempt = v_attempt, lease_expires_at = v_lease
    where id = v_run.id;
  else
    -- Retry: only a Member may create the new run.
    if p_user_id is null then
      raise exception 'part_not_found' using errcode = 'P0001';
    end if;
    select coalesce(max(r.attempt), 0) + 1 into v_attempt
    from public.recognition_runs r
    where r.note_id = p_note_id;

    insert into public.recognition_runs (
      household_id, note_id, status, attempt, lease_expires_at, started_by
    )
    values (v_note.household_id, p_note_id, 'running', v_attempt, v_lease, p_user_id)
    returning * into v_run;
    v_retry := true;
  end if;

  update public.notes set status = 'extracting' where id = p_note_id;

  v_audit_id := private.write_audit(
    v_note.household_id, null, null, p_note_id,
    case when p_user_id is null then 'system' else 'human' end,
    p_user_id,
    'extraction_started',
    jsonb_build_object('note_id', p_note_id, 'run_id', v_run.id, 'attempt', v_attempt, 'retry', v_retry)
  );

  if v_retry then
    perform private.add_feed_item(
      v_note.household_id, p_note_id, null, null,
      'event_created', v_member.id,
      jsonb_build_object('state', 'recognizing', 'retry', true),
      v_audit_id
    );
  end if;

  return jsonb_build_object(
    'outcome', 'started', 'started', true, 'run_id', v_run.id, 'attempt', v_attempt,
    'note_id', p_note_id, 'household_id', v_note.household_id,
    'care_chain_id', null, 'lease_expires_at', private.iso_utc(v_lease)
  );
end;
$$;

comment on function public.start_recognition_run(uuid, uuid, integer) is
  'Server-only. Claims a queued run, takes over an expired lease (max 3 attempts), or starts a retry of a failed run. A second concurrent start returns outcome already_running.';

-- ---------------------------------------------------------------------------
-- save_care_chain_draft
-- ---------------------------------------------------------------------------
create or replace function public.save_care_chain_draft(
  p_run_id uuid,
  p_draft jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run public.recognition_runs;
  v_note_id uuid;
  v_household_id uuid;
  v_existing uuid;
  v_chain_title text;
  v_overall_risk text;
  v_steps jsonb;
  v_ambs jsonb;
  v_step jsonb;
  v_amb jsonb;
  v_idx integer;
  v_len integer;
  v_cat text;
  v_risk text;
  v_approval boolean;
  v_state text;
  v_confidence numeric;
  v_evidence text[];
  v_item jsonb;
  v_kind text;
  v_step_idx integer;
  v_step_ids uuid[] := '{}';
  v_step_id uuid;
  v_chain_id uuid;
  v_audit_id uuid;
  v_amb_count integer := 0;
  v_valid_kinds constant text[] := array['date', 'time', 'location', 'person', 'document', 'amount', 'contact'];
begin
  select r.note_id, r.household_id into v_note_id, v_household_id
  from public.recognition_runs r
  where r.id = p_run_id;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;

  -- 1. Lock the note, then the run.
  perform 1 from public.notes n where n.id = v_note_id for update;
  select * into v_run from public.recognition_runs r where r.id = p_run_id for update;

  -- Idempotent repeats: nothing more is written.
  if v_run.status = 'succeeded' then
    return jsonb_build_object(
      'outcome', 'existing', 'created', false,
      'care_chain_id', coalesce(v_run.care_chain_id, private.usable_draft_id(v_note_id)),
      'audit_event_id', null, 'note_id', v_note_id, 'step_count', null, 'ambiguity_count', null
    );
  end if;
  if v_run.status = 'superseded' then
    return jsonb_build_object(
      'outcome', 'existing', 'created', false,
      'care_chain_id', coalesce(v_run.care_chain_id, private.usable_draft_id(v_note_id)),
      'audit_event_id', null, 'note_id', v_note_id, 'step_count', null, 'ambiguity_count', null
    );
  end if;
  if v_run.status <> 'running' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- 2. A Usable_Draft already exists for the note: keep it, supersede this run.
  v_existing := private.usable_draft_id(v_note_id);
  if v_existing is not null then
    update public.recognition_runs
    set status = 'superseded', lease_expires_at = null, care_chain_id = v_existing
    where id = p_run_id;
    return jsonb_build_object(
      'outcome', 'existing', 'created', false, 'care_chain_id', v_existing,
      'audit_event_id', null, 'note_id', v_note_id, 'step_count', null, 'ambiguity_count', null
    );
  end if;

  if v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  -- Validate the whole draft before the first write.
  if p_draft is null or jsonb_typeof(p_draft) <> 'object' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_chain_title := private.draft_text(p_draft, 'chain_title', 200, true);
  v_overall_risk := private.draft_text(p_draft, 'overall_risk', 20, true);
  if v_overall_risk not in ('low', 'medium', 'high') then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_steps := p_draft -> 'steps';
  if jsonb_typeof(v_steps) is distinct from 'array' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  v_len := jsonb_array_length(v_steps);
  if v_len < 1 or v_len > 50 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_ambs := coalesce(p_draft -> 'ambiguities', '[]'::jsonb);
  if jsonb_typeof(v_ambs) <> 'array' then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  for v_idx in 0 .. v_len - 1 loop
    v_step := v_steps -> v_idx;
    if jsonb_typeof(v_step) <> 'object' then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    perform private.draft_text(v_step, 'title', 200, true);
    perform private.draft_text(v_step, 'description', 1000);
    perform private.draft_text(v_step, 'suggested_role', 100);
    perform private.draft_text(v_step, 'person_to_ask', 100);
    perform private.draft_text(v_step, 'source_quote', 500);
    v_cat := private.draft_text(v_step, 'care_category', 30, true);
    v_risk := private.draft_text(v_step, 'risk_level', 20, true);
    if v_cat not in ('medical', 'medication', 'appointment', 'payment', 'transport',
                     'document', 'household', 'communication')
       or v_risk not in ('low', 'medium', 'high') then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if jsonb_typeof(v_step -> 'approval_required') is distinct from 'boolean' then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    v_approval := (v_step ->> 'approval_required')::boolean;
    v_state := private.draft_text(v_step, 'approval_state', 20, true);
    if v_state is distinct from (case when v_approval then 'pending' else 'not_required' end) then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    -- High_Risk_Part always needs approval (also a table constraint for risk 'high').
    if not v_approval
       and (v_risk = 'high'
            or v_cat in ('medical', 'medication', 'appointment', 'payment', 'transport', 'document')) then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if jsonb_typeof(v_step -> 'confidence') in ('number') then
      v_confidence := (v_step ->> 'confidence')::numeric;
      if v_confidence < 0 or v_confidence > 1 then
        raise exception 'invalid_input' using errcode = 'P0001';
      end if;
    elsif jsonb_typeof(v_step -> 'confidence') is not null
          and jsonb_typeof(v_step -> 'confidence') <> 'null' then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;

    if jsonb_typeof(v_step -> 'evidence_required') is not null
       and jsonb_typeof(v_step -> 'evidence_required') <> 'null' then
      if jsonb_typeof(v_step -> 'evidence_required') <> 'array'
         or jsonb_array_length(v_step -> 'evidence_required') > 50 then
        raise exception 'invalid_input' using errcode = 'P0001';
      end if;
      for v_item in select e.value from jsonb_array_elements(v_step -> 'evidence_required') e loop
        if jsonb_typeof(v_item) <> 'string' or length(v_item #>> '{}') > 200 then
          raise exception 'invalid_input' using errcode = 'P0001';
        end if;
      end loop;
    end if;

    perform private.draft_timestamptz(v_step, 'due_at');
    perform private.draft_timestamptz(v_step, 'escalation_at');
  end loop;

  for v_amb in select a.value from jsonb_array_elements(v_ambs) a loop
    if jsonb_typeof(v_amb) <> 'object' then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_amb -> 'step_index') is null or jsonb_typeof(v_amb -> 'step_index') = 'null' then
      continue;  -- an ambiguity that names no Part is not stored
    end if;
    if jsonb_typeof(v_amb -> 'step_index') <> 'number'
       or (v_amb ->> 'step_index') !~ '^[0-9]+$'
       or (v_amb ->> 'step_index')::integer >= v_len then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    v_kind := private.draft_text(v_amb, 'kind', 20, true);
    if not (v_kind = any (v_valid_kinds)) then
      raise exception 'invalid_input' using errcode = 'P0001';
    end if;
    perform private.draft_text(v_amb, 'question', 500);
  end loop;

  -- 3. Care_Chain.
  insert into public.care_chains (household_id, note_id, title, status, risk_level, created_by_ai)
  values (v_household_id, v_note_id, v_chain_title, 'pending_review', v_overall_risk, true)
  returning id into v_chain_id;

  -- 4. Parts: no holders, audit_event_id null, no model times on appointments.
  for v_idx in 0 .. v_len - 1 loop
    v_step := v_steps -> v_idx;
    v_cat := v_step ->> 'care_category';
    v_approval := (v_step ->> 'approval_required')::boolean;

    v_evidence := '{}';
    if jsonb_typeof(v_step -> 'evidence_required') = 'array' then
      select coalesce(array_agg(e.value #>> '{}' order by e.ord), '{}')
      into v_evidence
      from jsonb_array_elements(v_step -> 'evidence_required') with ordinality as e(value, ord);
    end if;

    insert into public.care_steps (
      care_chain_id, title, description, care_category, risk_level, status,
      evidence_required, approval_required, approval_state, source_quote, confidence,
      suggested_role, person_to_ask, due_at, escalation_at, audit_event_id
    )
    values (
      v_chain_id,
      private.draft_text(v_step, 'title', 200, true),
      private.draft_text(v_step, 'description', 1000),
      v_cat,
      v_step ->> 'risk_level',
      'pending_review',
      v_evidence,
      v_approval,
      case when v_approval then 'pending' else 'not_required' end,
      private.draft_text(v_step, 'source_quote', 500),
      case when jsonb_typeof(v_step -> 'confidence') = 'number'
           then (v_step ->> 'confidence')::numeric end,
      private.draft_text(v_step, 'suggested_role', 100),
      private.draft_text(v_step, 'person_to_ask', 100),
      case when v_cat = 'appointment' then null
           else private.draft_timestamptz(v_step, 'due_at') end,
      case when v_cat = 'appointment' then null
           else private.draft_timestamptz(v_step, 'escalation_at') end,
      null
    )
    returning id into v_step_id;
    v_step_ids := v_step_ids || v_step_id;
  end loop;

  -- 5. Missing details from ambiguities that name a Part.
  for v_amb in select a.value from jsonb_array_elements(v_ambs) a loop
    if jsonb_typeof(v_amb -> 'step_index') = 'number' then
      v_step_idx := (v_amb ->> 'step_index')::integer;
      insert into public.part_missing_details (
        household_id, care_chain_id, care_step_id, kind, question_code, ai_question
      )
      values (
        v_household_id, v_chain_id, v_step_ids[v_step_idx + 1],
        v_amb ->> 'kind', 'ai_question', private.draft_text(v_amb, 'question', 500)
      );
      v_amb_count := v_amb_count + 1;
    end if;
  end loop;

  -- 6. extraction_succeeded: counts and IDs only.
  v_audit_id := private.write_audit(
    v_household_id, v_chain_id, null, v_note_id,
    'ai', null, 'extraction_succeeded',
    jsonb_build_object(
      'note_id', v_note_id,
      'run_id', p_run_id,
      'care_chain_id', v_chain_id,
      'step_count', v_len,
      'ambiguity_count', v_amb_count,
      'overall_risk', v_overall_risk
    )
  );

  -- 7. Backfill care_steps.audit_event_id.
  update public.care_steps set audit_event_id = v_audit_id where care_chain_id = v_chain_id;

  -- 8. Note ready for review. 9. Run succeeded.
  update public.notes set status = 'pending_review' where id = v_note_id;
  update public.recognition_runs
  set status = 'succeeded', lease_expires_at = null, care_chain_id = v_chain_id, failure_reason = null
  where id = p_run_id;

  -- 10. The household Feed_Item that replaces "Being read".
  perform private.add_feed_item(
    v_household_id, v_note_id, v_chain_id, null,
    'event_ready', null,
    jsonb_build_object('step_count', v_len, 'ambiguity_count', v_amb_count),
    v_audit_id
  );

  return jsonb_build_object(
    'outcome', 'created', 'created', true, 'care_chain_id', v_chain_id,
    'audit_event_id', v_audit_id, 'note_id', v_note_id,
    'step_count', v_len, 'ambiguity_count', v_amb_count
  );
end;
$$;

comment on function public.save_care_chain_draft(uuid, jsonb) is
  'Server-only. Saves a validated draft in one transaction: chain, Parts, missing details, extraction_succeeded event, audit_event_id backfill, note, run, Feed_Item. A repeat returns the existing chain and writes nothing.';

-- ---------------------------------------------------------------------------
-- fail_recognition_run
-- ---------------------------------------------------------------------------
-- p_reason_code is a short code (lowercase letters, digits, underscore, max
-- 40), never model output or prompt text. p_retryable is recorded in the
-- event and the Feed_Item so the Family_Feed can offer Retry.
-- Return: { outcome: 'failed' | 'already_failed' | 'existing', run_id,
--           attempt, audit_event_id, care_chain_id }
create or replace function public.fail_recognition_run(
  p_run_id uuid,
  p_reason_code text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_run public.recognition_runs;
  v_note_id uuid;
  v_existing uuid;
  v_audit_id uuid;
begin
  if p_reason_code is null or p_reason_code !~ '^[a-z][a-z0-9_]{0,39}$'
     or p_retryable is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  select r.note_id into v_note_id from public.recognition_runs r where r.id = p_run_id;
  if not found then
    raise exception 'part_not_found' using errcode = 'P0001';
  end if;

  perform 1 from public.notes n where n.id = v_note_id for update;
  select * into v_run from public.recognition_runs r where r.id = p_run_id for update;

  if v_run.status = 'failed' then
    return jsonb_build_object('outcome', 'already_failed', 'run_id', v_run.id,
      'attempt', v_run.attempt, 'audit_event_id', null, 'care_chain_id', null);
  end if;
  if v_run.status = 'superseded' then
    return jsonb_build_object('outcome', 'existing', 'run_id', v_run.id,
      'attempt', v_run.attempt, 'audit_event_id', null, 'care_chain_id', v_run.care_chain_id);
  end if;
  if v_run.status <> 'running' then
    -- A succeeded run cannot fail, and a queued run was never started.
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  v_existing := private.usable_draft_id(v_note_id);
  if v_existing is not null then
    update public.recognition_runs
    set status = 'superseded', lease_expires_at = null, care_chain_id = v_existing
    where id = p_run_id;
    return jsonb_build_object('outcome', 'existing', 'run_id', v_run.id,
      'attempt', v_run.attempt, 'audit_event_id', null, 'care_chain_id', v_existing);
  end if;

  v_audit_id := private.fail_run_locked(v_run, p_reason_code, p_retryable);

  return jsonb_build_object('outcome', 'failed', 'run_id', v_run.id,
    'attempt', v_run.attempt, 'audit_event_id', v_audit_id, 'care_chain_id', null);
end;
$$;

comment on function public.fail_recognition_run(uuid, text, boolean) is
  'Server-only. Marks a running run failed with a plain reason code, sets the note to extraction_failed, writes extraction_failed and an event_unreadable Feed_Item.';

-- ---------------------------------------------------------------------------
-- resume_stale_recognition_runs (sweeper support)
-- ---------------------------------------------------------------------------
-- Candidates: running runs whose lease_expires_at <= p_now, and queued runs
-- untouched for 5 minutes (their after() callback never ran).
--   * running, attempt < 3: re-queued (attempt + 1, lease cleared).
--   * running, attempt >= 3: failed with reason lease_expired.
--   * queued: unchanged.
--   * note already has a Usable_Draft: run marked superseded, not returned.
-- Returns one jsonb row per run the caller should restart or has been failed:
--   { run_id, note_id, household_id, attempt, action: 'restart' | 'failed' }
-- The caller restarts 'restart' rows with start_recognition_run(note_id, null).
-- No note content is read or written. p_household_id null covers all households.
create or replace function public.resume_stale_recognition_runs(
  p_now timestamptz default now(),
  p_limit integer default 20,
  p_household_id uuid default null
)
returns setof jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_cand record;
  v_run public.recognition_runs;
  v_chain_id uuid;
  v_action text;
  v_attempt integer;
begin
  if p_now is null or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;

  for v_cand in
    select r.id, r.note_id
    from public.recognition_runs r
    where (p_household_id is null or r.household_id = p_household_id)
      and (
        (r.status = 'running' and r.lease_expires_at <= p_now)
        or (r.status = 'queued' and r.updated_at <= p_now - interval '5 minutes')
      )
    order by r.updated_at, r.id
    limit p_limit
  loop
    perform 1 from public.notes n where n.id = v_cand.note_id for update;
    select * into v_run from public.recognition_runs r where r.id = v_cand.id for update;

    -- Re-check under the locks: another worker may have moved it.
    if not (
      (v_run.status = 'running' and v_run.lease_expires_at <= p_now)
      or (v_run.status = 'queued' and v_run.updated_at <= p_now - interval '5 minutes')
    ) then
      continue;
    end if;

    v_chain_id := private.usable_draft_id(v_run.note_id);
    if v_chain_id is not null then
      update public.recognition_runs
      set status = 'superseded', lease_expires_at = null, care_chain_id = v_chain_id
      where id = v_run.id;
      continue;
    end if;

    v_attempt := v_run.attempt;
    if v_run.status = 'running' then
      if v_run.attempt < 3 then
        v_attempt := v_run.attempt + 1;
        update public.recognition_runs
        set status = 'queued', attempt = v_attempt, lease_expires_at = null
        where id = v_run.id;
        v_action := 'restart';
      else
        perform private.fail_run_locked(v_run, 'lease_expired', true);
        v_action := 'failed';
      end if;
    else
      v_action := 'restart';
    end if;

    return next jsonb_build_object(
      'run_id', v_run.id, 'note_id', v_run.note_id, 'household_id', v_run.household_id,
      'attempt', v_attempt, 'action', v_action
    );
  end loop;

  return;
end;
$$;

comment on function public.resume_stale_recognition_runs(timestamptz, integer, uuid) is
  'Server-only. Re-queues running runs with an expired lease (max 3 attempts, then fails them) and lists queued runs that never started. Writes no note content.';

-- ---------------------------------------------------------------------------
-- Privileges: service role only
-- ---------------------------------------------------------------------------
revoke all on function private.usable_draft_id(uuid) from public, anon, authenticated;
revoke all on function private.draft_text(jsonb, text, integer, boolean) from public, anon, authenticated;
revoke all on function private.draft_timestamptz(jsonb, text) from public, anon, authenticated;
revoke all on function private.fail_run_locked(public.recognition_runs, text, boolean) from public, anon, authenticated;
grant execute on function private.usable_draft_id(uuid) to service_role;
grant execute on function private.draft_text(jsonb, text, integer, boolean) to service_role;
grant execute on function private.draft_timestamptz(jsonb, text) to service_role;
grant execute on function private.fail_run_locked(public.recognition_runs, text, boolean) to service_role;

revoke all on function public.start_recognition_run(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.save_care_chain_draft(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.fail_recognition_run(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.resume_stale_recognition_runs(timestamptz, integer, uuid) from public, anon, authenticated;
grant execute on function public.start_recognition_run(uuid, uuid, integer) to service_role;
grant execute on function public.save_care_chain_draft(uuid, jsonb) to service_role;
grant execute on function public.fail_recognition_run(uuid, text, boolean) to service_role;
grant execute on function public.resume_stale_recognition_runs(timestamptz, integer, uuid) to service_role;
