import { effectiveApprovalState } from "@/lib/care/rules/approval";
import type { ApprovalState } from "@/lib/care/rules/types";

/**
 * Where a step is in the approval flow. Display only: the server actions
 * enforce approval on their own.
 *
 * A stored approval_state wins and is independent of progress status:
 * only "pending" is awaiting. For legacy rows (approval_state null) the state
 * is derived by effectiveApprovalState: approval_required with status
 * "approved" or "completed" is approved, anything else pending. A legacy step
 * that was cancelled or failed is not awaiting. A legacy "escalated" step
 * overwrote its status, so whether it was approved first is unknown; it stays
 * awaiting, the safe reading.
 */
const LEGACY_CLOSED = new Set(["cancelled", "failed"]);
const STORED_STATES: readonly string[] = ["not_required", "pending", "approved", "rejected"];

export type ApprovalStepInput = {
  approvalRequired: boolean;
  status: string;
  /** Stored care_steps.approval_state, null for legacy rows. */
  approvalState?: string | null;
};

function storedState(step: ApprovalStepInput): ApprovalState | null {
  return step.approvalState != null && STORED_STATES.includes(step.approvalState)
    ? (step.approvalState as ApprovalState)
    : null;
}

/** The approval truth for display: a stored state wins, legacy rows are derived. */
export function approvalStateOf(step: ApprovalStepInput): ApprovalState {
  return effectiveApprovalState({
    approvalRequired: step.approvalRequired,
    storedApprovalState: storedState(step),
    legacyStatus: step.status,
  });
}

export function isAwaitingApproval(step: ApprovalStepInput): boolean {
  if (approvalStateOf(step) !== "pending") return false;
  return storedState(step) !== null || !LEGACY_CLOSED.has(step.status);
}

/** Approved or not required, and the step is still open: "Mark as done" may be offered. */
export function canOfferCompletion(step: ApprovalStepInput): boolean {
  const state = approvalStateOf(step);
  if (state !== "approved" && state !== "not_required") return false;
  return step.status !== "completed" && step.status !== "cancelled";
}

export function countAwaitingApproval(steps: ApprovalStepInput[]): number {
  return steps.filter(isAwaitingApproval).length;
}
