import { describe, expect, it } from "vitest";
import {
  escalationCandidates,
  escalationLedgerKey,
  type EscalationLedgerEntry,
} from "@/lib/care/rules/escalation";
import type { MemberSnapshot, PartSnapshot } from "@/lib/care/rules/types";

const NOW = new Date("2025-01-10T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000);

function time(h: number, provenance: "human_confirmed" | "model_suggested" = "human_confirmed") {
  return { at: hoursFromNow(h), timeZone: "UTC", provenance };
}

function part(overrides: Partial<PartSnapshot> = {}): PartSnapshot {
  return {
    id: "p1",
    householdId: "h1",
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    storedApprovalState: "approved",
    legacyStatus: "in_progress",
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

const MEMBERS = [
  member("pc1", { role: "primary_caregiver" }),
  member("pc2", { role: "primary_caregiver" }),
  member("pc3", { role: "primary_caregiver", isActive: false }),
  member("fm1"),
];

describe("escalationCandidates: respond-by", () => {
  it("escalates an unclaimed High_Risk_Part past a confirmed Respond_By_Time", () => {
    const plans = escalationCandidates(
      [part({ respondBy: time(-1), backupOwnerId: "fm1" })],
      [],
      NOW,
      MEMBERS,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      careStepId: "p1",
      deadlineKind: "respond_by",
      newStatus: "escalated",
      reminderRecipients: ["pc1", "pc2", "fm1"],
      auditEvent: { type: "part.escalated", payload: { reason: "respond_by" } },
    });
  });

  it("does not escalate once someone has claimed it", () => {
    expect(
      escalationCandidates([part({ respondBy: time(-1), ownerId: "fm1" })], [], NOW, MEMBERS),
    ).toEqual([]);
  });

  it("waits until the Respond_By_Time", () => {
    expect(escalationCandidates([part({ respondBy: time(1) })], [], NOW, MEMBERS)).toEqual([]);
  });

  it("ignores a model-suggested Respond_By_Time", () => {
    expect(
      escalationCandidates([part({ respondBy: time(-1, "model_suggested") })], [], NOW, MEMBERS),
    ).toEqual([]);
  });
});

describe("escalationCandidates: task due", () => {
  it("escalates a not-done Part past a confirmed Task_Due_Time and reminds Owner and Backup_Owner", () => {
    const plans = escalationCandidates(
      [part({ taskDue: time(-2), ownerId: "fm1", backupOwnerId: "pc1" })],
      [],
      NOW,
      MEMBERS,
    );
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      deadlineKind: "task_due",
      reminderRecipients: ["fm1", "pc1"],
      auditEvent: { payload: { reason: "task_due" } },
    });
  });

  it("escalates an already escalated Part for a new Task_Due_Time", () => {
    const ledger: EscalationLedgerEntry[] = [
      { careStepId: "p1", deadlineKind: "task_due", deadlineAt: hoursFromNow(-10) },
    ];
    const plans = escalationCandidates(
      [part({ legacyStatus: "escalated", ownerId: "fm1", taskDue: time(-1) })],
      ledger,
      NOW,
      MEMBERS,
    );
    expect(plans).toHaveLength(1);
  });

  it("ignores a model-guessed due time on an old appointment step", () => {
    const old = part({ taskDue: time(-500, "model_suggested"), ownerId: "fm1" });
    expect(escalationCandidates([old], [], NOW, MEMBERS)).toEqual([]);
  });

  it("never reads legacy due_at or escalation_at", () => {
    const legacy = { ...part({ ownerId: "fm1" }), due_at: "2020-01-01", escalation_at: "2020-01-01" };
    expect(escalationCandidates([legacy], [], NOW, MEMBERS)).toEqual([]);
  });

  it("drops recipients that are not in the members list", () => {
    const plans = escalationCandidates(
      [part({ taskDue: time(-1), ownerId: "ghost", backupOwnerId: "fm1" })],
      [],
      NOW,
      MEMBERS,
    );
    expect(plans[0].reminderRecipients).toEqual(["fm1"]);
  });

  it("skips inactive recipients", () => {
    const plans = escalationCandidates(
      [part({ taskDue: time(-1), ownerId: "pc3", backupOwnerId: "fm1" })],
      [],
      NOW,
      MEMBERS,
    );
    expect(plans[0].reminderRecipients).toEqual(["fm1"]);
  });
});

describe("escalationCandidates: filters and idempotency", () => {
  it("skips completed, cancelled, and failed Parts", () => {
    const parts = ["completed", "cancelled", "failed"].map((s, i) =>
      part({ id: `c${i}`, legacyStatus: s, taskDue: time(-1), respondBy: time(-1) }),
    );
    expect(escalationCandidates(parts, [], NOW, MEMBERS)).toEqual([]);
  });

  it("checks a Reopened Part (in_progress) again with a new Task_Due_Time", () => {
    const reopened = part({ legacyStatus: "in_progress", ownerId: "fm1", taskDue: time(-1) });
    expect(escalationCandidates([reopened], [], NOW, MEMBERS)).toHaveLength(1);
  });

  it("gives low-risk Parts no escalation", () => {
    const low = part({
      riskLevel: "low",
      careCategory: "household",
      taskDue: time(-1),
      respondBy: time(-1),
    });
    expect(escalationCandidates([low], [], NOW, MEMBERS)).toEqual([]);
  });

  it("is idempotent: a ledger entry per (step, kind, deadline) blocks reruns", () => {
    const p = part({ ownerId: "fm1", taskDue: time(-1) });
    const first = escalationCandidates([p], [], NOW, MEMBERS);
    expect(first).toHaveLength(1);
    const ledger = first.map((f) => ({
      careStepId: f.careStepId,
      deadlineKind: f.deadlineKind,
      deadlineAt: f.deadlineAt,
    }));
    expect(escalationCandidates([p], ledger, NOW, MEMBERS)).toEqual([]);
  });

  it("does not change Approval_State and does not mutate input", () => {
    const p = part({ ownerId: "fm1", taskDue: time(-1) });
    const before = JSON.stringify(p);
    const plans = escalationCandidates([p], [], NOW, MEMBERS);
    expect(JSON.stringify(p)).toBe(before);
    expect(Object.keys(plans[0])).not.toContain("approvalState");
  });

  it("builds ledger keys from step, kind, and deadline value", () => {
    const a = escalationLedgerKey({ careStepId: "p1", deadlineKind: "task_due", deadlineAt: NOW });
    const b = escalationLedgerKey({ careStepId: "p1", deadlineKind: "respond_by", deadlineAt: NOW });
    expect(a).not.toBe(b);
  });
});
