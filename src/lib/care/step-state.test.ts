import { describe, expect, it } from "vitest";
import { actionCount, summarizeChain, type SummaryStep } from "./chain-summary";
import { countAwaitingApproval, isAwaitingApproval } from "./step-state";

const legacy = (status: string, approvalRequired = true) => ({ approvalRequired, status, approvalState: null });
const stored = (approvalState: string, status: string) => ({ approvalRequired: true, status, approvalState });

describe("isAwaitingApproval, legacy rows (approval_state null)", () => {
  it("matches the old status-based results", () => {
    expect(isAwaitingApproval(legacy("pending_review"))).toBe(true);
    expect(isAwaitingApproval(legacy("escalated"))).toBe(true);
    expect(isAwaitingApproval(legacy("approved"))).toBe(false);
    expect(isAwaitingApproval(legacy("completed"))).toBe(false);
    expect(isAwaitingApproval(legacy("cancelled"))).toBe(false);
    expect(isAwaitingApproval(legacy("failed"))).toBe(false);
    expect(isAwaitingApproval(legacy("pending_review", false))).toBe(false);
  });
});

describe("isAwaitingApproval, stored approval_state wins", () => {
  it("stored approved is not awaiting whatever the progress status", () => {
    for (const status of ["evidence_required", "escalated", "in_progress", "pending_review"]) {
      expect(isAwaitingApproval(stored("approved", status))).toBe(false);
    }
  });
  it("stored pending is awaiting, even when the legacy status says approved", () => {
    expect(isAwaitingApproval(stored("pending", "pending_review"))).toBe(true);
    expect(isAwaitingApproval(stored("pending", "approved"))).toBe(true);
  });
  it("stored rejected and not_required are not awaiting", () => {
    expect(isAwaitingApproval(stored("rejected", "pending_review"))).toBe(false);
    expect(isAwaitingApproval({ approvalRequired: false, status: "x", approvalState: "not_required" })).toBe(false);
  });
  it("counts only pending steps", () => {
    expect(
      countAwaitingApproval([stored("pending", "a"), stored("approved", "escalated"), stored("rejected", "a")]),
    ).toBe(1);
  });
});

describe("summarizeChain uses the stored approval state", () => {
  const step = (o: Partial<SummaryStep>): SummaryStep => ({
    careCategory: "household",
    status: "in_progress",
    approvalRequired: true,
    approvalState: null,
    ownerId: "m1",
    appointmentLocation: null,
    appointmentTime: null,
    appointmentTimezone: null,
    ...o,
  });
  it("counts pending, not approved or rejected", () => {
    const s = summarizeChain([
      step({ approvalState: "pending" }),
      step({ approvalState: "approved", status: "evidence_required" }),
      step({ approvalState: "rejected" }),
    ]);
    expect(s.awaitingConfirmation).toBe(1);
    expect(actionCount(s)).toBe(1);
  });
});
