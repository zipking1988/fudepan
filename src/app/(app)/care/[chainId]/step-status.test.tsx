import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { countAwaitingApproval } from "@/lib/care/step-state";
import { AwaitingApprovalBanner, AwaitingApprovalNotice, RiskBadge, StepStatusBadge } from "./step-status";

/** States of the Alpha QA chain 28a154ff…: one high-risk appointment plus three ordinary steps. Fake data. */
const appointment = (status: string): { approvalRequired: boolean; riskLevel: string; status: string; approvalState?: string | null } => ({
  approvalRequired: true,
  riskLevel: "high",
  status,
});
const ordinary = [
  { approvalRequired: false, riskLevel: "medium", status: "pending_review" },
  { approvalRequired: false, riskLevel: "medium", status: "pending_review" },
  { approvalRequired: false, riskLevel: "low", status: "pending_review" },
];

function card(step: ReturnType<typeof appointment>) {
  return renderToStaticMarkup(
    <>
      <RiskBadge level="high" />
      <StepStatusBadge step={step} />
      <AwaitingApprovalNotice step={step} />
    </>,
  );
}

describe("high-risk appointment card by state", () => {
  it("pending: requires confirmation, with the explanation", () => {
    const html = card(appointment("pending_review"));
    expect(html).toContain(">High risk<");
    expect(html).toContain("Requires confirmation");
    expect(html).toContain("must explicitly confirm this step before it can proceed");
    expect(html).toContain("high-priority action");
  });

  it("approved: shows Confirmed and no pending-approval copy", () => {
    const html = card(appointment("approved"));
    expect(html).toContain(">Confirmed<");
    expect(html).not.toContain("Requires confirmation");
    expect(html).not.toContain("must explicitly confirm");
  });

  it("completed (QA regression): shows Done and no pending-approval copy, risk still shown", () => {
    const html = card(appointment("completed"));
    expect(html).toContain(">Done<");
    expect(html).toContain(">High risk<");
    expect(html).toContain("app-status--extraction_failed"); // high-risk styling kept
    expect(html).not.toContain("Requires confirmation");
    expect(html).not.toContain("must explicitly confirm");
  });

  it("escalated before anyone confirmed: still requires confirmation", () => {
    expect(card(appointment("escalated"))).toContain("must explicitly confirm");
  });
});

describe("stored approval_state drives labels", () => {
  const stored = (approvalState: string, status: string) => ({ ...appointment(status), approvalState });

  it.each(["pending_review", "in_progress", "evidence_required", "escalated"])(
    "approved with progress %s: Confirmed, no pending copy",
    (status) => {
      const html = card(stored("approved", status));
      expect(html).toContain(">Confirmed<");
      expect(html).not.toContain("Requires confirmation");
      expect(html).not.toContain("must explicitly confirm");
    },
  );

  it("pending: Requires confirmation", () => {
    expect(card(stored("pending", "in_progress"))).toContain("Requires confirmation");
  });

  it("rejected: Not approved, no pending copy", () => {
    const html = card(stored("rejected", "in_progress"));
    expect(html).toContain(">Not approved<");
    expect(html).not.toContain("Requires confirmation");
    expect(html).not.toContain("must explicitly confirm");
  });

  it("completed: Done even when stored approved", () => {
    const html = card(stored("approved", "completed"));
    expect(html).toContain(">Done<");
    expect(html).not.toContain("Confirmed");
  });

  it("legacy completed row with null state: Done, no pending copy", () => {
    const html = card({ ...appointment("completed"), approvalState: null });
    expect(html).toContain(">Done<");
    expect(html).not.toContain("Requires confirmation");
  });

  it("banner counts stored pending only", () => {
    const steps = [stored("pending", "in_progress"), stored("approved", "escalated"), stored("rejected", "in_progress")];
    expect(renderToStaticMarkup(<AwaitingApprovalBanner steps={steps} />)).toContain("One step requires");
  });
});

describe("chain banner and pending count", () => {
  it("counts only steps still awaiting approval", () => {
    expect(countAwaitingApproval([appointment("pending_review"), ...ordinary])).toBe(1);
    expect(countAwaitingApproval([appointment("approved"), ...ordinary])).toBe(0);
    expect(countAwaitingApproval([appointment("completed"), ...ordinary])).toBe(0);
    expect(countAwaitingApproval([appointment("pending_review"), appointment("completed")])).toBe(1);
  });

  it("is hidden once the only approval-required step is completed (QA regression)", () => {
    expect(renderToStaticMarkup(<AwaitingApprovalBanner steps={[appointment("completed"), ...ordinary]} />)).toBe("");
  });

  it("names the number still awaiting confirmation", () => {
    const html = renderToStaticMarkup(
      <AwaitingApprovalBanner steps={[appointment("pending_review"), appointment("pending_review"), appointment("completed")]} />,
    );
    expect(html).toContain("2 steps require a family member to confirm");
  });
});
