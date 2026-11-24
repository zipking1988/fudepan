/**
 * The interactive demo at `/demo`: one fictional household and one note, kept in
 * the browser only. Nothing here reads or writes Supabase or calls ai&.
 *
 * The demo applies the same rule module the server uses (claims, approval,
 * completion), so a button that works here works the same way in the real app.
 * Pure: no I/O and no clock.
 */
import { zonedTimeToInstant } from "@/lib/care/appointment";
import { decideApproval } from "@/lib/care/rules/approval";
import { decideClaim, decideRelease } from "@/lib/care/rules/claims";
import { decideCompletion } from "@/lib/care/rules/completion";
import { refusalMessageKey } from "@/lib/care/rules/refusals";
import type { HelperRole } from "@/lib/care/rules/types";
import { toMemberSnapshot, toPartSnapshot, type EventViewer, type ReceiverOption } from "./event-offers";
import { isEventDone, type EventPart, type MemberRef, type SharedCareEvent } from "./shared-care-event";

export const DEMO_HOUSEHOLD = "de000000-0000-4000-8000-000000000001";
export const DEMO_NOTE = "de000000-0000-4000-8000-0000000000a1";
export const DEMO_ZONE = "Asia/Tokyo";

/** Fictional people. Haruko is the care recipient; the others are family. */
export const DEMO_RECIPIENT = { id: "de000000-0000-4000-8000-000000000101", name: "春子（母）" };
export const DEMO_MEMBERS: ReceiverOption[] = [
  { id: "de000000-0000-4000-8000-000000000102", name: "Misa", role: "primary_caregiver" },
  { id: "de000000-0000-4000-8000-000000000103", name: "Kenta", role: "family_member" },
  { id: "de000000-0000-4000-8000-000000000104", name: "Yui", role: "family_member" },
];

const PART_VISIT = "de000000-0000-4000-8000-0000000000b1";
const PART_CARD = "de000000-0000-4000-8000-0000000000b2";
const PART_GLASSES = "de000000-0000-4000-8000-0000000000b3";

const noTimes = { appointment: null, respondBy: null, taskDue: null };

function basePart(overrides: Partial<EventPart> & Pick<EventPart, "id" | "title" | "careCategory">): EventPart {
  return {
    description: null,
    riskLevel: "medium",
    progressStatus: "pending_review",
    sourceQuote: null,
    confidence: 0.9,
    approvalRequired: false,
    approvalState: "not_required",
    planVersion: 0,
    owner: null,
    driver: null,
    companion: null,
    backup: null,
    suggestedRole: null,
    personToAsk: null,
    location: null,
    confirmed: noTimes,
    suggested: noTimes,
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

/** The note as ai& would have read it: the time is only "from the note" and the clinic is unknown. */
export function initialDemoEvent(language: "en" | "ja"): SharedCareEvent {
  const ja = language === "ja";
  const kenta = DEMO_MEMBERS[1];
  return {
    noteId: DEMO_NOTE,
    householdId: DEMO_HOUSEHOLD,
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "de000000-0000-4000-8000-0000000000c1",
    title: ja ? "病院へ行く" : "Clinic visit",
    riskLevel: "high",
    createdAt: "2026-11-23T02:00:00Z",
    done: false,
    parts: [
      basePart({
        id: PART_VISIT,
        title: ja ? "病院へ行く" : "Go to the clinic",
        careCategory: "appointment",
        riskLevel: "high",
        approvalRequired: true,
        approvalState: "pending",
        sourceQuote: "2026/11/27（金）14:30 病院",
        personToAsk: "Misa",
        owner: { id: kenta.id, name: kenta.name },
      }),
      basePart({
        id: PART_CARD,
        title: ja ? "保険証" : "Insurance card",
        careCategory: "document",
        sourceQuote: "保険証",
      }),
      basePart({
        id: PART_GLASSES,
        title: ja ? "眼鏡" : "Glasses",
        careCategory: "household",
        riskLevel: "low",
        sourceQuote: "眼鏡",
      }),
    ],
  };
}

export type DemoResult =
  | { ok: true; event: SharedCareEvent; messageKey?: string }
  | { ok: false; messageKey: string };

const HOLDER_FIELD = { owner: "owner", driver: "driver", companion: "companion" } as const;

function memberRef(viewer: EventViewer): MemberRef {
  const m = DEMO_MEMBERS.find((x) => x.id === viewer.memberId);
  return { id: viewer.memberId, name: m?.name ?? null };
}

function refuse(code: Parameters<typeof refusalMessageKey>[0]): DemoResult {
  return { ok: false, messageKey: refusalMessageKey(code) };
}

function withPart(event: SharedCareEvent, stepId: string, change: (p: EventPart) => EventPart): SharedCareEvent {
  const parts = event.parts.map((p) => (p.id === stepId ? change(p) : p));
  return { ...event, parts, done: isEventDone(parts) };
}

/** A change to people or key facts sends an approved high-risk visit back to "Requires confirmation". */
function resetApproval(p: EventPart): EventPart {
  return p.approvalRequired && p.approvalState === "approved" ? { ...p, approvalState: "pending" } : p;
}

type Input = Record<string, unknown>;

/** Applies one family action to the demo event, using the shared rules. */
export function applyDemoAction(
  event: SharedCareEvent,
  viewer: EventViewer,
  action: string,
  input: Input,
): DemoResult {
  const stepId = String(input.stepId ?? "");
  const part = event.parts.find((p) => p.id === stepId);
  if (!part) return { ok: true, event, messageKey: "demo.notInDemo" };
  const snap = toPartSnapshot(part, event.householdId);
  const actor = toMemberSnapshot(viewer);
  const primaries = DEMO_MEMBERS.filter((m) => m.role === "primary_caregiver").length;

  switch (action) {
    case "claimPart": {
      const role = input.role as HelperRole;
      const d = decideClaim(snap, actor, role);
      if (!d.ok) return refuse(d.code);
      const next = withPart(event, stepId, (p) =>
        resetApproval({ ...p, [HOLDER_FIELD[role]]: memberRef(viewer), progressStatus: p.progressStatus === "pending_review" ? "in_progress" : p.progressStatus }),
      );
      return { ok: true, event: next };
    }
    case "releasePart": {
      const role = input.role as HelperRole;
      const d = decideRelease(snap, actor, role, new Date(0));
      if (!d.ok) return refuse(d.code);
      return { ok: true, event: withPart(event, stepId, (p) => resetApproval({ ...p, [HOLDER_FIELD[role]]: null })) };
    }
    case "decideApproval": {
      const decision = input.decision === "reject" ? "reject" : "approve";
      const d = decideApproval(snap, actor, primaries, decision);
      if (!d.ok) return refuse(d.code);
      return { ok: true, event: withPart(event, stepId, (p) => ({ ...p, approvalState: d.value.state })) };
    }
    case "completePart": {
      const d = decideCompletion(snap, actor);
      if (!d.ok) return refuse(d.code);
      if (d.value.outcome !== "completed") return { ok: true, event, messageKey: "demo.notInDemo" };
      return { ok: true, event: withPart(event, stepId, (p) => ({ ...p, progressStatus: "completed" })) };
    }
    case "saveAppointment":
    case "confirmPartTime": {
      if (viewer.role === "care_recipient") return refuse("recipient_read_only");
      const zone = typeof input.timeZone === "string" && input.timeZone ? input.timeZone : DEMO_ZONE;
      const instant = zonedTimeToInstant(String(input.localDate ?? ""), String(input.localTime ?? ""), zone);
      if (!instant.ok) return { ok: false, messageKey: "event.result.error" };
      const location = typeof input.location === "string" ? input.location.trim() : "";
      const time = { at: instant.instant.toISOString(), timeZone: zone, provenance: "human_confirmed" as const };
      const next = withPart(event, stepId, (p) =>
        resetApproval({
          ...p,
          location: location || p.location,
          confirmed: { ...p.confirmed, appointment: time },
          planVersion: p.planVersion + 1,
        }),
      );
      return { ok: true, event: next };
    }
    default:
      return { ok: true, event, messageKey: "demo.notInDemo" };
  }
}
