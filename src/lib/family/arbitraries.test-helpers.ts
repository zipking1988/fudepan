/**
 * Shared builders and fast-check arbitraries for the family card tests.
 *
 * Test-only: imported by `*.test.ts` files, never by app code. The arbitraries stay inside what
 * the database allows (a Driver or Companion only on travel Parts, approval required on every
 * high-risk Part), so the properties exercise real states instead of impossible ones.
 */
import fc from "fast-check";
import { CARE_CATEGORIES, type CareCategory } from "@/lib/ai/schema";
import { isHighRiskPart } from "@/lib/care/rules/approval";
import type { ApprovalState } from "@/lib/care/rules/types";
import type { HouseholdRole } from "@/lib/households/membership";
import type { EventViewer, ReceiverOption } from "./event-offers";
import {
  isEventDone,
  type EventPart,
  type EventState,
  type MemberRef,
  type PendingRequestView,
  type SharedCareEvent,
} from "./shared-care-event";

export const HOUSEHOLD_ID = "h1";

/** Four household members. Tests may rename them, but the ids stay m1 to m4. */
export const MEMBERS: readonly MemberRef[] = [
  { id: "m1", name: "Kenta" },
  { id: "m2", name: "Misa" },
  { id: "m3", name: "Aki" },
  { id: "m4", name: "Yui" },
];
export const MEMBER_IDS: readonly string[] = MEMBERS.map((m) => m.id);

const NO_TIMES = { appointment: null, respondBy: null, taskDue: null } as const;

export function part(id: string, overrides: Partial<EventPart> = {}): EventPart {
  return {
    id,
    title: id,
    description: null,
    careCategory: "household",
    riskLevel: "low",
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
    confirmed: NO_TIMES,
    suggested: NO_TIMES,
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

export function event(parts: EventPart[], overrides: Partial<SharedCareEvent> = {}): SharedCareEvent {
  return {
    noteId: "n1",
    householdId: HOUSEHOLD_ID,
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "c1",
    title: "Clinic visit",
    riskLevel: "high",
    createdAt: "2026-11-23T11:50:20Z",
    parts,
    done: isEventDone(parts),
    ...overrides,
  };
}

const STATUSES = [
  "pending_review",
  "needs_clarification",
  "in_progress",
  "evidence_required",
  "escalated",
  "completed",
  "failed",
  "cancelled",
] as const;
const TITLES = ["Clinic visit", "Pick up glasses", "Bring insurance card", "Ride home", "Call the pharmacy"];
const QUOTES = ["Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.", "Ask Misa which clinic.", "Pick up my glasses."];
const TRAVEL: readonly CareCategory[] = ["appointment", "transport"];
const ROLES: readonly HouseholdRole[] = [
  "primary_caregiver",
  "family_member",
  "transport_coordinator",
  "medical_coordinator",
  "care_recipient",
];

function arbHolder(members: readonly MemberRef[]): fc.Arbitrary<MemberRef | null> {
  return fc.option(fc.constantFrom(...members), { nil: null, freq: 2 });
}

function arbRequest(partId: string, members: readonly MemberRef[]): fc.Arbitrary<PendingRequestView> {
  return fc
    .record({
      kind: fc.constantFrom("handover", "assignment", "backup"),
      role: fc.constantFrom("owner", "driver", "companion"),
      from: fc.constantFrom(...members),
      to: fc.constantFrom(...members),
    })
    .map(({ kind, role, from, to }) => ({
      id: `${partId}-request`,
      kind,
      helperRole: kind === "backup" ? null : kind === "assignment" ? "owner" : role,
      from,
      to,
      createdAt: "2026-11-24T00:00:00Z",
      expiresAt: "2026-11-25T00:00:00Z",
    }));
}

/** One Part with the given id. Holders come from `members`. */
export function arbPart(id: string, members: readonly MemberRef[] = MEMBERS): fc.Arbitrary<EventPart> {
  return fc
    .record({
      careCategory: fc.constantFrom(...CARE_CATEGORIES),
      riskLevel: fc.constantFrom("low" as const, "medium" as const, "high" as const),
      wantsApproval: fc.boolean(),
      approval: fc.constantFrom<ApprovalState>("pending", "approved", "rejected"),
      progressStatus: fc.constantFrom(...STATUSES),
      title: fc.constantFrom(...TITLES),
      sourceQuote: fc.option(fc.constantFrom(...QUOTES), { nil: null }),
      personToAsk: fc.option(fc.constant("Misa"), { nil: null }),
      location: fc.option(fc.constant("Sakura Clinic"), { nil: null }),
      owner: arbHolder(members),
      driver: arbHolder(members),
      companion: arbHolder(members),
      backup: arbHolder(members),
      evidenceRequired: fc.subarray(["Receipt photo"]),
      evidenceAttached: fc.boolean(),
      request: fc.option(arbRequest(id, members), { nil: null, freq: 3 }),
    })
    .map((r) => {
      const travel = TRAVEL.includes(r.careCategory);
      const highRisk = isHighRiskPart({ riskLevel: r.riskLevel, careCategory: r.careCategory });
      const approvalRequired = highRisk || r.wantsApproval;
      const attached = r.evidenceAttached
        ? r.evidenceRequired.map((label, i) => ({ id: `${id}-e${i}`, kind: "text", label }))
        : [];
      return part(id, {
        title: r.title,
        careCategory: r.careCategory,
        riskLevel: r.riskLevel,
        approvalRequired,
        approvalState: approvalRequired ? r.approval : "not_required",
        progressStatus: r.progressStatus,
        sourceQuote: r.sourceQuote,
        personToAsk: r.personToAsk,
        location: travel ? r.location : null,
        owner: r.owner,
        driver: travel ? r.driver : null,
        companion: travel ? r.companion : null,
        backup: r.backup,
        pendingRequests: r.request ? [r.request] : [],
        evidence: { required: r.evidenceRequired, attachedCount: attached.length, attached },
      });
    });
}

function arbParts(noteId: string, members: readonly MemberRef[], max = 4): fc.Arbitrary<EventPart[]> {
  return fc
    .integer({ min: 0, max })
    .chain((n) =>
      n === 0
        ? fc.constant<EventPart[]>([])
        : fc.tuple(...Array.from({ length: n }, (_, i) => arbPart(`${noteId}-p${i}`, members))),
    );
}

const STATES: readonly EventState[] = ["ready", "reading", "failed", "uploaded"];

/** One event. Only a `ready` event has Parts, as in the read layer. */
export function arbSharedCareEvent(
  options: { states?: readonly EventState[]; noteId?: string; members?: readonly MemberRef[] } = {},
): fc.Arbitrary<SharedCareEvent> {
  const noteId = options.noteId ?? "n1";
  const members = options.members ?? MEMBERS;
  return fc
    .tuple(fc.constantFrom(...(options.states ?? STATES)), arbParts(noteId, members))
    .map(([state, parts]) => {
      const shown = state === "ready" ? parts : [];
      return event(shown, {
        noteId,
        state,
        chainId: state === "ready" ? `${noteId}-c` : null,
        retryable: state === "failed",
        title: state === "ready" ? "Clinic visit" : null,
      });
    });
}

/** Up to four events with distinct note ids. */
export function arbEvents(options: { members?: readonly MemberRef[] } = {}): fc.Arbitrary<SharedCareEvent[]> {
  return fc
    .integer({ min: 0, max: 4 })
    .chain((n) =>
      n === 0
        ? fc.constant<SharedCareEvent[]>([])
        : fc.tuple(
            ...Array.from({ length: n }, (_, i) =>
              arbSharedCareEvent({ noteId: `n${i + 1}`, members: options.members }),
            ),
          ),
    );
}

export const arbViewer: fc.Arbitrary<EventViewer> = fc.record({
  memberId: fc.constantFrom(...MEMBER_IDS),
  householdId: fc.constant(HOUSEHOLD_ID),
  role: fc.constantFrom(...ROLES),
});

/** The household's active members as the event page lists them: a subset of m1 to m4. */
export const arbMemberList: fc.Arbitrary<ReceiverOption[]> = fc
  .subarray([...MEMBERS], { minLength: 1 })
  .chain((picked) =>
    fc.tuple(...picked.map(() => fc.constantFrom(...ROLES))).map((roles) =>
      picked.map((m, i) => ({ id: m.id, name: m.name ?? "", role: roles[i] })),
    ),
  );

/** A reordering of `list`. */
export function arbShuffled<T>(list: readonly T[]): fc.Arbitrary<T[]> {
  return fc
    .array(fc.nat(), { minLength: list.length, maxLength: list.length })
    .map((keys) =>
      list
        .map((item, i) => ({ item, key: keys[i] ?? 0, i }))
        .sort((a, b) => a.key - b.key || a.i - b.i)
        .map((x) => x.item),
    );
}

export const arbNow: fc.Arbitrary<Date> = fc.date({
  min: new Date("2026-11-20T00:00:00Z"),
  max: new Date("2026-12-05T00:00:00Z"),
  noInvalidDate: true,
});
