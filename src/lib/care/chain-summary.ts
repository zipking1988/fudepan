import { isAwaitingApproval } from "./step-state";

/**
 * What a family needs to know about one Care Chain at a glance, computed only
 * from the stored step state. No AI guesses: an appointment time counts only
 * once a person has saved it with its time zone.
 */
export type SummaryStep = {
  careCategory: string;
  status: string;
  approvalRequired: boolean;
  /** Stored care_steps.approval_state; null for legacy rows. */
  approvalState: string | null;
  ownerId: string | null;
  appointmentLocation: string | null;
  appointmentTime: string | null;
  appointmentTimezone: string | null;
};

export type ChainSummary = {
  total: number;
  done: number;
  awaitingConfirmation: number;
  withoutOwner: number;
  missingAppointmentDetails: number;
  /** Earliest saved appointment that is not done yet. */
  nextAppointment: { iso: string; timeZone: string } | null;
};

const CLOSED = new Set(["completed", "cancelled", "failed"]);

export function summarizeChain(steps: SummaryStep[]): ChainSummary {
  const open = steps.filter((s) => !CLOSED.has(s.status));
  const appointments = open
    .filter((s) => s.careCategory === "appointment" && s.appointmentTime && s.appointmentTimezone)
    .map((s) => ({ iso: s.appointmentTime!, timeZone: s.appointmentTimezone! }))
    .sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso));
  return {
    total: steps.length,
    done: steps.filter((s) => s.status === "completed").length,
    awaitingConfirmation: steps.filter(isAwaitingApproval).length,
    withoutOwner: open.filter((s) => !s.ownerId).length,
    missingAppointmentDetails: open.filter(
      (s) => s.careCategory === "appointment" && (!s.appointmentLocation || !s.appointmentTime),
    ).length,
    nextAppointment: appointments[0] ?? null,
  };
}

/** Number of things a family member has to act on. */
export function actionCount(summary: ChainSummary): number {
  return summary.awaitingConfirmation + summary.withoutOwner + summary.missingAppointmentDetails;
}

/** Plain words for care_chains.status, never the raw value. */
export const CHAIN_STATUS_TEXT: Record<string, string> = {
  pending_review: "Draft, waiting for family review",
  needs_clarification: "Needs more information",
  pending_approval: "Waiting for confirmation",
  awaiting_owner_acceptance: "Waiting for the responsible person",
  approved: "Confirmed",
  in_progress: "In progress",
  evidence_required: "Waiting for proof it was done",
  completed: "Completed",
  failed: "Not done",
  escalated: "Overdue, escalated",
  cancelled: "Cancelled",
  extraction_failed: "Could not be read",
};

export function chainStatusText(status: string): string {
  return CHAIN_STATUS_TEXT[status] ?? status.replace(/_/g, " ");
}
