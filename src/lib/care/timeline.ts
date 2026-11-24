import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type TimelineEvent = {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  /** Household display name of a human actor, when they are (or were) a member. */
  actorName: string | null;
  createdAt: string;
  careStepId: string | null;
  stepTitle: string | null;
  /** Payload with sensitive fields already masked by the writer. */
  payload: Record<string, unknown>;
};

/**
 * Care Chain audit timeline, oldest-first.
 * Uses the caller's RLS client so only household members can read it.
 */
export async function getCareChainTimeline(
  supabase: Client,
  chainId: string,
): Promise<TimelineEvent[]> {
  const { data, error } = await supabase
    .from("audit_events")
    .select("id, household_id, event_type, actor_type, actor_id, created_at, care_step_id, payload")
    .eq("care_chain_id", chainId)
    .order("created_at", { ascending: true });

  if (error) throw new Error("timeline_query_failed");

  // Resolve names of the people who acted (RLS: fellow members only)
  const householdIds = [...new Set(data.map((e) => e.household_id))];
  const actorIds = [
    ...new Set(data.flatMap((e) => (e.actor_type === "human" && e.actor_id ? [e.actor_id] : []))),
  ];
  const actorNames = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: members } = await supabase
      .from("household_members")
      .select("household_id, user_id, display_name")
      .in("household_id", householdIds)
      .in("user_id", actorIds);
    for (const m of members ?? []) actorNames.set(`${m.household_id}:${m.user_id}`, m.display_name);
  }

  // Resolve step titles for step-scoped events
  const stepIds = [...new Set(data.flatMap((e) => (e.care_step_id ? [e.care_step_id] : [])))];
  const stepTitles = new Map<string, string>();
  if (stepIds.length > 0) {
    const { data: steps } = await supabase
      .from("care_steps")
      .select("id, title")
      .in("id", stepIds);
    for (const s of steps ?? []) stepTitles.set(s.id, s.title);
  }

  return data.map((e) => ({
    id: e.id,
    eventType: e.event_type,
    actorType: e.actor_type,
    actorId: e.actor_id,
    actorName: e.actor_id ? (actorNames.get(`${e.household_id}:${e.actor_id}`) ?? null) : null,
    createdAt: e.created_at,
    careStepId: e.care_step_id,
    stepTitle: e.care_step_id ? (stepTitles.get(e.care_step_id) ?? null) : null,
    payload: (e.payload as Record<string, unknown>) ?? {},
  }));
}

// ---------------------------------------------------------------------------
// Event Timeline (family shared care): keyed by note, label KEYS only.
// ---------------------------------------------------------------------------

/** Event type -> dictionary label key. English text lives in src/lib/i18n. */
const EVENT_LABEL_KEYS: Record<string, string> = {
  "note.uploaded": "timeline.note_uploaded",
  "extraction_started": "timeline.extraction_started",
  "extraction_succeeded": "timeline.extraction_succeeded",
  "extraction_failed": "timeline.extraction_failed",
  "ambiguities_detected": "timeline.ambiguities_detected",
  "appointment_clarified": "timeline.appointment_clarified",
  "part.claimed": "timeline.part_claimed",
  "part.released": "timeline.part_released",
  "part.driver_volunteered": "timeline.part_driver_volunteered",
  "part.companion_volunteered": "timeline.part_companion_volunteered",
  "part.completed": "timeline.part_completed",
  "part.failed": "timeline.part_failed",
  "part.reopened": "timeline.part_reopened",
  "part.evidence_missing": "timeline.part_evidence_missing",
  "part.escalated": "timeline.part_escalated",
  "assignment.requested": "timeline.assignment_requested",
  "assignment.accepted": "timeline.assignment_accepted",
  "assignment.declined": "timeline.assignment_declined",
  "assignment.expired": "timeline.assignment_expired",
  "handover.requested": "timeline.handover_requested",
  "handover.accepted": "timeline.handover_accepted",
  "handover.declined": "timeline.handover_declined",
  "handover.not_accepted": "timeline.handover_not_accepted",
  "backup.requested": "timeline.backup_requested",
  "backup.accepted": "timeline.backup_accepted",
  "backup.declined": "timeline.backup_declined",
  "backup.expired": "timeline.backup_expired",
  "approval.given": "timeline.approval_given",
  "approval.rejected": "timeline.approval_rejected",
  "approval.resubmitted": "timeline.approval_resubmitted",
  "approval.reset": "timeline.approval_reset",
  "evidence.uploaded": "timeline.evidence_uploaded",
  "time.confirmed": "timeline.time_confirmed",
  "missing_detail.resolved": "timeline.missing_detail_resolved",
  "member.language_changed": "timeline.member_language_changed",
  "recipient.replied": "timeline.recipient_replied",
  "reminder.sent": "timeline.reminder_sent",
  "owner_assigned": "timeline.owner_assigned",
  "step_approved": "timeline.step_approved",
  "step_completed": "timeline.step_completed",
  "step_escalated": "timeline.step_escalated",
  "escalation_notified": "timeline.escalation_notified",
  "evidence_uploaded": "timeline.evidence_uploaded",
};

export const TIMELINE_SELF_APPROVAL_LABEL_KEY = "timeline.approval_self";
export const TIMELINE_UNKNOWN_LABEL_KEY = "timeline.unknown_event";

/** Every label key the Timeline can produce; the dictionaries must cover it. */
export const TIMELINE_LABEL_KEYS: readonly string[] = [
  ...new Set([
    ...Object.values(EVENT_LABEL_KEYS),
    TIMELINE_SELF_APPROVAL_LABEL_KEY,
    TIMELINE_UNKNOWN_LABEL_KEY,
  ]),
];

export type TimelineParamValue = string | number | boolean | string[];

export type TimelineEntry = {
  id: string;
  type: string;
  labelKey: string;
  /** Allow-listed payload fields only. Never free text. */
  params: Record<string, TimelineParamValue>;
  at: string;
  actorName: string | null;
  /** Household member id of a human actor, so a page can say "saved by you" without names. */
  actorMemberId?: string | null;
  actorType: string;
  /** The Part the event is about, when it names one. */
  stepId?: string | null;
  stepTitle: string | null;
};

const TOKEN = /^[a-z][a-z0-9_]{0,31}$/;
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;
const COUNT_KEYS = ["missing_count", "evidence_count", "step_count", "step_index", "plan_version"];
const TOKEN_KEYS = ["role", "kind", "state", "language", "reason_code", "reply"];
const FLAG_KEYS = ["self_approval", "volunteered", "needs_attention"];

/** Keeps only allow-listed, shape-checked payload fields. */
export function safeTimelineParams(payload: unknown): Record<string, TimelineParamValue> {
  const out: Record<string, TimelineParamValue> = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return out;
  const p = payload as Record<string, unknown>;
  for (const k of TOKEN_KEYS) {
    const v = p[k];
    if (typeof v === "string" && TOKEN.test(v)) out[k] = v;
  }
  if (typeof p.timezone === "string" && p.timezone.length <= 64 && ZONE.test(p.timezone)) {
    out.timezone = p.timezone;
  }
  for (const k of COUNT_KEYS) {
    const v = p[k];
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1000) out[k] = v;
  }
  for (const k of FLAG_KEYS) {
    if (typeof p[k] === "boolean") out[k] = p[k];
  }
  if (Array.isArray(p.added)) {
    out.added = p.added.filter((x): x is string => typeof x === "string" && TOKEN.test(x));
  }
  return out;
}

export function timelineLabelKey(eventType: string, payload: unknown): string {
  if (
    eventType === "approval.given" &&
    payload &&
    typeof payload === "object" &&
    (payload as Record<string, unknown>).self_approval === true
  ) {
    return TIMELINE_SELF_APPROVAL_LABEL_KEY;
  }
  return EVENT_LABEL_KEYS[eventType] ?? TIMELINE_UNKNOWN_LABEL_KEY;
}

const AUDIT_COLUMNS =
  "id, household_id, event_type, actor_type, actor_id, created_at, care_step_id, payload";

/**
 * All audit events of one note, oldest first. Gathers by `note_id`, by the
 * note's chains, and by legacy payload `note_id` (rows written before the
 * column existed), de-duplicated by id. Uses the caller's RLS client.
 */
export async function getEventTimeline(
  supabase: Client,
  noteId: string,
  options: { leftSuffix?: string } = {},
): Promise<TimelineEntry[]> {
  const { data: chains, error: chainError } = await supabase
    .from("care_chains")
    .select("id")
    .eq("note_id", noteId);
  if (chainError) throw new Error("timeline_query_failed");
  const chainIds = (chains ?? []).map((c) => c.id);

  const byNoteOrChain = supabase
    .from("audit_events")
    .select(AUDIT_COLUMNS)
    .or(
      chainIds.length > 0
        ? `note_id.eq.${noteId},care_chain_id.in.(${chainIds.join(",")})`
        : `note_id.eq.${noteId}`,
    );
  const legacy = supabase
    .from("audit_events")
    .select(AUDIT_COLUMNS)
    .is("note_id", null)
    .filter("payload->>note_id", "eq", noteId);
  const [a, b] = await Promise.all([byNoteOrChain, legacy]);
  if (a.error || b.error) throw new Error("timeline_query_failed");

  const rows = new Map<string, NonNullable<typeof a.data>[number]>();
  for (const r of [...(a.data ?? []), ...(b.data ?? [])]) rows.set(r.id, r);
  const sorted = [...rows.values()].sort((x, y) => {
    const d = Date.parse(x.created_at) - Date.parse(y.created_at);
    if (d !== 0) return d;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });

  const householdIds = [...new Set(sorted.map((e) => e.household_id))];
  const actorIds = [
    ...new Set(sorted.flatMap((e) => (e.actor_type === "human" && e.actor_id ? [e.actor_id] : []))),
  ];
  const names = new Map<string, string>();
  const memberIds = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: members } = await supabase
      .from("household_members")
      .select("id, household_id, user_id, display_name, is_active")
      .in("household_id", householdIds)
      .in("user_id", actorIds);
    for (const m of members ?? []) {
      // Former members keep their name, with a suffix so nobody thinks they are still in the household.
      const suffix = !m.is_active && options.leftSuffix ? ` ${options.leftSuffix}` : "";
      names.set(`${m.household_id}:${m.user_id}`, `${m.display_name}${suffix}`);
      if (m.id) memberIds.set(`${m.household_id}:${m.user_id}`, m.id);
    }
  }
  const stepIds = [...new Set(sorted.flatMap((e) => (e.care_step_id ? [e.care_step_id] : [])))];
  const titles = new Map<string, string>();
  if (stepIds.length > 0) {
    const { data: steps } = await supabase.from("care_steps").select("id, title").in("id", stepIds);
    for (const s of steps ?? []) titles.set(s.id, s.title);
  }

  return sorted.map((e) => ({
    id: e.id,
    type: e.event_type,
    labelKey: timelineLabelKey(e.event_type, e.payload),
    params: safeTimelineParams(e.payload),
    at: e.created_at,
    actorName:
      e.actor_type === "human" && e.actor_id
        ? (names.get(`${e.household_id}:${e.actor_id}`) ?? null)
        : null,
    actorMemberId:
      e.actor_type === "human" && e.actor_id
        ? (memberIds.get(`${e.household_id}:${e.actor_id}`) ?? null)
        : null,
    actorType: e.actor_type,
    stepId: e.care_step_id ?? null,
    stepTitle: e.care_step_id ? (titles.get(e.care_step_id) ?? null) : null,
  }));
}

/** Human-readable labels for audit event types shown in the timeline. */
export const TIMELINE_EVENT_LABELS: Record<string, string> = {
  "extraction_started": "AI reading started",
  "extraction_succeeded": "AI draft created",
  "extraction_failed": "AI reading failed",
  "ambiguities_detected": "Missing information found",
  "owner_assigned": "Responsible person assigned",
  "step_approved": "Step confirmed by family member",
  "step_completed": "Step marked as done",
  "step_escalated": "Step escalated — deadline passed",
  "escalation_notified": "Escalation notification recorded",
  "evidence_uploaded": "Evidence uploaded",
  "appointment_clarified": "Appointment details added by family member",
  "household.created": "Household created",
  "household.member_added": "Member added",
};

export function labelForEvent(eventType: string): string {
  return TIMELINE_EVENT_LABELS[eventType] ?? eventType.replace(/_/g, " ");
}
