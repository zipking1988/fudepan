import { describe, expect, it } from "vitest";
import {
  currentHolder,
  decideClaim,
  decideRelease,
  helperRolesOffered,
} from "@/lib/care/rules/claims";
import type { MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

const NOW = new Date("2025-01-10T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000);

function part(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
  return {
    id: "p1",
    householdId: "h1",
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    storedApprovalState: "pending",
    legacyStatus: "pending_review",
    ownerId: null,
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
    role: "family_member",
    isActive: true,
    ...overrides,
  };
}

function due(hours: number, provenance: "human_confirmed" | "model_suggested" = "human_confirmed") {
  return { at: hoursFromNow(hours), timeZone: "UTC", provenance };
}

describe("helperRolesOffered", () => {
  it("offers driver and companion only for appointment and transport", () => {
    expect(helperRolesOffered({ careCategory: "appointment" })).toEqual([
      "owner",
      "driver",
      "companion",
    ]);
    expect(helperRolesOffered({ careCategory: "transport" })).toEqual([
      "owner",
      "driver",
      "companion",
    ]);
    expect(helperRolesOffered({ careCategory: "household" })).toEqual(["owner"]);
    expect(helperRolesOffered({ careCategory: "medication" })).toEqual(["owner"]);
  });
});

describe("decideClaim", () => {
  it("records the actor as owner of an unclaimed part", () => {
    const result = decideClaim(part(), member(), "owner");
    expect(result).toMatchObject({ ok: true, value: { ownerId: "m1" } });
  });

  it("lets one member hold several roles and keeps one holder per role", () => {
    const first = decideClaim(part(), member(), "driver");
    if (!first.ok) throw new Error("expected ok");
    const second = decideClaim(first.value, member(), "companion");
    expect(second).toMatchObject({ ok: true, value: { driverId: "m1", companionId: "m1" } });
  });

  it("refuses a held role and leaves the holder discoverable", () => {
    const held = part({ ownerId: "other" });
    expect(decideClaim(held, member(), "owner")).toEqual({ ok: false, code: "already_claimed" });
    expect(currentHolder(held, "owner")).toBe("other");
  });

  it("refuses a care recipient", () => {
    expect(decideClaim(part(), member({ role: "care_recipient" }), "owner")).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
  });

  it("refuses inactive members and members of another household", () => {
    expect(decideClaim(part(), member({ isActive: false }), "owner")).toEqual({
      ok: false,
      code: "part_not_found",
    });
    expect(decideClaim(part(), member({ householdId: "h2" }), "owner")).toEqual({
      ok: false,
      code: "part_not_found",
    });
  });

  it("refuses a role that is not offered", () => {
    const shopping = part({ careCategory: "household", riskLevel: "low" });
    expect(decideClaim(shopping, member(), "driver")).toEqual({
      ok: false,
      code: "role_not_offered",
    });
  });

  it("refuses completed and cancelled parts", () => {
    for (const legacyStatus of ["completed", "cancelled"]) {
      expect(decideClaim(part({ legacyStatus }), member(), "owner")).toEqual({
        ok: false,
        code: "part_closed",
      });
    }
  });

  it("keeps approval unchanged for pending, rejected, and not-required states", () => {
    const pending = decideClaim(part({ storedApprovalState: "pending" }), member(), "owner");
    const rejected = decideClaim(part({ storedApprovalState: "rejected" }), member(), "owner");
    expect(pending).toMatchObject({ ok: true, value: { storedApprovalState: "pending" } });
    expect(rejected).toMatchObject({ ok: true, value: { storedApprovalState: "rejected" } });
  });

  it("resets approved to pending on a high-risk part and never changes approvalRequired", () => {
    const result = decideClaim(part({ storedApprovalState: "approved" }), member(), "driver");
    expect(result).toMatchObject({
      ok: true,
      value: { storedApprovalState: "pending", approvalRequired: true, driverId: "m1" },
    });
  });

  it("leaves a low-risk approved part approved", () => {
    const low = part({
      careCategory: "household",
      riskLevel: "low",
      approvalRequired: false,
      storedApprovalState: null,
    });
    const result = decideClaim(low, member(), "owner");
    expect(result).toMatchObject({ ok: true, value: { storedApprovalState: null } });
  });

  it("treats a legacy approved status as approved and resets it", () => {
    const legacy = part({ storedApprovalState: null, legacyStatus: "approved" });
    expect(decideClaim(legacy, member(), "owner")).toMatchObject({
      ok: true,
      value: { storedApprovalState: "pending" },
    });
  });

  it("does not mutate the input part", () => {
    const original = part();
    decideClaim(original, member(), "owner");
    expect(original.ownerId).toBeNull();
  });
});

describe("decideRelease", () => {
  const held = (overrides: Partial<PartSnapshot> = {}) => part({ ownerId: "m1", ...overrides });

  it("releases the holder's role when no due time exists", () => {
    expect(decideRelease(held(), member(), "owner", NOW)).toMatchObject({
      ok: true,
      value: { ownerId: null },
    });
  });

  it("refuses a member who does not hold the role", () => {
    expect(decideRelease(held({ ownerId: "other" }), member(), "owner", NOW)).toEqual({
      ok: false,
      code: "not_holder",
    });
  });

  it("refuses a care recipient and a closed part", () => {
    expect(decideRelease(held(), member({ role: "care_recipient" }), "owner", NOW)).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
    expect(decideRelease(held({ legacyStatus: "completed" }), member(), "owner", NOW)).toEqual({
      ok: false,
      code: "part_closed",
    });
  });

  it("blocks release of a high-risk part due within 24 hours", () => {
    expect(decideRelease(held({ taskDue: due(23) }), member(), "owner", NOW)).toEqual({
      ok: false,
      code: "release_blocked_due_soon",
    });
    expect(decideRelease(held({ taskDue: due(24) }), member(), "owner", NOW)).toEqual({
      ok: false,
      code: "release_blocked_due_soon",
    });
  });

  it("blocks release of an overdue high-risk part", () => {
    expect(decideRelease(held({ taskDue: due(-5) }), member(), "owner", NOW)).toEqual({
      ok: false,
      code: "release_blocked_due_soon",
    });
  });

  it("allows release when the due time is more than 24 hours away", () => {
    expect(decideRelease(held({ taskDue: due(25) }), member(), "owner", NOW).ok).toBe(true);
  });

  it("ignores a model-suggested due time", () => {
    expect(
      decideRelease(held({ taskDue: due(1, "model_suggested") }), member(), "owner", NOW).ok,
    ).toBe(true);
  });

  it("does not block a part that is not high risk", () => {
    const low = held({ careCategory: "household", riskLevel: "low", taskDue: due(-2) });
    expect(decideRelease(low, member(), "owner", NOW).ok).toBe(true);
  });

  it("releases a driver role and resets approval on a high-risk part", () => {
    const result = decideRelease(
      part({ driverId: "m1", storedApprovalState: "approved" }),
      member(),
      "driver",
      NOW,
    );
    expect(result).toMatchObject({
      ok: true,
      value: { driverId: null, storedApprovalState: "pending" },
    });
  });
});
