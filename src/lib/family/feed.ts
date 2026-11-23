/**
 * Family_Feed read layer (family-shared-care design, "Feed"; Requirements 4.1-4.6, 4.8-4.10,
 * 12.4, 12.10, 19.2, 19.4).
 *
 * `buildFeed` is pure: no I/O, no clock. `getFamilyFeed` reads with the person's RLS client, so
 * only rows of the Member's own household and reminders addressed to that Member come back.
 *
 * No free text leaves this module. A FeedEvent carries keys, counts, roles, member names, ISO
 * times, zones, and the chain title of a ready event. Feed item `params` are never read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSharedCareEvent } from "@/lib/care/queries";
import { effectiveApprovalState } from "@/lib/care/rules/approval";
import { eventNeedsSomeone, partNeedsSomeone } from "@/lib/care/rules/missing-details";
import type { PartSnapshot } from "@/lib/care/rules/types";
import { isUuid } from "@/lib/ids";
import type { Database } from "@/lib/supabase/database.types";
import type { EventPart, EventState, SharedCareEvent } from "@/lib/family/shared-care-event";

type Client = SupabaseClient<Database>;

/** Feed item kinds that decide the state of an event before its chain exists. */
export const FEED_KIND_CREATED = "event_created";
export const FEED_KIND_READY = "event_ready";
export const FEED_KIND_UNREADABLE = "event_unreadable";

/** A `feed_items` row reduced to what the feed needs. `params` is deliberately absent. */
export type FeedItemRow = {
  id: string;
  noteId: string | null;
  careChainId: string | null;
  kind: string;
  createdAt: string;
  recipientMemberId: string | null;
  seenAt: string | null;
};

export type FeedCounts = {
  parts: number;
  /** Open Parts that are unclaimed, have an unresolved Missing_Detail, or lack a confirmed deadline. */
  needsSomeone: number;
  /** Parts whose effective approval state is `pending`. */
  awaitingConfirmation: number;
  /** Parts that are `completed` or `cancelled`. */
  done: number;
};

export type NextAppointment = {
  /** ISO instant. Only a `human_confirmed` time is ever shown. */
  at: string;
  /** IANA zone, written out next to the time. */
  timeZone: string;
};

export type FeedEvent = {
  noteId: string;
  chainId: string | null;
  state: EventState;
  /** Chain title, only when the event is ready. Otherwise null and the UI uses the "Being read" key. */
  title: string | null;
  /** Dictionary key for the label shown when there is no title. */
  titleKey: "feed.heading.beingRead" | "feed.couldNotRead" | null;
  /** Failed reading: show the retry and view-original actions (Requirement 2.5). */
  retry: boolean;
  counts: FeedCounts;
  /** Every Part is completed or cancelled (Requirement 11.5). */
  done: boolean;
  needsSomeone: boolean;
  nextAppointment: NextAppointment | null;
  /** ISO time of the newest feed item of this note. */
  latestActivityAt: string;
  /** Newest feed item kind of this note. */
  latestKind: string;
  /** True when a household item of this note is newer than `last_seen_at` (Requirement 4.3). */
  unseen: boolean;
};

/** An In_App_Reminder addressed to the Member (Requirement 19.2). */
export type FeedReminder = {
  id: string;
  noteId: string | null;
  careChainId: string | null;
  kind: string;
  createdAt: string;
  seen: boolean;
};

export type FamilyFeed = {
  /** "Needs someone" events first, then the rest; each group newest activity first. */
  events: FeedEvent[];
  needsSomeone: FeedEvent[];
  other: FeedEvent[];
  reminders: FeedReminder[];
  unseenReminderCount: number;
  /** Events with unseen activity. */
  newCount: number;
};

function time(value: string): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

const CLOSED = new Set(["completed", "cancelled"]);

function toSnapshot(part: EventPart, householdId: string): PartSnapshot {
  const conf = (t: EventPart["confirmed"]["taskDue"]) =>
    t ? { at: new Date(t.at), timeZone: t.timeZone, provenance: t.provenance } : null;
  return {
    id: part.id,
    householdId,
    careCategory: part.careCategory,
    riskLevel: part.riskLevel,
    approvalRequired: part.approvalRequired,
    storedApprovalState: part.approvalState,
    legacyStatus: part.progressStatus,
    ownerId: part.owner?.id ?? null,
    driverId: part.driver?.id ?? null,
    companionId: part.companion?.id ?? null,
    backupOwnerId: part.backup?.id ?? null,
    taskDue: conf(part.confirmed.taskDue),
    respondBy: conf(part.confirmed.respondBy),
    evidenceRequired: part.evidence.required,
    evidenceAttached: part.evidence.attached.map((e) => e.label),
    planVersion: part.planVersion,
    rejectedAtPlanVersion: null,
  };
}

/** Open Parts only: a closed Part cannot need someone. */
function openParts(event: SharedCareEvent) {
  return event.parts
    .filter((p) => !CLOSED.has(String(p.progressStatus)))
    .map((p) => ({ part: toSnapshot(p, event.householdId), details: p.missingDetails }));
}

/** Pure counts of one event's Parts. */
export function countParts(event: Pick<SharedCareEvent, "parts" | "householdId">): FeedCounts {
  const open = openParts(event as SharedCareEvent);
  return {
    parts: event.parts.length,
    needsSomeone: open.filter((o) => partNeedsSomeone(o.part, o.details)).length,
    awaitingConfirmation: event.parts.filter(
      (p) =>
        !CLOSED.has(String(p.progressStatus)) &&
        effectiveApprovalState({
          approvalRequired: p.approvalRequired,
          storedApprovalState: p.approvalState,
          legacyStatus: String(p.progressStatus),
        }) === "pending",
    ).length,
    done: event.parts.filter((p) => CLOSED.has(String(p.progressStatus))).length,
  };
}

/** True when the event belongs in the "Needs someone" section (Requirements 4.4, 12.4, 12.10). */
export function isNeedsSomeoneEvent(event: SharedCareEvent): boolean {
  if (event.state !== "ready" || event.done) return false;
  return eventNeedsSomeone(openParts(event));
}

/** Earliest `human_confirmed` appointment that is not in the past and not on a closed Part. */
export function nextAppointmentOf(event: SharedCareEvent, now: Date): NextAppointment | null {
  let best: NextAppointment | null = null;
  for (const part of event.parts) {
    if (CLOSED.has(String(part.progressStatus))) continue;
    const t = part.confirmed.appointment;
    if (!t || t.provenance !== "human_confirmed") continue;
    if (time(t.at) < now.getTime()) continue;
    if (!best || time(t.at) < time(best.at)) best = { at: t.at, timeZone: t.timeZone };
  }
  return best;
}

/** The state shown for one note: the event state, refined by its newest feed item before a chain exists. */
function stateFor(event: SharedCareEvent, latestKind: string): EventState {
  if (event.state !== "uploaded") return event.state;
  if (latestKind === FEED_KIND_UNREADABLE) return "failed";
  if (latestKind === FEED_KIND_CREATED) return "reading";
  return "uploaded";
}

/**
 * Builds the feed from feed rows and the events of the notes they mention.
 *
 * - One FeedEvent per note that has at least one household feed item and a visible event.
 * - The newest item of a note decides its activity time and kind (ties: later id).
 * - "Being read" is shown while the state is `reading`; once the event is ready the title appears.
 * - Reminders are the rows addressed to `memberId`; rows addressed to others are dropped.
 * - `lastSeenAt` null means the Member has never opened the feed: everything is new.
 */
export function buildFeed(
  rows: readonly FeedItemRow[],
  events: ReadonlyMap<string, SharedCareEvent>,
  now: Date,
  lastSeenAt: string | null,
  memberId: string,
): FamilyFeed {
  const seenAfter = lastSeenAt === null ? Number.NEGATIVE_INFINITY : time(lastSeenAt);
  const newest = new Map<string, FeedItemRow>();
  const unseenNotes = new Set<string>();
  const reminders: FeedReminder[] = [];

  for (const row of rows) {
    if (row.recipientMemberId !== null) {
      if (row.recipientMemberId !== memberId) continue;
      reminders.push({
        id: row.id,
        noteId: row.noteId,
        careChainId: row.careChainId,
        kind: row.kind,
        createdAt: row.createdAt,
        seen: row.seenAt !== null,
      });
      continue;
    }
    if (!row.noteId) continue;
    const cur = newest.get(row.noteId);
    if (!cur || time(row.createdAt) > time(cur.createdAt) || (time(row.createdAt) === time(cur.createdAt) && row.id > cur.id)) {
      newest.set(row.noteId, row);
    }
    if (time(row.createdAt) > seenAfter) unseenNotes.add(row.noteId);
  }

  const built: FeedEvent[] = [];
  for (const [noteId, item] of newest) {
    const event = events.get(noteId);
    if (!event) continue;
    const state = stateFor(event, item.kind);
    const ready = state === "ready";
    built.push({
      noteId,
      chainId: ready ? event.chainId : null,
      state,
      title: ready ? event.title : null,
      titleKey: ready ? null : state === "failed" ? "feed.couldNotRead" : "feed.heading.beingRead",
      retry: state === "failed",
      counts: ready ? countParts(event) : { parts: 0, needsSomeone: 0, awaitingConfirmation: 0, done: 0 },
      done: ready && event.done,
      needsSomeone: ready && isNeedsSomeoneEvent(event),
      nextAppointment: ready ? nextAppointmentOf(event, now) : null,
      latestActivityAt: item.createdAt,
      latestKind: item.kind,
      unseen: unseenNotes.has(noteId),
    });
  }

  built.sort(
    (a, b) =>
      time(b.latestActivityAt) - time(a.latestActivityAt) ||
      (a.noteId < b.noteId ? 1 : a.noteId > b.noteId ? -1 : 0),
  );
  const needsSomeone = built.filter((e) => e.needsSomeone);
  const other = built.filter((e) => !e.needsSomeone);

  reminders.sort(
    (a, b) => time(b.createdAt) - time(a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );

  return {
    events: [...needsSomeone, ...other],
    needsSomeone,
    other,
    reminders,
    unseenReminderCount: reminders.filter((r) => !r.seen).length,
    newCount: built.filter((e) => e.unseen).length,
  };
}

/** Feed rows read at most; design: limit 50. */
export const FEED_LIMIT = 50;

/**
 * Reads the Family_Feed for one Member with the RLS client.
 * Throws a code-only error on a failed query so no row content reaches logs.
 */
export async function getFamilyFeed(
  supabase: Client,
  householdId: string,
  memberId: string,
  now: Date = new Date(),
): Promise<FamilyFeed> {
  if (!isUuid(householdId) || !isUuid(memberId)) {
    return buildFeed([], new Map(), now, null, memberId);
  }
  const [itemsRes, stateRes] = await Promise.all([
    supabase
      .from("feed_items")
      .select("id, note_id, care_chain_id, kind, created_at, recipient_member_id, seen_at")
      .eq("household_id", householdId)
      .or(`recipient_member_id.is.null,recipient_member_id.eq.${memberId}`)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(FEED_LIMIT),
    supabase
      .from("member_feed_state")
      .select("last_seen_at")
      .eq("household_id", householdId)
      .eq("member_id", memberId)
      .maybeSingle(),
  ]);
  if (itemsRes.error) throw new Error("family_feed_items_query_failed");
  if (stateRes.error) throw new Error("family_feed_state_query_failed");

  const rows: FeedItemRow[] = (itemsRes.data ?? []).map((r) => ({
    id: r.id,
    noteId: r.note_id,
    careChainId: r.care_chain_id,
    kind: r.kind,
    createdAt: r.created_at,
    recipientMemberId: r.recipient_member_id,
    seenAt: r.seen_at,
  }));

  const noteIds = [
    ...new Set(rows.filter((r) => r.recipientMemberId === null && r.noteId).map((r) => r.noteId as string)),
  ];
  const loaded = await Promise.all(noteIds.map((id) => getSharedCareEvent(supabase, id)));
  const events = new Map<string, SharedCareEvent>();
  for (const e of loaded) {
    // The household filter keeps another household's event out even if a note id leaked.
    if (e && e.householdId === householdId) events.set(e.noteId, e);
  }
  return buildFeed(rows, events, now, stateRes.data?.last_seen_at ?? null, memberId);
}
