import { describe, expect, it } from "vitest";
import {
  ALLOW_LEGACY_BACKUP_CLEAR,
  translateOwnerAssignment,
  type OwnerAssignmentContext,
  type OwnerAssignmentInput,
} from "@/lib/care/owner-assignment";
import type { MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

const NOW = new Date("2025-01-10T12:00:00Z");

function part(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
  return {
    id: "p1",
    householdId: "h1",
    careCategory: "household",
    riskLevel: "low",
    approvalRequired: false,
    storedApprovalState: null,
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

function member(memberId: string, overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return { memberId, householdId: "h1", role: "family_member", isActive: true, ...overrides };
}

const primary = member("pc", { role: "primary_caregiver" });
const family = member("fm");
const other = member("other");
const recipient = member("rec", { role: "care_recipient" });

const ctx: OwnerAssignmentContext = {
  members: [primary, family, other, recipient],
  now: NOW,
};

function run(
  p: PartSnapshot,
  input: Partial<OwnerAssignmentInput>,
  actor: MemberSnapshot,
  c: OwnerAssignmentContext = ctx,
) {
  return translateOwnerAssignment(p, { stepId: "p1", ownerId: p.ownerId, ...input }, actor, c);
}

describe("translateOwnerAssignment owner changes", () => {
  it("turns a self owner on an unowned part into a claim", () => {
    expect(run(part(), { ownerId: "fm" }, family)).toEqual({
      ok: true,
      value: [{ type: "claim_part", role: "owner" }],
    });
  });

  it("refuses a self claim when someone else already owns the part", () => {
    expect(run(part({ ownerId: "other" }), { ownerId: "fm" }, family)).toEqual({
      ok: false,
      code: "already_claimed",
    });
  });

  it("turns another owner into an assignment request for a primary caregiver", () => {
    expect(run(part(), { ownerId: "fm" }, primary)).toEqual({
      ok: true,
      value: [{ type: "request_assignment", receiverId: "fm" }],
    });
  });

  it("refuses assigning someone else for a non-primary caregiver", () => {
    expect(run(part(), { ownerId: "other" }, family)).toEqual({
      ok: false,
      code: "not_primary_caregiver",
    });
  });

  it("refuses a receiver who is a care recipient, inactive, or unknown", () => {
    const refusal = { ok: false, code: "receiver_not_eligible" };
    expect(run(part(), { ownerId: "rec" }, primary)).toEqual(refusal);
    expect(run(part(), { ownerId: "ghost" }, primary)).toEqual(refusal);
    const gone = member("gone", { isActive: false });
    expect(run(part(), { ownerId: "gone" }, primary, { ...ctx, members: [primary, gone] })).toEqual(
      refusal,
    );
  });

  it("uses a handover when the current owner gives the part to someone else", () => {
    expect(run(part({ ownerId: "fm" }), { ownerId: "other" }, family)).toEqual({
      ok: true,
      value: [{ type: "request_handover", role: "owner", receiverId: "other" }],
    });
  });

  it("uses an assignment request when a primary caregiver changes someone else's owner", () => {
    expect(run(part({ ownerId: "other" }), { ownerId: "fm" }, primary)).toEqual({
      ok: true,
      value: [{ type: "request_assignment", receiverId: "fm" }],
    });
  });

  it("refuses a duplicate pending assignment", () => {
    const pending = [
      {
        id: "r1",
        careStepId: "p1",
        householdId: "h1",
        kind: "assignment" as const,
        helperRole: "owner" as const,
        requesterId: "pc",
        receiverId: "fm",
        status: "pending" as const,
        expiresAt: new Date(NOW.getTime() + 3600_000),
      },
    ];
    expect(run(part(), { ownerId: "other" }, primary, { ...ctx, pending })).toEqual({
      ok: false,
      code: "request_pending",
    });
  });

  it("turns a cleared owner into a release by the holder", () => {
    expect(run(part({ ownerId: "fm" }), { ownerId: null }, family)).toEqual({
      ok: true,
      value: [{ type: "release_part", role: "owner" }],
    });
  });

  it("refuses clearing an owner who is someone else", () => {
    expect(run(part({ ownerId: "other" }), { ownerId: null }, primary)).toEqual({
      ok: false,
      code: "not_holder",
    });
  });

  it("refuses a release close to a confirmed due time on a high-risk part", () => {
    const risky = part({
      ownerId: "fm",
      riskLevel: "high",
      taskDue: {
        at: new Date(NOW.getTime() + 3600_000),
        timeZone: "UTC",
        provenance: "human_confirmed",
      },
    });
    expect(run(risky, { ownerId: null }, family)).toEqual({
      ok: false,
      code: "release_blocked_due_soon",
    });
  });

  it("refuses a care recipient and a closed part", () => {
    expect(run(part(), { ownerId: "rec" }, recipient)).toEqual({
      ok: false,
      code: "recipient_read_only",
    });
    expect(run(part({ legacyStatus: "completed" }), { ownerId: "fm" }, family)).toEqual({
      ok: false,
      code: "part_closed",
    });
  });
});

describe("translateOwnerAssignment backup changes", () => {
  it("turns a self backup into volunteering", () => {
    expect(run(part({ ownerId: "other" }), { backupOwnerId: "fm" }, family)).toEqual({
      ok: true,
      value: [{ type: "volunteer_backup" }],
    });
  });

  it("refuses volunteering as the owner and over an existing backup", () => {
    expect(run(part({ ownerId: "fm" }), { backupOwnerId: "fm" }, family)).toEqual({
      ok: false,
      code: "invalid_input",
    });
    expect(
      run(part({ ownerId: "other", backupOwnerId: "pc" }), { backupOwnerId: "fm" }, family),
    ).toEqual({ ok: false, code: "already_claimed" });
  });

  it("turns another backup into a backup request from the owner or a primary caregiver", () => {
    const expected = { ok: true, value: [{ type: "request_backup", receiverId: "other" }] };
    expect(run(part({ ownerId: "fm" }), { backupOwnerId: "other" }, family)).toEqual(expected);
    expect(run(part({ ownerId: "fm" }), { backupOwnerId: "other" }, primary)).toEqual(expected);
  });

  it("refuses a backup request from a member who is neither owner nor primary caregiver", () => {
    expect(run(part({ ownerId: "fm" }), { backupOwnerId: "pc" }, other)).toEqual({
      ok: false,
      code: "not_allowed_backup_request",
    });
  });

  it("refuses naming the owner as the backup", () => {
    expect(run(part({ ownerId: "fm" }), { backupOwnerId: "fm" }, primary)).toEqual({
      ok: false,
      code: "receiver_not_eligible",
    });
  });

  it("refuses clearing a backup (D-6) and produces nothing", () => {
    expect(ALLOW_LEGACY_BACKUP_CLEAR).toBe(false);
    expect(
      run(part({ ownerId: "fm", backupOwnerId: "pc" }), { backupOwnerId: null }, family),
    ).toEqual({
      ok: false,
      code: "not_allowed_backup_request",
    });
  });

  it("emits withdraw_backup only when the flag is on", () => {
    expect(
      run(part({ ownerId: "fm", backupOwnerId: "pc" }), { backupOwnerId: null }, family, {
        ...ctx,
        allowLegacyBackupClear: true,
      }),
    ).toEqual({ ok: true, value: [{ type: "withdraw_backup" }] });
  });

  it("treats clearing an empty backup as a no-op", () => {
    expect(run(part({ ownerId: "fm" }), { backupOwnerId: null }, family)).toEqual({
      ok: true,
      value: [],
    });
  });
});

describe("translateOwnerAssignment combined and no-op input", () => {
  it("returns an empty list when nothing changes", () => {
    const p = part({ ownerId: "fm", backupOwnerId: "pc" });
    expect(run(p, { ownerId: "fm", backupOwnerId: "pc" }, family)).toEqual({ ok: true, value: [] });
    expect(run(p, { ownerId: "fm" }, family)).toEqual({ ok: true, value: [] });
  });

  it("orders the owner operation before the backup operation", () => {
    expect(run(part(), { ownerId: "fm", backupOwnerId: "other" }, family)).toEqual({
      ok: true,
      value: [
        { type: "claim_part", role: "owner" },
        { type: "request_backup", receiverId: "other" },
      ],
    });
  });

  it("refuses the whole input when one part is refused", () => {
    expect(
      run(part({ backupOwnerId: "pc" }), { ownerId: "fm", backupOwnerId: null }, family),
    ).toEqual({ ok: false, code: "not_allowed_backup_request" });
  });

  it("never returns an operation that writes another member directly", () => {
    const result = run(part(), { ownerId: "other", backupOwnerId: "fm" }, primary);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((o) => o.type)).toEqual(["request_assignment", "request_backup"]);
    }
  });
});
