import { describe, expect, it } from "vitest";
import { TASK_ACTIONS } from "@/lib/workflow/transitions";
import { buildTaskActionEvent } from "@/lib/workflow/task-events";
import { auditEventInputSchema } from "@/lib/schemas/audit";

const ids = {
  householdId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
  actorId: "11111111-1111-4111-8111-111111111111",
};

describe("buildTaskActionEvent", () => {
  it("creates an audit row with task_id, actor_id, event_type and payload for every action", () => {
    for (const action of TASK_ACTIONS) {
      const row = buildTaskActionEvent({ action, ...ids, noteId: null });
      expect(row.task_id).toBe(ids.taskId);
      expect(row.actor_id).toBe(ids.actorId);
      expect(row.household_id).toBe(ids.householdId);
      expect(row.event_type).toBeTruthy();
      expect(row.payload).toMatchObject({ action });
    }
  });

  it("approval states that no external action was executed", () => {
    const row = buildTaskActionEvent({
      action: "approve",
      ...ids,
      noteId: null,
      details: { risk_level: "high" },
    });
    expect(row.event_type).toBe("task_approved");
    expect(row.payload).toMatchObject({ executed_external_action: false, risk_level: "high" });
  });

  it("details cannot override the safety flag", () => {
    const row = buildTaskActionEvent({
      action: "approve",
      ...ids,
      noteId: null,
      details: { executed_external_action: true },
    });
    expect(row.payload.executed_external_action).toBe(false);
  });

  it("masks sensitive values in reasons", () => {
    const row = buildTaskActionEvent({
      action: "cancel",
      ...ids,
      noteId: null,
      details: { reason: "card 4242 4242 4242 4242 was wrong" },
    });
    expect(JSON.stringify(row.payload)).not.toContain("4242 4242");
    expect(row.event_type).toBe("task_cancelled");
  });
});

describe("household-level audit events", () => {
  it("may omit task and note", () => {
    for (const eventType of [
      "household_created",
      "member_joined",
      "member_role_changed",
      "invitation_revoked",
    ] as const) {
      expect(
        auditEventInputSchema.safeParse({
          householdId: ids.householdId,
          taskId: null,
          actorId: ids.actorId,
          eventType,
        }).success,
      ).toBe(true);
    }
    expect(
      auditEventInputSchema.safeParse({
        householdId: ids.householdId,
        taskId: null,
        actorId: ids.actorId,
        eventType: "task_approved",
      }).success,
    ).toBe(false);
  });
});
