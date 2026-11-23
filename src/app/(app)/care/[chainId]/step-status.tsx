import { RISK_LABELS, type RiskLevel } from "@/lib/care/risk";
import { COMPLETED_LABEL_KEY } from "@/lib/care/rules/defaults";
import { LABEL_TEXT_EN } from "@/lib/care/rules/labels";
import { approvalStateOf, countAwaitingApproval, isAwaitingApproval } from "@/lib/care/step-state";

const STEP_STATUS_TEXT: Record<string, string> = {
  pending_review: "Waiting for family review",
  needs_clarification: "Needs more information",
  awaiting_owner_acceptance: "Waiting for the responsible person",
  in_progress: "In progress",
  evidence_required: "Waiting for proof it was done",
  failed: "Not done",
  escalated: "Overdue, escalated",
  cancelled: "Cancelled",
};

type StepState = {
  approvalRequired: boolean;
  status: string;
  riskLevel: string;
  /** Stored care_steps.approval_state, null for legacy rows. */
  approvalState?: string | null;
};

/** Chain-level warning. Counts only steps still waiting for a person to confirm. */
export function AwaitingApprovalBanner({ steps }: { steps: StepState[] }) {
  const count = countAwaitingApproval(steps);
  if (count === 0) return null;
  return (
    <div role="alert" className="app-alert">
      <p className="app-alert__title">Requires confirmation</p>
      <p className="mt-1">
        {count === 1
          ? "One step requires a family member to confirm before anything can happen."
          : `${count} steps require a family member to confirm before anything can happen.`}
      </p>
    </div>
  );
}

/** Status badge on a step card, always in words. */
export function StepStatusBadge({ step }: { step: StepState }) {
  if (step.status === "completed") {
    return <span className="app-status app-status--uploaded">{LABEL_TEXT_EN[COMPLETED_LABEL_KEY]}</span>;
  }
  if (isAwaitingApproval(step)) {
    return <span className="app-status app-status--extraction_failed">Requires confirmation</span>;
  }
  const approval = approvalStateOf(step);
  if (approval === "rejected") {
    return <span className="app-status app-status--extraction_failed">Not approved</span>;
  }
  if (approval === "approved" || step.status === "approved") {
    return <span className="app-status app-status--uploaded">Confirmed</span>;
  }
  return <span className="app-status">{STEP_STATUS_TEXT[step.status] ?? step.status.replace(/_/g, " ")}</span>;
}

/** Footer explaining why a step is blocked. Shown only while it awaits confirmation. */
export function AwaitingApprovalNotice({ step }: { step: StepState }) {
  if (!isAwaitingApproval(step)) return null;
  return (
    <div className="rounded border-2 border-orange-400 bg-orange-50 p-4">
      <p className="font-semibold">Requires confirmation</p>
      <p className="app-hint mt-1">
        A family member must explicitly confirm this step before it can proceed.
        {step.riskLevel === "high" && " This is a high-priority action involving health, money, or travel."}
      </p>
    </div>
  );
}

const RISK_CLASSES: Record<RiskLevel, string> = {
  low: "app-status app-status--uploaded",
  medium: "app-status",
  high: "app-status app-status--extraction_failed",
};

/** Risk level in words. Approval state is shown separately by StepStatusBadge. */
export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={RISK_CLASSES[level]}>{RISK_LABELS[level]}</span>;
}
