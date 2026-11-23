import { describe, expect, it } from "vitest";
import { RISK_LABELS, RISK_LEVELS } from "@/lib/care/risk";
import { COMPLETED_LABEL_KEY } from "@/lib/care/rules/defaults";
import { approvalLabelKey, LABEL_TEXT_EN, riskLabelKey } from "@/lib/care/rules/labels";
import type { ApprovalState, ProgressStatus } from "@/lib/care/rules/types";

const APPROVALS: ApprovalState[] = ["not_required", "pending", "approved", "rejected"];
const STATUSES: ProgressStatus[] = [
  "pending_review",
  "needs_clarification",
  "in_progress",
  "evidence_required",
  "escalated",
  "completed",
  "failed",
  "cancelled",
];

describe("riskLabelKey", () => {
  it("maps each level to its own key and English text matches RISK_LABELS", () => {
    expect(riskLabelKey("low")).toBe("lowPriority");
    expect(riskLabelKey("medium")).toBe("needsAttention");
    expect(riskLabelKey("high")).toBe("highRisk");
    for (const level of RISK_LEVELS) expect(LABEL_TEXT_EN[riskLabelKey(level)]).toBe(RISK_LABELS[level]);
    expect(RISK_LABELS.high).toBe("High risk");
  });
});

describe("approvalLabelKey", () => {
  it("maps approval states", () => {
    const key = (approvalState: ApprovalState) => approvalLabelKey({ progressStatus: "in_progress", approvalState });
    expect(key("pending")).toBe("requiresConfirmation");
    expect(key("approved")).toBe("confirmed");
    expect(key("rejected")).toBe("notApproved");
    expect(key("not_required")).toBeNull();
  });

  it("completed shows Done whatever the approval state", () => {
    for (const approvalState of APPROVALS) {
      expect(approvalLabelKey({ progressStatus: "completed", approvalState })).toBe(COMPLETED_LABEL_KEY);
    }
    expect(LABEL_TEXT_EN[COMPLETED_LABEL_KEY]).toBe("Done");
  });

  it("requiresConfirmation iff approval is pending and the Part is not completed", () => {
    for (const progressStatus of STATUSES) {
      for (const approvalState of APPROVALS) {
        const label = approvalLabelKey({ progressStatus, approvalState });
        expect(label === "requiresConfirmation").toBe(approvalState === "pending" && progressStatus !== "completed");
      }
    }
  });

  it("every label is words, never empty", () => {
    for (const text of Object.values(LABEL_TEXT_EN)) expect(text.trim().length).toBeGreaterThan(0);
  });
});
