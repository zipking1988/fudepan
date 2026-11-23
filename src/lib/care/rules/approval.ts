/**
 * Approval rules (family-shared-care design, "Pure rule module").
 * Pure TypeScript: no I/O, no clock. Mirrors the plpgsql Action_Guard.
 * Requirements 9.2, 9.5-9.9, 9.14, 9.16-9.19, 9.21, 9.22, 18.6, 18.7.
 */
import type { CareCategory } from "@/lib/ai/schema";
import type {
  ApprovalState,
  Decision,
  MemberSnapshot,
  PartSnapshot,
} from "@/lib/care/rules/types";

const HIGH_RISK_CATEGORIES: readonly CareCategory[] = [
  "appointment",
  "medication",
  "payment",
  "transport",
  "document",
];

/**
 * High_Risk_Part (glossary): risk level `high`, or category appointment,
 * medication, payment, transport, or insurance/government paperwork (`document`).
 */
export function isHighRiskPart(part: Pick<PartSnapshot, "riskLevel" | "careCategory">): boolean {
  return part.riskLevel === "high" || HIGH_RISK_CATEGORIES.includes(part.careCategory);
}

/**
 * Requirement 18.6. A stored state wins. For a legacy row (null): `not_required`
 * if approval is not required, `approved` if the legacy status is `approved` or
 * `completed`, otherwise `pending`.
 */
export function effectiveApprovalState(
  part: Pick<PartSnapshot, "approvalRequired" | "storedApprovalState" | "legacyStatus">,
): ApprovalState {
  if (part.storedApprovalState !== null) return part.storedApprovalState;
  if (!part.approvalRequired) return "not_required";
  if (part.legacyStatus === "approved" || part.legacyStatus === "completed") return "approved";
  return "pending";
}

/** What changed on a Part. `progress` covers every Progress_Status change. */
export type ApprovalChange = "people" | "key_fact" | "progress";

/**
 * Requirements 9.8, 9.9, 9.21, 9.22. People and Key_Fact changes reset
 * `approved` to `pending`. `rejected` stays `rejected`. Progress changes never
 * touch the state. Callers apply this to High_Risk_Parts.
 */
export function nextApprovalStateOnChange(
  state: ApprovalState,
  change: ApprovalChange,
): ApprovalState {
  if (change === "progress") return state;
  return state === "approved" ? "pending" : state;
}

export type ApprovalDecision = "approve" | "reject";

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

/**
 * Requirements 9.2, 9.5, 9.6, 9.7, 9.14, 9.16. A `completed` or `cancelled` Part
 * is refused with `part_closed` (design, decide_approval). `activePrimaryCount` must be read
 * at processing time, never cached.
 */
export function decideApproval(
  part: PartSnapshot,
  actor: MemberSnapshot,
  activePrimaryCount: number,
  decision: ApprovalDecision,
): Decision<{ state: ApprovalState; selfApproval: boolean }> {
  const refused = refuseIfNotActiveMember(part, actor);
  if (refused) return refused;
  if (actor.role !== "primary_caregiver") return { ok: false, code: "not_primary_caregiver" };

  const current = effectiveApprovalState(part);
  if (current === "not_required") return { ok: false, code: "approval_not_required" };

  // Same order as the reference model: every other refusal first, then part_closed.
  const closed =
    part.legacyStatus === "completed" || part.legacyStatus === "cancelled";

  if (decision === "reject") {
    if (closed) return { ok: false, code: "part_closed" };
    return { ok: true, value: { state: "rejected", selfApproval: false } };
  }

  if (current === "rejected") return { ok: false, code: "resubmission_required" };

  const actorIsOwner = part.ownerId !== null && part.ownerId === actor.memberId;
  if (actorIsOwner && activePrimaryCount >= 2) return { ok: false, code: "self_approval_blocked" };

  if (closed) return { ok: false, code: "part_closed" };

  return { ok: true, value: { state: "approved", selfApproval: actorIsOwner } };
}

export type ResubmitInput = {
  explanation?: string | null;
  /** Number of Evidence items added since the rejection. */
  newEvidenceCount?: number;
};

/**
 * Requirements 9.17-9.19. Owner only, Part must be `rejected`, and the request
 * needs an explanation, new Evidence, or a changed plan
 * (`planVersion > rejectedAtPlanVersion`).
 */
export function canResubmit(
  part: PartSnapshot,
  actor: MemberSnapshot,
  input: ResubmitInput,
): Decision<ApprovalState> {
  const refused = refuseIfNotActiveMember(part, actor);
  if (refused) return refused;
  if (part.ownerId === null || part.ownerId !== actor.memberId) {
    return { ok: false, code: "not_owner" };
  }
  if (effectiveApprovalState(part) !== "rejected") return { ok: false, code: "not_rejected" };

  const hasExplanation = (input.explanation ?? "").trim().length > 0;
  const hasEvidence = (input.newEvidenceCount ?? 0) > 0;
  const planChanged =
    part.rejectedAtPlanVersion !== null && part.planVersion > part.rejectedAtPlanVersion;
  if (!hasExplanation && !hasEvidence && !planChanged) {
    return { ok: false, code: "resubmission_empty" };
  }
  return { ok: true, value: "pending" };
}
