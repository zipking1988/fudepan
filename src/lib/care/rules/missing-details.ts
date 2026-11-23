/**
 * Missing_Details and the "Needs someone" membership (family-shared-care design,
 * Property 25; Requirements 4.4, 5.3, 6.5, 10.1, 10.5, 10.6, 12.4).
 *
 * Pure: no I/O, no clock, no server-only imports.
 *
 * Rules kept here:
 * - A Person_To_Ask is only a hint on the place detail. It never creates an Owner or Claim.
 * - A stored detail is resolved only by a human answer (resolvedBy + non-blank answer).
 * - The appointment time is answered only by a `human_confirmed` time. A model-suggested
 *   time never answers it, and no deadline is derived from it.
 * - Question and reason are dictionary keys, never free text, so feeds and logs stay free of
 *   sensitive words. The only free text is the ai& question, shown only in the Event_View.
 */
import type { ConfirmedTime, PartSnapshot } from "@/lib/care/rules/types";

export const MISSING_DETAIL_KINDS = [
  "date",
  "time",
  "location",
  "person",
  "document",
  "amount",
  "contact",
] as const;

export type MissingDetailKind = (typeof MISSING_DETAIL_KINDS)[number];

/** Dictionary keys for questions. `ai_question` means "show the stored ai& text". */
export type MissingDetailQuestionCode =
  | "which_clinic"
  | "which_date"
  | "which_time"
  | "which_amount"
  | "who_will_drive"
  | "when_is_deadline"
  | "which_person"
  | "which_document"
  | "which_contact"
  | "ai_question";

/** A `part_missing_details` row (design, Data models), reduced to what the rules need. */
export type StoredMissingDetail = {
  id: string;
  kind: MissingDetailKind;
  questionCode: MissingDetailQuestionCode;
  /** Text from ai&. Event_View only. */
  aiQuestion: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  answer: string | null;
};

/** The facts about a Part that `PartSnapshot` does not carry. */
export type MissingDetailFacts = {
  /** Appointment place, as saved by a human. */
  location: string | null;
  /** Appointment time. Counts only when `provenance === "human_confirmed"`. */
  appointmentTime: ConfirmedTime | null;
  /** Appointment date, as saved by a human (for example "2026-11-27"). */
  appointmentDate: string | null;
  requiredAmountMinor: number | null;
  /** Text only, for example "Misa". Never an owner. */
  personToAsk: string | null;
};

export type MissingDetailPart = PartSnapshot & MissingDetailFacts;

export type MissingDetail = {
  /** Stable per Part and detail, for React keys and tests. */
  key: string;
  kind: MissingDetailKind;
  questionCode: MissingDetailQuestionCode;
  /** Dictionary key explaining why the detail is needed. */
  reasonCode: string;
  source: "stored" | "derived";
  /** Set for stored details so a human answer can resolve exactly this row. */
  storedDetailId: string | null;
  aiQuestion: string | null;
  /** Hint only. Set on the place detail. */
  personToAsk: string | null;
  /** "Needs details" for date, time, or location of an appointment. */
  needsDetails: boolean;
};

const REASON: Record<MissingDetailKind, string> = {
  date: "missing.reason.date",
  time: "missing.reason.time",
  location: "missing.reason.location",
  person: "missing.reason.person",
  document: "missing.reason.document",
  amount: "missing.reason.amount",
  contact: "missing.reason.contact",
};

/** Date, time, and location block deadlines and show the Part as "Needs details". */
const NEEDS_DETAILS_KINDS: ReadonlySet<MissingDetailKind> = new Set(["date", "time", "location"]);

function isBlank(value: string | null | undefined): boolean {
  return value == null || value.trim() === "";
}

function cleanHint(value: string | null): string | null {
  return isBlank(value) ? null : value!.trim();
}

/** Resolved only by a human: someone resolved it, with a real answer. */
export function isStoredDetailResolved(detail: StoredMissingDetail): boolean {
  return detail.resolvedAt !== null && !isBlank(detail.resolvedBy) && !isBlank(detail.answer);
}

/** The appointment time is answered only by a human-confirmed time. */
export function hasConfirmedAppointmentTime(part: Pick<MissingDetailFacts, "appointmentTime">): boolean {
  return part.appointmentTime?.provenance === "human_confirmed";
}

export function hasHumanConfirmedTime(part: Pick<PartSnapshot, "taskDue" | "respondBy">): boolean {
  return part.taskDue?.provenance === "human_confirmed" || part.respondBy?.provenance === "human_confirmed";
}

function build(
  part: PartSnapshot,
  kind: MissingDetailKind,
  questionCode: MissingDetailQuestionCode,
  extra: Partial<Pick<MissingDetail, "source" | "storedDetailId" | "aiQuestion" | "reasonCode">>,
  personToAsk: string | null,
): MissingDetail {
  const hint = kind === "location" ? personToAsk : null;
  return {
    key: `${part.id}:${kind}:${questionCode}`,
    kind,
    questionCode,
    reasonCode: extra.reasonCode ?? REASON[kind],
    source: extra.source ?? "derived",
    storedDetailId: extra.storedDetailId ?? null,
    aiQuestion: extra.aiQuestion ?? null,
    personToAsk: hint,
    needsDetails: NEEDS_DETAILS_KINDS.has(kind) && part.careCategory === "appointment",
  };
}

/**
 * Unresolved stored details plus derived ones. Each has a question key and a reason key.
 * Stored details come first, in the given order; derived ones follow in a fixed order.
 */
export function deriveMissingDetails(
  part: MissingDetailPart,
  storedDetails: readonly StoredMissingDetail[],
): MissingDetail[] {
  const hint = cleanHint(part.personToAsk);
  const out: MissingDetail[] = [];
  const present = new Set<MissingDetailKind>();
  const resolvedKinds = new Set<MissingDetailKind>();

  for (const stored of storedDetails) {
    if (isStoredDetailResolved(stored)) {
      resolvedKinds.add(stored.kind);
      continue;
    }
    // A time detail is answered only by a human-confirmed time, never by a typed answer or model time.
    if (stored.kind === "time" && hasConfirmedAppointmentTime(part)) continue;
    // Likewise a location or amount saved on the Part through its own form answers the detail.
    if (stored.kind === "location" && !isBlank(part.location)) continue;
    if (stored.kind === "amount" && part.requiredAmountMinor !== null) continue;
    if (stored.kind === "date" && !isBlank(part.appointmentDate)) continue;
    present.add(stored.kind);
    out.push(
      build(
        part,
        stored.kind,
        stored.questionCode,
        { source: "stored", storedDetailId: stored.id, aiQuestion: stored.aiQuestion },
        hint,
      ),
    );
  }

  const derive = (kind: MissingDetailKind, code: MissingDetailQuestionCode, reasonCode?: string) => {
    if (present.has(kind) || resolvedKinds.has(kind)) return;
    present.add(kind);
    out.push(build(part, kind, code, { reasonCode }, hint));
  };

  if (part.careCategory === "appointment") {
    if (isBlank(part.location)) derive("location", "which_clinic");
    if (!hasConfirmedAppointmentTime(part)) {
      // A resolved stored "time" row does not count: only a confirmed time does.
      resolvedKinds.delete("time");
      derive("time", "which_time");
    }
  }

  if (part.careCategory === "payment" && part.requiredAmountMinor === null) {
    derive("amount", "which_amount");
  }

  if (part.careCategory === "transport" && part.driverId === null) {
    derive("person", "who_will_drive", "missing.reason.driver");
  }

  if (part.riskLevel === "high" && !hasHumanConfirmedTime({ taskDue: part.taskDue, respondBy: part.respondBy })) {
    derive("date", "when_is_deadline", "missing.reason.deadline");
  }

  return out;
}

/** True while any detail of date, time, or location is unresolved: show "Needs details". */
export function showsNeedsDetails(details: readonly MissingDetail[]): boolean {
  return details.some((d) => d.needsDetails);
}

/** True when a Part has an unresolved detail, so it is shown as needing information. */
export function needsInformation(details: readonly MissingDetail[]): boolean {
  return details.length > 0;
}

/** A Part with no Owner. Low and medium risk Parts count too; they get no scheduled reminders. */
export function isUnclaimedPart(part: Pick<PartSnapshot, "ownerId" | "legacyStatus">): boolean {
  if (part.legacyStatus === "completed" || part.legacyStatus === "cancelled") return false;
  return part.ownerId === null;
}

/** A High_Risk_Part with no human-confirmed time shows "No deadline yet". */
export function hasNoDeadlineYet(part: PartSnapshot): boolean {
  return part.riskLevel === "high" && !hasHumanConfirmedTime(part);
}

/** One Part's contribution to the "Needs someone" section. */
export function partNeedsSomeone(part: PartSnapshot, details: readonly MissingDetail[]): boolean {
  return isUnclaimedPart(part) || details.length > 0 || hasNoDeadlineYet(part);
}

/**
 * An event is in "Needs someone" exactly when it has an unclaimed Part, an unresolved
 * Missing_Detail, or a High_Risk_Part without a human-confirmed time.
 */
export function eventNeedsSomeone(
  parts: readonly { part: PartSnapshot; details: readonly MissingDetail[] }[],
): boolean {
  return parts.some(({ part, details }) => partNeedsSomeone(part, details));
}
