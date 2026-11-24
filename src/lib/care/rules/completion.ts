/**
 * Completion, failure, and reopen decisions (family-shared-care design,
 * "Pure rule module"). Pure TypeScript: no I/O, no clock.
 * Requirements 6.6, 9.3, 11.1, 11.3, 11.4, 11.6, 11.7, 12.13.
 */
import { isHighRiskPart, effectiveApprovalState } from "@/lib/care/rules/approval";
import { REOPEN_AND_BACKUP_ROLES } from "@/lib/care/rules/defaults";
import type {
  Decision,
  MemberSnapshot,
  PartSnapshot,
} from "@/lib/care/rules/types";

const CLOSED_STATUSES: readonly string[] = ["completed", "cancelled", "failed"];

/** Closed_Part (glossary): `completed`, `cancelled`, or `failed`. */
function isClosedPart(part: Pick<PartSnapshot, "legacyStatus">): boolean {
  return CLOSED_STATUSES.includes(part.legacyStatus);
}

function refuseIfNotActiveMember(
  part: Pick<PartSnapshot, "householdId">,
  actor: MemberSnapshot,
): Decision<never> | null {
  if (!actor.isActive || actor.householdId !== part.householdId) {
    return { ok: false, code: "part_not_found" };
  }
  if (actor.role === "care_recipient") return { ok: false, code: "recipient_read_only" };
  return null;
}

/** Required Evidence labels with no attached item, in the order required (Requirement 11.3). */
export function missingEvidence(
  part: Pick<PartSnapshot, "evidenceRequired" | "evidenceAttached">,
): string[] {
  const attached = new Set(part.evidenceAttached);
  return part.evidenceRequired.filter((label) => !attached.has(label));
}

export type CompletionOutcome =
  | { outcome: "completed" }
  /** A committed result, not a refusal: the caller saves Progress_Status `evidence_required`. */
  | { outcome: "evidence_required"; missing: string[] };

/**
 * Requirements 6.6, 9.3, 11.1, 11.6, 11.7. Decided from the owner and the Approval_State.
 * Proof is optional context in the household flow: missing required Evidence never blocks
 * completion and never turns it into `evidence_required` (migration 20261217000000). The current Progress_Status
 * (`in_progress`, `evidence_required`, `escalated`) never changes the outcome;
 * only a Closed_Part is refused. The approval state is not changed here.
 */
export function decideCompletion(
  part: PartSnapshot,
  actor: MemberSnapshot,
): Decision<CompletionOutcome> {
  const refused = refuseIfNotActiveMember(part, actor);
  if (refused) return refused;
  if (isClosedPart(part)) return { ok: false, code: "part_closed" };
  if (part.ownerId === null || part.ownerId !== actor.memberId) {
    return { ok: false, code: "not_owner" };
  }
  const state = effectiveApprovalState(part);
  const unresolved = state === "pending" || state === "rejected";
  if ((part.approvalRequired && state !== "approved") || (isHighRiskPart(part) && unresolved)) {
    return { ok: false, code: "approval_pending" };
  }
  return { ok: true, value: { outcome: "completed" } };
}

/**
 * Requirement 11.4. Any Helper of the Part (Owner, Driver, or Companion) may
 * report that it could not be done. The result is Progress_Status `failed`.
 */
export function decideFailure(part: PartSnapshot, actor: MemberSnapshot): Decision<"failed"> {
  const refused = refuseIfNotActiveMember(part, actor);
  if (refused) return refused;
  if (isClosedPart(part)) return { ok: false, code: "part_closed" };
  const isHelper =
    part.ownerId === actor.memberId ||
    part.driverId === actor.memberId ||
    part.companionId === actor.memberId;
  if (!isHelper) return { ok: false, code: "not_holder" };
  return { ok: true, value: "failed" };
}

/**
 * Requirement 12.13 and D-2. Only a `failed` Part can be reopened, by its Owner
 * or an active Primary_Caregiver. The result is `in_progress`; the
 * Approval_State is unchanged.
 */
export function decideReopen(part: PartSnapshot, actor: MemberSnapshot): Decision<"in_progress"> {
  const refused = refuseIfNotActiveMember(part, actor);
  if (refused) return refused;
  if (part.legacyStatus !== "failed") return { ok: false, code: "not_failed" };
  const isOwner = part.ownerId !== null && part.ownerId === actor.memberId;
  const allowed = REOPEN_AND_BACKUP_ROLES.some((role) =>
    role === "owner" ? isOwner : actor.role === role,
  );
  if (!allowed) return { ok: false, code: "not_allowed_reopen" };
  return { ok: true, value: "in_progress" };
}
