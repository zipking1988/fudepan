import { describe, expect, it } from "vitest";
import { CareReferenceModel } from "@/lib/care/rules/model";
import type { HouseholdRole } from "@/lib/households/membership";
import type { PartSnapshot } from "@/lib/care/rules/types";

const NOW = new Date("2025-01-10T12:00:00Z");
const after = (hours: number, from: Date = NOW) => new Date(from.getTime() + hours * 3600_000);

function basePart(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
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
    taskDue: { at: after(72), timeZone: "Asia/Tokyo", provenance: "human_confirmed" },
    respondBy: null,
    evidenceRequired: [],
    evidenceAttached: [],
    planVersion: 1,
    rejectedAtPlanVersion: null,
    ...overrides,
  };
}

function setup(
  part: Partial<PartSnapshot> = {},
  roles: Record<string, HouseholdRole> = {},
): CareReferenceModel {
  const model = new CareReferenceModel();
  model.addHousehold("h1");
  model.addHousehold("h2");
  const all: Record<string, HouseholdRole> = {
    care: "care_recipient",
    misa: "primary_caregiver",
    ken: "family_member",
    mia: "family_member",
    ...roles,
  };
  for (const [memberId, role] of Object.entries(all)) {
    model.addMember({ memberId, householdId: "h1", role, isActive: true });
  }
  model.addMember({
    memberId: "outsider",
    householdId: "h2",
    role: "primary_caregiver",
    isActive: true,
  });
  model.addPart(basePart(part), "note-1");
  return model;
}

const types = (model: CareReferenceModel) => model.auditLog("h1").map((e) => e.type);

describe("Requirement 20 flow at the model level", () => {
  it("claim, refused approval, handover, acceptance, approval, completion in order", () => {
    const model = setup({ evidenceRequired: ["visit note"] });

    const claim = model.claim("ken", "p1", "owner", NOW);
    expect(claim).toMatchObject({ ok: true, approvalReset: false });
    expect(model.getPart("p1")).toMatchObject({ ownerId: "ken", storedApprovalState: "pending" });

    const logBefore = model.auditLog().length;
    const feedBefore = model.feed().length;
    expect(model.decideApproval("ken", "p1", "approve", after(1))).toEqual({
      ok: false,
      code: "not_primary_caregiver",
    });
    expect(model.auditLog()).toHaveLength(logBefore);
    expect(model.feed()).toHaveLength(feedBefore);

    const handover = model.requestHandover("ken", "p1", "owner", "mia", after(2));
    expect(handover.ok).toBe(true);
    expect(model.getPart("p1")?.ownerId).toBe("ken");
    const requestId = handover.ok ? handover.requestId! : "";

    const accepted = model.respondToRequest("mia", requestId, true, after(3));
    expect(accepted).toMatchObject({ ok: true, outcome: "accepted", approvalReset: false });
    expect(model.getPart("p1")).toMatchObject({ ownerId: "mia", storedApprovalState: "pending" });

    expect(model.decideApproval("misa", "p1", "approve", after(4))).toMatchObject({
      ok: true,
      outcome: "approved",
    });
    expect(model.getPart("p1")?.storedApprovalState).toBe("approved");

    expect(
      model.recordEvidence(
        "mia",
        "p1",
        { label: "visit note", kind: "text", text: "Seen" },
        after(5),
      ),
    ).toMatchObject({ ok: true });
    expect(model.complete("mia", "p1", after(6))).toMatchObject({ ok: true, outcome: "completed" });
    expect(model.getPart("p1")?.legacyStatus).toBe("completed");

    expect(types(model)).toEqual([
      "part.claimed",
      "handover.requested",
      "reminder.sent",
      "handover.accepted",
      "approval.given",
      "evidence.uploaded",
      "part.completed",
    ]);
    const log = model.auditLog("h1");
    expect(log.map((e) => e.actor)).toEqual(["ken", "ken", "system", "mia", "misa", "mia", "mia"]);
    expect(log.map((e) => e.seq)).toEqual([...log.map((e) => e.seq)].sort((a, b) => a - b));
    expect(log.every((e) => e.noteId === "note-1")).toBe(true);
  });
});

describe("refusals change nothing", () => {
  it("leaves state, audit log, and feed untouched", () => {
    const model = setup({ ownerId: "ken" });
    const snapshot = JSON.stringify([
      model.getPart("p1"),
      model.auditLog(),
      model.feed(),
      model.requests(),
    ]);

    expect(model.claim("care", "p1", "driver", NOW)).toMatchObject({
      ok: false,
      code: "recipient_read_only",
    });
    expect(model.claim("mia", "p1", "owner", NOW)).toEqual({
      ok: false,
      code: "already_claimed",
      holderId: "ken",
    });
    expect(model.claim("mia", "p1", "owner", NOW)).toMatchObject({ holderId: "ken" });
    expect(model.release("mia", "p1", "owner", NOW)).toMatchObject({ code: "not_holder" });
    expect(model.requestAssignment("ken", "p1", "mia", NOW)).toMatchObject({
      code: "not_primary_caregiver",
    });
    expect(model.complete("mia", "p1", NOW)).toEqual({
      ok: false,
      code: "not_owner",
      ownerId: "ken",
    });
    expect(model.complete("ken", "p1", NOW)).toMatchObject({ code: "approval_pending" });
    expect(model.reopen("misa", "p1", NOW)).toMatchObject({ code: "not_failed" });

    expect(
      JSON.stringify([model.getPart("p1"), model.auditLog(), model.feed(), model.requests()]),
    ).toBe(snapshot);
  });

  it("treats another household and an unknown part the same way", () => {
    const model = setup();
    expect(model.claim("outsider", "p1", "owner", NOW)).toEqual({
      ok: false,
      code: "part_not_found",
    });
    expect(model.claim("ken", "missing", "owner", NOW)).toEqual({
      ok: false,
      code: "part_not_found",
    });
    model.updateMember("ken", { isActive: false });
    expect(model.claim("ken", "p1", "owner", NOW)).toEqual({ ok: false, code: "part_not_found" });
    expect(model.auditLog()).toHaveLength(0);
  });
});

describe("approval reset on people changes", () => {
  it("resets an approved High_Risk_Part in the same step, with reminders and a plan version bump", () => {
    const model = setup({ storedApprovalState: "approved", ownerId: "ken" });

    const released = model.release("ken", "p1", "owner", NOW);
    // Task due in 72 hours, so release is allowed.
    expect(released).toMatchObject({ ok: true, approvalReset: true });
    expect(model.getPart("p1")).toMatchObject({
      ownerId: null,
      storedApprovalState: "pending",
      planVersion: 2,
    });
    expect(types(model)).toEqual(["part.released", "approval.reset", "reminder.sent"]);
    const reminder = model.feed("h1").find((f) => f.recipientMemberId !== null);
    expect(reminder?.recipientMemberId).toBe("misa");
  });

  it("resets on an accepted Assignment and keeps `rejected` as rejected", () => {
    const model = setup({ storedApprovalState: "approved" });
    const req = model.requestAssignment("misa", "p1", "ken", NOW);
    expect(model.getPart("p1")?.storedApprovalState).toBe("approved");
    const accepted = model.respondToRequest("ken", req.ok ? req.requestId! : "", true, after(1));
    expect(accepted).toMatchObject({ ok: true, approvalReset: true });
    expect(model.getPart("p1")).toMatchObject({ ownerId: "ken", storedApprovalState: "pending" });

    const rejectedModel = setup({ storedApprovalState: "rejected", rejectedAtPlanVersion: 1 });
    rejectedModel.claim("ken", "p1", "owner", NOW);
    expect(rejectedModel.getPart("p1")).toMatchObject({
      storedApprovalState: "rejected",
      planVersion: 2,
    });
    expect(types(rejectedModel)).toEqual(["part.claimed"]);
  });

  it("does not reset a low-risk Part", () => {
    const model = setup({
      careCategory: "household",
      riskLevel: "low",
      approvalRequired: false,
      storedApprovalState: "not_required",
      ownerId: "ken",
      taskDue: null,
    });
    expect(model.release("ken", "p1", "owner", NOW)).toMatchObject({
      ok: true,
      approvalReset: false,
    });
    expect(model.getPart("p1")?.storedApprovalState).toBe("not_required");
  });
});

describe("release rule", () => {
  it("refuses release of a High_Risk_Part due within 24 hours", () => {
    const model = setup({
      ownerId: "ken",
      taskDue: { at: after(5), timeZone: "Asia/Tokyo", provenance: "human_confirmed" },
    });
    expect(model.release("ken", "p1", "owner", NOW)).toMatchObject({
      ok: false,
      code: "release_blocked_due_soon",
    });
    expect(model.getPart("p1")?.ownerId).toBe("ken");
  });
});

describe("request lifecycle", () => {
  it("declining keeps the holder and reminds the requester", () => {
    const model = setup({ ownerId: "ken" });
    const req = model.requestHandover("ken", "p1", "owner", "mia", NOW);
    const id = req.ok ? req.requestId! : "";
    expect(model.requestHandover("ken", "p1", "owner", "mia", NOW)).toMatchObject({
      code: "request_pending",
    });
    expect(model.respondToRequest("misa", id, true, NOW)).toMatchObject({
      code: "request_not_found",
    });
    expect(model.respondToRequest("mia", id, false, after(1))).toMatchObject({
      outcome: "declined",
    });
    expect(model.getPart("p1")?.ownerId).toBe("ken");
    expect(model.getRequest(id)?.status).toBe("declined");
    expect(model.respondToRequest("mia", id, true, after(2))).toMatchObject({
      code: "request_not_pending",
    });
    const lastReminder = model
      .feed("h1")
      .filter((f) => f.recipientMemberId !== null)
      .at(-1);
    expect(lastReminder?.recipientMemberId).toBe("ken");
  });

  it("commits the expired outcome when accepted at or after the expiry, without a sweep", () => {
    const model = setup({ ownerId: "ken" });
    const req = model.requestHandover("ken", "p1", "owner", "mia", NOW);
    const id = req.ok ? req.requestId! : "";
    // Task due in 72 hours is the expiry (D-7).
    const result = model.respondToRequest("mia", id, true, after(72));
    expect(result).toMatchObject({ ok: true, outcome: "expired" });
    expect(model.getRequest(id)?.status).toBe("expired");
    expect(model.getPart("p1")?.ownerId).toBe("ken");
    expect(types(model)).toEqual([
      "handover.requested",
      "reminder.sent",
      "handover.not_accepted",
      "reminder.sent",
      "reminder.sent",
    ]);
  });

  it("expiry sweep closes only expired requests", () => {
    const model = setup({ taskDue: null });
    const a = model.requestAssignment("misa", "p1", "ken", NOW);
    const b = model.requestBackup("misa", "p1", "mia", after(10));
    expect(model.expireCareRequests("h1", after(25))).toBe(1);
    expect(model.getRequest(a.ok ? a.requestId! : "")?.status).toBe("expired");
    expect(model.getRequest(b.ok ? b.requestId! : "")?.status).toBe("pending");
    expect(model.getPart("p1")?.ownerId).toBeNull();
    expect(model.expireCareRequests("h1", after(25))).toBe(0);
  });

  it("accepting a backup request sets only the backup", () => {
    const model = setup({ ownerId: "ken", storedApprovalState: "approved" });
    const req = model.requestBackup("ken", "p1", "mia", NOW);
    const out = model.respondToRequest("mia", req.ok ? req.requestId! : "", true, after(1));
    expect(out).toMatchObject({ ok: true, approvalReset: false });
    expect(model.getPart("p1")).toMatchObject({
      ownerId: "ken",
      backupOwnerId: "mia",
      storedApprovalState: "approved",
    });
    expect(model.requestBackup("mia", "p1", "misa", after(2))).toMatchObject({
      code: "not_allowed_backup_request",
    });
  });

  it("closes a handover as declined when the requester no longer holds the role", () => {
    const model = setup({ ownerId: "ken", taskDue: null });
    const req = model.requestHandover("ken", "p1", "owner", "mia", NOW);
    model.release("ken", "p1", "owner", after(1));
    model.claim("misa", "p1", "owner", after(2));
    const out = model.respondToRequest("mia", req.ok ? req.requestId! : "", true, after(3));
    expect(out).toMatchObject({ ok: true, outcome: "declined" });
    expect(model.getPart("p1")?.ownerId).toBe("misa");
  });
});

describe("approval decisions", () => {
  it("allows self-approval only with a single active primary caregiver, marked in the payload", () => {
    const solo = setup({ ownerId: "misa" });
    expect(solo.decideApproval("misa", "p1", "approve", NOW)).toMatchObject({ ok: true });
    expect(solo.auditLog()[0]).toMatchObject({
      type: "approval.given",
      payload: { self_approval: true },
    });

    const two = setup({ ownerId: "misa" }, { june: "primary_caregiver" });
    expect(two.decideApproval("misa", "p1", "approve", NOW)).toMatchObject({
      code: "self_approval_blocked",
    });
    // Processing-time check: demoting the other caregiver makes self-approval allowed.
    two.updateMember("june", { role: "family_member" });
    expect(two.decideApproval("misa", "p1", "approve", NOW)).toMatchObject({ ok: true });
  });

  it("reject, refuse approve, resubmit with content, then approve; Progress_Status untouched", () => {
    const model = setup({ ownerId: "ken", legacyStatus: "in_progress" });
    expect(model.decideApproval("misa", "p1", "reject", NOW)).toMatchObject({
      outcome: "rejected",
    });
    expect(model.getPart("p1")).toMatchObject({
      rejectedAtPlanVersion: 1,
      legacyStatus: "in_progress",
    });
    expect(model.decideApproval("misa", "p1", "approve", after(1))).toMatchObject({
      code: "resubmission_required",
    });
    expect(model.resubmit("ken", "p1", {}, after(2))).toMatchObject({ code: "resubmission_empty" });
    expect(model.resubmit("mia", "p1", { explanation: "x" }, after(2))).toMatchObject({
      code: "not_owner",
    });

    expect(model.resubmit("ken", "p1", { explanation: "Booked a taxi" }, after(3))).toMatchObject({
      ok: true,
    });
    expect(model.getPart("p1")?.storedApprovalState).toBe("pending");
    expect(model.resubmissions("p1")[0]?.explanation).toBe("Booked a taxi");
    const event = model.auditLog().find((e) => e.type === "approval.resubmitted");
    expect(event?.payload).toEqual({ added: ["explanation"] });
    expect(JSON.stringify(model.auditLog())).not.toContain("taxi");

    expect(model.decideApproval("misa", "p1", "approve", after(4))).toMatchObject({
      outcome: "approved",
    });
    expect(model.getPart("p1")?.legacyStatus).toBe("in_progress");
  });

  it("accepts new evidence as resubmission content", () => {
    const model = setup({ ownerId: "ken" });
    model.decideApproval("misa", "p1", "reject", NOW);
    model.recordEvidence(
      "ken",
      "p1",
      { label: "photo", kind: "file", storagePath: "e/1.jpg" },
      after(1),
    );
    expect(model.resubmit("ken", "p1", {}, after(2))).toMatchObject({ ok: true });
    expect(model.auditLog().find((e) => e.type === "approval.resubmitted")?.payload).toEqual({
      added: ["evidence"],
    });
  });
});

describe("completion, failure, and reopen", () => {
  it("commits evidence_required with the missing labels, then completes once attached", () => {
    const model = setup({
      ownerId: "ken",
      legacyStatus: "in_progress",
      storedApprovalState: "approved",
      evidenceRequired: ["receipt", "visit note"],
    });
    const first = model.complete("ken", "p1", NOW);
    expect(first).toMatchObject({
      ok: true,
      outcome: "evidence_required",
      missing: ["receipt", "visit note"],
    });
    expect(model.getPart("p1")?.legacyStatus).toBe("evidence_required");
    expect(model.auditLog()[0]).toMatchObject({
      type: "part.evidence_missing",
      payload: { missing_count: 2 },
    });

    model.recordEvidence(
      "ken",
      "p1",
      { label: "receipt", kind: "text", text: "paid 1200" },
      after(1),
    );
    model.recordEvidence(
      "ken",
      "p1",
      { label: "visit note", kind: "file", storagePath: "e/2.pdf" },
      after(1),
    );
    expect(JSON.stringify(model.auditLog())).not.toContain("paid 1200");
    expect(JSON.stringify(model.auditLog())).not.toContain("e/2.pdf");
    expect(model.complete("ken", "p1", after(2))).toMatchObject({ outcome: "completed" });
    expect(model.complete("ken", "p1", after(3))).toMatchObject({ code: "part_closed" });
  });

  it("validates evidence input and who may add it", () => {
    const model = setup({ ownerId: "ken" });
    expect(
      model.recordEvidence("mia", "p1", { label: "a", kind: "text", text: "t" }, NOW),
    ).toMatchObject({
      code: "not_holder",
    });
    expect(model.recordEvidence("ken", "p1", { label: "a", kind: "file" }, NOW)).toMatchObject({
      code: "invalid_input",
    });
    expect(model.auditLog()).toHaveLength(0);
  });

  it("fails, then reopens by the owner or a primary caregiver only, keeping approval", () => {
    const model = setup({
      ownerId: "ken",
      legacyStatus: "in_progress",
      storedApprovalState: "approved",
    });
    expect(model.reportFailed("mia", "p1", "no_show", NOW)).toMatchObject({ code: "not_holder" });
    expect(model.reportFailed("ken", "p1", "no_show", NOW)).toMatchObject({ outcome: "failed" });
    expect(model.reopen("mia", "p1", after(1))).toMatchObject({ code: "not_allowed_reopen" });
    expect(model.reopen("misa", "p1", after(1))).toMatchObject({ outcome: "reopened" });
    expect(model.getPart("p1")).toMatchObject({
      legacyStatus: "in_progress",
      storedApprovalState: "approved",
    });
    expect(types(model)).toEqual(["part.failed", "part.reopened"]);
  });
});

describe("escalation sweep", () => {
  it("escalates once per deadline value, notifies the owner and backup, and never changes approval", () => {
    const model = setup({
      ownerId: "ken",
      backupOwnerId: "mia",
      legacyStatus: "in_progress",
      taskDue: { at: after(1), timeZone: "Asia/Tokyo", provenance: "human_confirmed" },
    });
    expect(model.escalateDueParts("h1", NOW)).toBe(0);
    expect(model.escalateDueParts("h1", after(2))).toBe(1);
    expect(model.getPart("p1")).toMatchObject({
      legacyStatus: "escalated",
      storedApprovalState: "pending",
    });
    expect(types(model)).toEqual(["part.escalated", "reminder.sent", "reminder.sent"]);
    expect(model.escalationLedger()).toHaveLength(1);
    expect(model.escalateDueParts("h1", after(3))).toBe(0);
    expect(model.auditLog()).toHaveLength(3);
  });

  it("expires requests before checking deadlines and skips other households", () => {
    const model = setup({ taskDue: null });
    const req = model.requestAssignment("misa", "p1", "ken", NOW);
    model.escalateDueParts("h2", after(30));
    expect(model.getRequest(req.ok ? req.requestId! : "")?.status).toBe("pending");
    model.escalateDueParts("h1", after(30));
    expect(model.getRequest(req.ok ? req.requestId! : "")?.status).toBe("expired");
  });
});

describe("accounting and determinism", () => {
  it("writes one primary event and one household feed item per successful action", () => {
    const model = setup();
    model.claim("ken", "p1", "driver", NOW);
    model.volunteerBackup("mia", "p1", after(1));
    const feed = model.feed("h1").filter((f) => f.recipientMemberId === null);
    const log = model.auditLog("h1");
    expect(log.map((e) => e.type)).toEqual(["part.driver_volunteered", "backup.accepted"]);
    expect(feed.map((f) => f.auditEventId)).toEqual(log.map((e) => e.id));
    expect(model.volunteerBackup("ken", "p1", after(2))).toMatchObject({ code: "already_claimed" });
  });

  it("produces identical logs for identical inputs", () => {
    const run = () => {
      const model = setup();
      model.claim("ken", "p1", "owner", NOW);
      model.requestHandover("ken", "p1", "owner", "mia", after(1));
      return JSON.stringify([model.auditLog(), model.feed()]);
    };
    expect(run()).toBe(run());
  });
});
