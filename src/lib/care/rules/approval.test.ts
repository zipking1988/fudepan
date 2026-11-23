import { describe, expect, it } from "vitest";
import {
  canResubmit,
  decideApproval,
  effectiveApprovalState,
  isHighRiskPart,
  nextApprovalStateOnChange,
} from "@/lib/care/rules/approval";
import type { MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

function part(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
  return {
    id: "p1",
    householdId: "h1",
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    storedApprovalState: "pending",
    legacyStatus: "pending_review",
    ownerId: "owner",
    driverId: null,
    companionId: null,
    backupOwnerId: null,
    taskDue: null,
    respondBy: null,
    evidenceRequired: [],
    evidenceAttached: [],
    planVersion: 1,
    rejectedAtPlanVersion: null,
    ...overrides,
  };
}

function member(overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    memberId: "m1",
    householdId: "h1",
    role: "primary_caregiver",
    isActive: true,
    ...overrides,
  };
}

describe("isHighRiskPart", () => {
  it("is true for high risk or a high-risk category, false otherwise", () => {
    expect(isHighRiskPart({ riskLevel: "high", careCategory: "household" })).toBe(true);
    expect(isHighRiskPart({ riskLevel: "low", careCategory: "medication" })).toBe(true);
    expect(isHighRiskPart({ riskLevel: "low", careCategory: "document" })).toBe(true);
    expect(isHighRiskPart({ riskLevel: "medium", careCategory: "household" })).toBe(false);
  });
});

describe("effectiveApprovalState", () => {
  it("returns the stored state when present", () => {
    expect(effectiveApprovalState(part({ storedApprovalState: "rejected" }))).toBe("rejected");
  });

  it.each(["approved", "completed"])("derives approved for legacy status %s", (legacyStatus) => {
    expect(effectiveApprovalState(part({ storedApprovalState: null, legacyStatus }))).toBe(
      "approved",
    );
  });

  it("derives pending for legacy pending_review", () => {
    expect(
      effectiveApprovalState(part({ storedApprovalState: null, legacyStatus: "pending_review" })),
    ).toBe("pending");
  });

  it("derives not_required when approval is not required", () => {
    expect(
      effectiveApprovalState(
        part({ storedApprovalState: null, approvalRequired: false, legacyStatus: "completed" }),
      ),
    ).toBe("not_required");
  });
});

describe("nextApprovalStateOnChange", () => {
  it("resets approved to pending on people and Key_Fact changes", () => {
    expect(nextApprovalStateOnChange("approved", "people")).toBe("pending");
    expect(nextApprovalStateOnChange("approved", "key_fact")).toBe("pending");
  });

  it("keeps rejected, pending and not_required on people and Key_Fact changes", () => {
    for (const state of ["rejected", "pending", "not_required"] as const) {
      expect(nextApprovalStateOnChange(state, "people")).toBe(state);
      expect(nextApprovalStateOnChange(state, "key_fact")).toBe(state);
    }
  });

  it("never changes state on progress changes", () => {
    for (const state of ["not_required", "pending", "approved", "rejected"] as const) {
      expect(nextApprovalStateOnChange(state, "progress")).toBe(state);
    }
  });
});

describe("decideApproval", () => {
  it("lets an active primary caregiver approve and reject", () => {
    expect(decideApproval(part(), member(), 2, "approve")).toEqual({
      ok: true,
      value: { state: "approved", selfApproval: false },
    });
    expect(decideApproval(part(), member(), 2, "reject")).toEqual({
      ok: true,
      value: { state: "rejected", selfApproval: false },
    });
  });

  it("refuses non-primary caregivers", () => {
    expect(decideApproval(part(), member({ role: "family_member" }), 1, "approve")).toEqual(
      { ok: false, code: "not_primary_caregiver" },
    );
  });

  it("refuses care recipients as read-only", () => {
    expect(decideApproval(part(), member({ role: "care_recipient" }), 1, "approve")).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
  });

  it("hides parts from inactive members and other households", () => {
    expect(decideApproval(part(), member({ isActive: false }), 1, "approve")).toEqual({
      ok: false,
      code: "part_not_found",
    });
    expect(decideApproval(part(), member({ householdId: "h2" }), 1, "approve")).toEqual({
      ok: false,
      code: "part_not_found",
    });
  });

  it("allows self-approval only when the owner is the single active primary caregiver", () => {
    const owner = member({ memberId: "owner" });
    expect(decideApproval(part(), owner, 1, "approve")).toEqual({
      ok: true,
      value: { state: "approved", selfApproval: true },
    });
  });

  it("forbids the owner's own approval with 2 or more active primary caregivers", () => {
    const owner = member({ memberId: "owner" });
    expect(decideApproval(part(), owner, 2, "approve")).toEqual({
      ok: false,
      code: "self_approval_blocked",
    });
    expect(decideApproval(part(), owner, 3, "approve")).toEqual({
      ok: false,
      code: "self_approval_blocked",
    });
  });

  it("is not marked as self-approval when a different primary caregiver approves", () => {
    const result = decideApproval(part(), member({ memberId: "other" }), 1, "approve");
    expect(result).toEqual({ ok: true, value: { state: "approved", selfApproval: false } });
  });

  it("requires resubmission before approving a rejected part", () => {
    expect(
      decideApproval(part({ storedApprovalState: "rejected" }), member(), 2, "approve"),
    ).toEqual({ ok: false, code: "resubmission_required" });
  });

  it("refuses when approval is not required", () => {
    expect(
      decideApproval(
        part({ approvalRequired: false, storedApprovalState: "not_required" }),
        member(),
        2,
        "approve",
      ),
    ).toEqual({ ok: false, code: "approval_not_required" });
  });

  it("refuses a decision on a completed or cancelled part with part_closed", () => {
    for (const legacyStatus of ["completed", "cancelled"]) {
      for (const decision of ["approve", "reject"] as const) {
        expect(decideApproval(part({ legacyStatus }), member(), 2, decision)).toEqual({
          ok: false,
          code: "part_closed",
        });
      }
    }
  });

  it("reports other refusals before part_closed, like the reference model", () => {
    expect(
      decideApproval(part({ legacyStatus: "cancelled" }), member({ role: "family_member" }), 2, "approve"),
    ).toEqual({ ok: false, code: "not_primary_caregiver" });
    expect(
      decideApproval(
        part({ legacyStatus: "cancelled", storedApprovalState: "rejected" }),
        member(),
        2,
        "approve",
      ),
    ).toEqual({ ok: false, code: "resubmission_required" });
  });

  it("derives the legacy state before deciding", () => {
    const legacy = part({ storedApprovalState: null, legacyStatus: "rejected_legacy" });
    expect(decideApproval(legacy, member(), 2, "approve").ok).toBe(true);
  });
});

describe("canResubmit", () => {
  const rejected = part({
    storedApprovalState: "rejected",
    planVersion: 2,
    rejectedAtPlanVersion: 2,
  });
  const owner = member({ memberId: "owner", role: "family_member" });

  it("accepts an explanation", () => {
    expect(canResubmit(rejected, owner, { explanation: "Same plan, clinic confirmed." })).toEqual({
      ok: true,
      value: "pending",
    });
  });

  it("accepts new Evidence", () => {
    expect(canResubmit(rejected, owner, { newEvidenceCount: 1 }).ok).toBe(true);
  });

  it("accepts a changed plan version", () => {
    expect(canResubmit({ ...rejected, planVersion: 3 }, owner, {}).ok).toBe(true);
  });

  it("refuses an empty resubmission, including a blank explanation", () => {
    expect(canResubmit(rejected, owner, { explanation: "   ", newEvidenceCount: 0 })).toEqual({
      ok: false,
      code: "resubmission_empty",
    });
  });

  it("refuses anyone but the owner", () => {
    expect(canResubmit(rejected, member({ memberId: "other" }), { explanation: "x" })).toEqual({
      ok: false,
      code: "not_owner",
    });
  });

  it("refuses when the part is not rejected", () => {
    expect(canResubmit(part(), owner, { explanation: "x" })).toEqual({
      ok: false,
      code: "not_rejected",
    });
  });
});
