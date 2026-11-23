import { describe, expect, it } from "vitest";
import {
  decideAssignmentRequest,
  decideBackupRequest,
  decideHandoverRequest,
  decideRequestResponse,
  decideVolunteerBackup,
  eligibleReceivers,
  handoverExpiry,
  handoverExpiryWithRule,
  requestExpiry,
  type CareRequestSnapshot,
} from "@/lib/care/rules/requests";
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
    storedApprovalState: "approved",
    legacyStatus: "in_progress",
    ownerId: "m-owner",
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
    memberId: "m-recv",
    householdId: "h1",
    role: "family_member",
    isActive: true,
    ...overrides,
  };
}

const primary = member({ memberId: "m-primary", role: "primary_caregiver" });
const owner = member({ memberId: "m-owner" });
const receiver = member({ memberId: "m-recv" });

function request(overrides: Partial<CareRequestSnapshot> = {}): CareRequestSnapshot {
  return {
    id: "r1",
    careStepId: "p1",
    householdId: "h1",
    kind: "handover",
    helperRole: "owner",
    requesterId: "m-owner",
    receiverId: "m-recv",
    status: "pending",
    expiresAt: hoursFromNow(10),
    ...overrides,
  };
}

describe("expiry", () => {
  it("handover uses a future human-confirmed Task_Due_Time", () => {
    const due = { at: hoursFromNow(5), timeZone: "UTC", provenance: "human_confirmed" as const };
    expect(handoverExpiry(part({ taskDue: due }), NOW)).toEqual(due.at);
    expect(handoverExpiryWithRule(part({ taskDue: due }), NOW).expiryRule).toBe("task_due");
  });

  it("handover falls back to 24 hours without a usable due time", () => {
    const expected = hoursFromNow(24);
    const suggested = { at: hoursFromNow(5), timeZone: "UTC", provenance: "model_suggested" as const };
    const pastDue = { at: hoursFromNow(-3), timeZone: "UTC", provenance: "human_confirmed" as const };
    expect(handoverExpiry(part({ taskDue: null }), NOW)).toEqual(expected);
    expect(handoverExpiry(part({ taskDue: suggested }), NOW)).toEqual(expected);
    expect(handoverExpiry(part({ taskDue: pastDue }), NOW)).toEqual(expected);
    expect(handoverExpiryWithRule(part({ taskDue: pastDue }), NOW).expiryRule).toBe("24h");
  });

  it("assignment and backup requests expire 24 hours after the request", () => {
    expect(requestExpiry(NOW)).toEqual(hoursFromNow(24));
  });
});

describe("eligibleReceivers", () => {
  it("keeps active, same-household, non-recipient members other than the requester", () => {
    const members = [
      owner,
      receiver,
      member({ memberId: "inactive", isActive: false }),
      member({ memberId: "other-house", householdId: "h2" }),
      member({ memberId: "grandma", role: "care_recipient" }),
      primary,
    ];
    const result = eligibleReceivers(part(), owner, members).map((m) => m.memberId);
    expect(result).toEqual(["m-recv", "m-primary"]);
  });
});

describe("decideAssignmentRequest", () => {
  it("lets a primary caregiver start an assignment", () => {
    const d = decideAssignmentRequest(part(), primary, receiver, [], NOW);
    expect(d).toEqual({
      ok: true,
      value: { kind: "assignment", helperRole: "owner", expiresAt: hoursFromNow(24), expiryRule: "24h" },
    });
  });

  it("refuses non-primary caregivers, bad receivers, and a second pending request", () => {
    expect(decideAssignmentRequest(part(), owner, receiver, [], NOW)).toEqual({
      ok: false,
      code: "not_primary_caregiver",
    });
    expect(
      decideAssignmentRequest(part(), primary, member({ role: "care_recipient" }), [], NOW),
    ).toEqual({ ok: false, code: "receiver_not_eligible" });
    expect(
      decideAssignmentRequest(part(), primary, receiver, [request({ kind: "assignment" })], NOW),
    ).toEqual({ ok: false, code: "request_pending" });
    expect(
      decideAssignmentRequest(part(), member({ role: "care_recipient" }), receiver, [], NOW),
    ).toEqual({ ok: false, code: "recipient_read_only" });
    expect(decideAssignmentRequest(part({ legacyStatus: "completed" }), primary, receiver, [], NOW)).toEqual({
      ok: false,
      code: "part_closed",
    });
  });
});

describe("decideHandoverRequest", () => {
  it("lets the holder request a handover with the due-time expiry", () => {
    const due = { at: hoursFromNow(5), timeZone: "UTC", provenance: "human_confirmed" as const };
    const d = decideHandoverRequest(part({ taskDue: due }), owner, "owner", receiver, [], NOW);
    expect(d).toEqual({
      ok: true,
      value: { kind: "handover", helperRole: "owner", expiresAt: due.at, expiryRule: "task_due" },
    });
  });

  it("refuses a non-holder and the requester as receiver", () => {
    expect(decideHandoverRequest(part(), receiver, "owner", primary, [], NOW)).toEqual({
      ok: false,
      code: "not_holder",
    });
    expect(decideHandoverRequest(part(), owner, "owner", owner, [], NOW)).toEqual({
      ok: false,
      code: "receiver_not_eligible",
    });
  });
});

describe("backup requests", () => {
  it("allows the owner and a primary caregiver, refuses others", () => {
    expect(decideBackupRequest(part(), owner, receiver, [], NOW).ok).toBe(true);
    expect(decideBackupRequest(part(), primary, receiver, [], NOW).ok).toBe(true);
    expect(decideBackupRequest(part(), receiver, primary, [], NOW)).toEqual({
      ok: false,
      code: "not_allowed_backup_request",
    });
  });

  it("refuses naming the owner as backup and a second pending backup request", () => {
    expect(decideBackupRequest(part(), primary, owner, [], NOW)).toEqual({
      ok: false,
      code: "receiver_not_eligible",
    });
    expect(
      decideBackupRequest(part(), owner, receiver, [request({ kind: "backup", helperRole: null })], NOW),
    ).toEqual({ ok: false, code: "request_pending" });
  });

  it("volunteering sets the backup directly unless one exists or the actor is owner", () => {
    const d = decideVolunteerBackup(part(), receiver);
    expect(d.ok && d.value.backupOwnerId).toBe("m-recv");
    expect(decideVolunteerBackup(part({ backupOwnerId: "x" }), receiver)).toEqual({
      ok: false,
      code: "already_claimed",
    });
    expect(decideVolunteerBackup(part(), owner)).toEqual({ ok: false, code: "invalid_input" });
  });
});

describe("decideRequestResponse", () => {
  it("accepting a handover moves only that role and resets approval on a high-risk part", () => {
    const p = part({ driverId: "m-driver" });
    const d = decideRequestResponse(request(), p, receiver, NOW, true);
    expect(d.ok).toBe(true);
    if (!d.ok || d.value.outcome !== "accepted") throw new Error("expected accepted");
    expect(d.value.part.ownerId).toBe("m-recv");
    expect(d.value.part.driverId).toBe("m-driver");
    expect(d.value.part.storedApprovalState).toBe("pending");
    expect(d.value.approvalReset).toBe(true);
  });

  it("accepting an assignment on a low-risk part leaves approval alone", () => {
    const p = part({
      riskLevel: "low",
      careCategory: "household",
      approvalRequired: false,
      storedApprovalState: "not_required",
      ownerId: null,
    });
    const d = decideRequestResponse(
      request({ kind: "assignment", requesterId: "m-primary" }),
      p,
      receiver,
      NOW,
      true,
    );
    if (!d.ok || d.value.outcome !== "accepted") throw new Error("expected accepted");
    expect(d.value.part.ownerId).toBe("m-recv");
    expect(d.value.part.storedApprovalState).toBe("not_required");
    expect(d.value.approvalReset).toBe(false);
  });

  it("accepting a backup sets only the backup and leaves approval alone", () => {
    const p = part({ backupOwnerId: "old-backup" });
    const d = decideRequestResponse(
      request({ kind: "backup", helperRole: null }),
      p,
      receiver,
      NOW,
      true,
    );
    if (!d.ok || d.value.outcome !== "accepted") throw new Error("expected accepted");
    expect(d.value.part.backupOwnerId).toBe("m-recv");
    expect(d.value.part.ownerId).toBe("m-owner");
    expect(d.value.part.storedApprovalState).toBe("approved");
  });

  it("keeps the previous backup while the request is pending and on decline", () => {
    const p = part({ backupOwnerId: "old-backup" });
    const d = decideRequestResponse(request({ kind: "backup", helperRole: null }), p, receiver, NOW, false);
    expect(d).toEqual({
      ok: true,
      value: { outcome: "declined", requestStatus: "declined", part: p },
    });
  });

  it("returns a committed expired result when accepted at or after expiry", () => {
    const p = part();
    const atExpiry = request({ expiresAt: NOW });
    const d = decideRequestResponse(atExpiry, p, receiver, NOW, true);
    expect(d).toEqual({ ok: true, value: { outcome: "expired", requestStatus: "expired", part: p } });
  });

  it("closes a handover as declined when the requester no longer holds the role", () => {
    const p = part({ ownerId: "someone-else" });
    const d = decideRequestResponse(request(), p, receiver, NOW, true);
    expect(d).toEqual({
      ok: true,
      value: { outcome: "declined", requestStatus: "declined", part: p, reason: "holder_changed" },
    });
  });

  it("refuses answers from anyone but the receiver, answered requests, and closed parts", () => {
    expect(decideRequestResponse(request(), part(), owner, NOW, true)).toEqual({
      ok: false,
      code: "request_not_found",
    });
    expect(decideRequestResponse(request({ status: "declined" }), part(), receiver, NOW, true)).toEqual({
      ok: false,
      code: "request_not_pending",
    });
    expect(
      decideRequestResponse(request(), part({ legacyStatus: "cancelled" }), receiver, NOW, true),
    ).toEqual({ ok: false, code: "part_closed" });
  });

  it("refuses acceptance by a receiver who became inactive", () => {
    const gone = member({ isActive: false });
    expect(decideRequestResponse(request(), part(), gone, NOW, true)).toEqual({
      ok: false,
      code: "receiver_not_eligible",
    });
  });
});
