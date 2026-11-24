import { describe, expect, it } from "vitest";
import {
  decideCompletion,
  decideFailure,
  decideReopen,
  missingEvidence,
} from "@/lib/care/rules/completion";
import type { MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

function part(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
  return {
    id: "p1",
    householdId: "h1",
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    storedApprovalState: "approved",
    legacyStatus: "in_progress",
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
  return { memberId: "owner", householdId: "h1", role: "family_member", isActive: true, ...overrides };
}

describe("decideCompletion", () => {
  it("completes for the Owner of an approved Part", () => {
    expect(decideCompletion(part(), member())).toEqual({
      ok: true,
      value: { outcome: "completed" },
    });
  });

  it("refuses a non-Owner with not_owner", () => {
    expect(decideCompletion(part(), member({ memberId: "other" }))).toEqual({
      ok: false,
      code: "not_owner",
    });
  });

  it("refuses an unclaimed Part with not_owner", () => {
    expect(decideCompletion(part({ ownerId: null }), member())).toEqual({
      ok: false,
      code: "not_owner",
    });
  });

  it("refuses a care recipient with recipient_read_only, even the Owner", () => {
    expect(decideCompletion(part(), member({ role: "care_recipient" }))).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
  });

  it("hides a Part from an inactive or other-household member", () => {
    expect(decideCompletion(part(), member({ isActive: false }))).toEqual({
      ok: false,
      code: "part_not_found",
    });
    expect(decideCompletion(part(), member({ householdId: "h2" }))).toEqual({
      ok: false,
      code: "part_not_found",
    });
  });

  it("refuses with approval_pending when approval is pending or rejected", () => {
    for (const storedApprovalState of ["pending", "rejected"] as const) {
      expect(decideCompletion(part({ storedApprovalState }), member())).toEqual({
        ok: false,
        code: "approval_pending",
      });
    }
  });

  it("refuses a High_Risk_Part with pending approval even when approval is not flagged required", () => {
    const p = part({ approvalRequired: false, storedApprovalState: "pending" });
    expect(decideCompletion(p, member())).toEqual({ ok: false, code: "approval_pending" });
  });

  it("completes a low-risk Part that needs no approval", () => {
    const p = part({
      careCategory: "household",
      riskLevel: "low",
      approvalRequired: false,
      storedApprovalState: "not_required",
    });
    expect(decideCompletion(p, member()).ok).toBe(true);
  });

  it("derives approval for legacy rows", () => {
    const legacy = part({ storedApprovalState: null, legacyStatus: "approved" });
    expect(decideCompletion(legacy, member()).ok).toBe(true);
    const pending = part({ storedApprovalState: null, legacyStatus: "pending_review" });
    expect(decideCompletion(pending, member())).toEqual({ ok: false, code: "approval_pending" });
  });

  it("completes without the listed proof: proof is optional in the household flow", () => {
    const p = part({ evidenceRequired: ["receipt", "photo", "note"], evidenceAttached: ["photo"] });
    expect(decideCompletion(p, member())).toEqual({ ok: true, value: { outcome: "completed" } });
  });
  it("still refuses a non-owner and an unconfirmed high-risk task when proof is missing", () => {
    const p = part({ evidenceRequired: ["receipt"], evidenceAttached: [] });
    expect(decideCompletion({ ...p, ownerId: "someone-else" }, member()).ok).toBe(false);
    expect(decideCompletion(part({ evidenceRequired: ["receipt"], storedApprovalState: null, legacyStatus: "pending_review" }), member())).toEqual({ ok: false, code: "approval_pending" });
  });

  it("completes when all required Evidence is attached", () => {
    const p = part({ evidenceRequired: ["photo"], evidenceAttached: ["photo", "extra"] });
    expect(decideCompletion(p, member()).ok).toBe(true);
  });

  it("does not depend on in_progress, evidence_required, or escalated status", () => {
    const results = ["in_progress", "evidence_required", "escalated"].map((legacyStatus) =>
      decideCompletion(part({ legacyStatus, storedApprovalState: "approved" }), member()),
    );
    for (const r of results) expect(r).toEqual(results[0]);
    expect(results[0]).toEqual({ ok: true, value: { outcome: "completed" } });
  });

  it("checks approval before evidence", () => {
    const p = part({ storedApprovalState: "pending", evidenceRequired: ["photo"] });
    expect(decideCompletion(p, member())).toEqual({ ok: false, code: "approval_pending" });
  });

  it("refuses Closed_Parts with part_closed", () => {
    for (const legacyStatus of ["completed", "cancelled", "failed"]) {
      expect(decideCompletion(part({ legacyStatus }), member())).toEqual({
        ok: false,
        code: "part_closed",
      });
    }
  });
});

describe("missingEvidence", () => {
  it("lists required labels that are not attached", () => {
    expect(missingEvidence({ evidenceRequired: ["a", "b"], evidenceAttached: ["b"] })).toEqual(["a"]);
  });
});

describe("decideFailure", () => {
  it("lets the Owner, Driver, or Companion report failure", () => {
    const p = part({ driverId: "d", companionId: "c" });
    for (const memberId of ["owner", "d", "c"]) {
      expect(decideFailure(p, member({ memberId }))).toEqual({ ok: true, value: "failed" });
    }
  });

  it("refuses non-Helpers, recipients, and Closed_Parts", () => {
    expect(decideFailure(part(), member({ memberId: "x" }))).toEqual({
      ok: false,
      code: "not_holder",
    });
    expect(decideFailure(part(), member({ role: "care_recipient" }))).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
    expect(decideFailure(part({ legacyStatus: "failed" }), member())).toEqual({
      ok: false,
      code: "part_closed",
    });
  });
});

describe("decideReopen", () => {
  const failed = part({ legacyStatus: "failed" });

  it("lets the Owner reopen a failed Part to in_progress", () => {
    expect(decideReopen(failed, member())).toEqual({ ok: true, value: "in_progress" });
  });

  it("lets an active Primary_Caregiver reopen", () => {
    const actor = member({ memberId: "pc", role: "primary_caregiver" });
    expect(decideReopen(failed, actor)).toEqual({ ok: true, value: "in_progress" });
  });

  it("refuses other Members with not_allowed_reopen", () => {
    expect(decideReopen(failed, member({ memberId: "x" }))).toEqual({
      ok: false,
      code: "not_allowed_reopen",
    });
    expect(decideReopen(failed, member({ memberId: "d", role: "family_member" }))).toEqual({
      ok: false,
      code: "not_allowed_reopen",
    });
  });

  it("refuses a Part that is not failed", () => {
    expect(decideReopen(part(), member())).toEqual({ ok: false, code: "not_failed" });
  });

  it("refuses care recipients and inactive Primary_Caregivers", () => {
    expect(decideReopen(failed, member({ role: "care_recipient" }))).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
    expect(
      decideReopen(failed, member({ memberId: "pc", role: "primary_caregiver", isActive: false })),
    ).toEqual({ ok: false, code: "part_not_found" });
  });
});
