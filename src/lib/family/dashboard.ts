/**
 * Family Dashboard Beta: what one signed-in member should see first, and what they may do.
 *
 * Pure: no I/O, no clock (callers pass `now`), no dictionary. Every offer comes from
 * `computeOffers` and the rule module, the same rules the SQL functions apply. The server stays
 * the authority: a button shown here is still re-checked when it is pressed. Nothing here
 * chooses a person for a task; a claim is always the signed-in member's own act.
 */
import { decideApproval, effectiveApprovalState } from "@/lib/care/rules/approval";
import { decideCompletion } from "@/lib/care/rules/completion";
import type { HelperRole } from "@/lib/care/rules/types";
import { buildEventCard } from "./event-card";
import {
  computeOffers,
  toMemberSnapshot,
  toPartSnapshot,
  type EventViewer,
  type ReceiverOption,
} from "./event-offers";
import { cardInlineActions, nextStep, type InlineAction } from "./inline-actions";
import type { EventPart, PendingRequestView, SharedCareEvent } from "./shared-care-event";

const CLOSED = new Set(["completed", "cancelled"]);
export const isClosedPart = (p: Pick<EventPart, "progressStatus">): boolean => CLOSED.has(String(p.progressStatus));

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export type Progress = { done: number; total: number };

/** Completed Parts out of the Parts that still count. A cancelled Part is not counted. */
export function eventProgress(event: Pick<SharedCareEvent, "parts" | "state">): Progress {
  if (event.state !== "ready") return { done: 0, total: 0 };
  const counted = event.parts.filter((p) => p.progressStatus !== "cancelled");
  return { done: counted.filter((p) => p.progressStatus === "completed").length, total: counted.length };
}

/** Parts that are completed in `next` but were open in `prev`: the moments worth a small celebration. */
export function newlyCompleted(
  prev: readonly Pick<EventPart, "id" | "progressStatus">[],
  next: readonly Pick<EventPart, "id" | "progressStatus">[],
): string[] {
  const before = new Map(prev.map((p) => [p.id, String(p.progressStatus)]));
  return next
    .filter((p) => p.progressStatus === "completed" && before.has(p.id) && before.get(p.id) !== "completed")
    .map((p) => p.id);
}

// ---------------------------------------------------------------------------
// The viewer's next step
// ---------------------------------------------------------------------------

export type WaitReason =
  | "reading"
  | "failed"
  | "done"
  | "confirmation"
  | "request"
  | "helper"
  | "recipient"
  | "nothing";

export type ViewerStep =
  /** A request addressed to the viewer waits for an answer. */
  | { kind: "respond"; partId: string; partTitle: string; request: PendingRequestView }
  /** The first action the viewer may take on this event. */
  | { kind: "action"; action: InlineAction; partTitle: string }
  /** Reading failed; the viewer may start it again on the same photo. */
  | { kind: "retry" }
  /** Nothing for the viewer to press. `name` is who the event waits on, when someone does. */
  | { kind: "wait"; reason: WaitReason; partId: string | null; partTitle: string | null; name: string | null };

/** Parts in the order the card shows them: the Main_Slot Part, then the others. */
export function cardOrder(event: SharedCareEvent): EventPart[] {
  const card = buildEventCard(event);
  const ids = card.main ? [card.main.partId, ...card.items.map((i) => i.partId)] : [];
  return ids.flatMap((id) => event.parts.filter((p) => p.id === id));
}

function awaitsApproval(part: EventPart): boolean {
  if (isClosedPart(part) || !part.approvalRequired) return false;
  const state = effectiveApprovalState({
    approvalRequired: part.approvalRequired,
    storedApprovalState: part.approvalState,
    legacyStatus: String(part.progressStatus),
  });
  return state === "pending";
}

function waitFor(event: SharedCareEvent, viewer: EventViewer): ViewerStep {
  const open = cardOrder(event).filter((p) => !isClosedPart(p));
  const wait = (reason: WaitReason, part: EventPart | null, name: string | null = null): ViewerStep => ({
    kind: "wait",
    reason,
    partId: part?.id ?? null,
    partTitle: part?.title ?? null,
    name,
  });
  if (viewer.role === "care_recipient") return wait("recipient", open[0] ?? null);
  const confirming = open.find(awaitsApproval);
  if (confirming) return wait("confirmation", confirming);
  const asked = open.find((p) => p.pendingRequests.some((r) => r.to.id !== viewer.memberId));
  if (asked) {
    const request = asked.pendingRequests.find((r) => r.to.id !== viewer.memberId)!;
    return wait("request", asked, request.to.name);
  }
  const helped = open.find((p) => p.owner !== null && p.owner.id !== viewer.memberId);
  if (helped) return wait("helper", helped, helped.owner!.name);
  return wait("nothing", open[0] ?? null);
}

/**
 * The first thing this member can do on this event, or what it waits on.
 * Order: answer a request addressed to you, then the card's Next_Step (confirm, place, drive,
 * go along, take charge, an item's "I'll do it", done), then any other offered action.
 */
export function viewerStep(
  event: SharedCareEvent,
  viewer: EventViewer,
  members: readonly ReceiverOption[],
  now: Date,
): ViewerStep {
  const none = (reason: WaitReason): ViewerStep => ({ kind: "wait", reason, partId: null, partTitle: null, name: null });
  if (event.state === "reading" || event.state === "uploaded") return none("reading");
  if (event.state === "failed") {
    return event.retryable && viewer.role !== "care_recipient" ? { kind: "retry" } : none("failed");
  }
  if (event.done) return none("done");
  if (viewer.role !== "care_recipient") {
    for (const part of cardOrder(event)) {
      if (isClosedPart(part)) continue;
      const request = computeOffers(part, viewer, members, now).respond[0];
      if (request) return { kind: "respond", partId: part.id, partTitle: part.title, request };
    }
    const actions = cardInlineActions(event, buildEventCard(event), viewer, members, now);
    const first = nextStep(actions) ?? actions[0] ?? null;
    if (first) {
      const title = event.parts.find((p) => p.id === first.partId)?.title ?? "";
      return { kind: "action", action: first, partTitle: title };
    }
  }
  return waitFor(event, viewer);
}

const TIER: Record<ViewerStep["kind"], number> = { respond: 0, action: 1, retry: 2, wait: 3 };
const WAIT_TIER: Partial<Record<WaitReason, number>> = { reading: 1, failed: 1, done: 2 };

function tierOf(step: ViewerStep): number {
  if (step.kind !== "wait") return TIER[step.kind];
  return TIER.wait + (WAIT_TIER[step.reason] ?? 0);
}

export type Focus = { event: SharedCareEvent; step: ViewerStep };

/**
 * The most actionable event for this member: one with a request for them, then one where they
 * can act, then a failed reading they can retry, then an open event, then one being read, then
 * a finished one. Ties keep the input order (the feed's order: needs someone first, newest first).
 */
export function pickFocus(
  events: readonly SharedCareEvent[],
  viewer: EventViewer,
  members: readonly ReceiverOption[],
  now: Date,
): Focus | null {
  let best: { focus: Focus; tier: number } | null = null;
  for (const event of events) {
    const step = viewerStep(event, viewer, members, now);
    const tier = tierOf(step);
    if (best === null || tier < best.tier) best = { focus: { event, step }, tier };
  }
  return best?.focus ?? null;
}

// ---------------------------------------------------------------------------
// Drag a face onto a role: the same claim as the button
// ---------------------------------------------------------------------------

export type ClaimTarget = { partId: string; role: HelperRole };

const ROLE_ORDER: readonly HelperRole[] = ["owner", "driver", "companion"];

/** Every role the signed-in member may claim right now, Part by Part in card order. */
export function claimTargets(
  event: SharedCareEvent,
  viewer: EventViewer,
  members: readonly ReceiverOption[],
  now: Date,
): ClaimTarget[] {
  if (event.state !== "ready" || viewer.role === "care_recipient") return [];
  const out: ClaimTarget[] = [];
  for (const part of cardOrder(event)) {
    if (isClosedPart(part)) continue;
    const offered = computeOffers(part, viewer, members, now).claim;
    for (const role of ROLE_ORDER) if (offered.includes(role)) out.push({ partId: part.id, role });
  }
  return out;
}

/**
 * The claim a drop asks for, or null when the face was dropped somewhere that is not one of the
 * member's own claim targets. The result goes to the same `claimPart` Server Action as the button.
 */
export function dropClaimInput(
  targets: readonly ClaimTarget[],
  dropped: ClaimTarget | null,
): { stepId: string; role: HelperRole } | null {
  if (!dropped) return null;
  const ok = targets.some((t) => t.partId === dropped.partId && t.role === dropped.role);
  return ok ? { stepId: dropped.partId, role: dropped.role } : null;
}

// ---------------------------------------------------------------------------
// Why a button is not available yet
// ---------------------------------------------------------------------------

export type Blocker =
  /** The Owner cannot mark it done until a primary caregiver confirms it. */
  | { kind: "needsConfirmation" }
  /** The confirmation was refused; the Owner must send it again first. */
  | { kind: "notApproved" }
  /** Another primary caregiver has to confirm the Owner's own Part. */
  | { kind: "selfApproval" }
  /** Marking it done records it as waiting for these items of proof. */
  | { kind: "needsProof"; missing: string[] };

/**
 * Reasons shown next to a disabled or limited button for this member on this Part. Only the
 * Owner sees completion reasons. `activePrimaryCount` is the number of active primary caregivers
 * the page knows of; the server counts again at the moment of the action.
 */
export function partBlockers(part: EventPart, viewer: EventViewer, activePrimaryCount: number): Blocker[] {
  if (isClosedPart(part) || viewer.role === "care_recipient") return [];
  const snap = toPartSnapshot(part, viewer.householdId);
  const actor = toMemberSnapshot(viewer);
  const out: Blocker[] = [];
  if (part.owner?.id === viewer.memberId) {
    const completion = decideCompletion(snap, actor);
    const state = effectiveApprovalState(snap);
    if (!completion.ok && completion.code === "approval_pending") {
      out.push(state === "rejected" ? { kind: "notApproved" } : { kind: "needsConfirmation" });
    }
    // Proof is optional: it never blocks or changes "Mark as done".
  }
  if (viewer.role === "primary_caregiver" && awaitsApproval(part)) {
    const decision = decideApproval(snap, actor, activePrimaryCount, "approve");
    if (!decision.ok && decision.code === "self_approval_blocked") out.push({ kind: "selfApproval" });
  }
  return out;
}

/** True when the Owner's "Mark as done" must stay disabled. Proof alone does not block it. */
export function completionLocked(blockers: readonly Blocker[]): boolean {
  return blockers.some((b) => b.kind === "needsConfirmation" || b.kind === "notApproved");
}

/** Active primary caregivers in the member list. */
export function primaryCount(members: readonly ReceiverOption[]): number {
  return members.filter((m) => m.role === "primary_caregiver").length;
}
