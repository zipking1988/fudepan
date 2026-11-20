import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { performTaskAction } from "@/server/api/tasks/actions";
import { editTask } from "@/server/api/tasks/edit";
import { mapRpcError } from "@/server/api/tasks/errors";
import type { Membership } from "@/server/session";
import { taskActionBodySchema, editTaskBodySchema } from "@/lib/schemas/workflow";

const HH = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const USER = "11111111-1111-4111-8111-111111111111";

const member = (role: Membership["role"], memberId = "m-self", householdId = HH): Membership => ({
  memberId,
  householdId,
  householdName: "Test Home",
  role,
  displayName: "Test Person",
});

function clients(
  task: Record<string, unknown> | null,
  rpcResult: { data?: unknown; error?: unknown } = {},
) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const q = {
    select: () => q,
    eq: () => q,
    maybeSingle: async () => ({ data: task }),
  };
  const supabase = { from: () => q } as unknown as SupabaseClient;
  const admin = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return {
        data: rpcResult.data ?? { id: TASK, status: "confirmed" },
        error: rpcResult.error ?? null,
      };
    },
  } as unknown as SupabaseClient;
  return { supabase, admin, rpcCalls };
}

const baseTask = {
  id: TASK,
  household_id: HH,
  note_id: null,
  status: "awaiting_confirmation",
  risk_level: "high",
  assignee_id: null,
};

describe("performTaskAction", () => {
  it("lets a caregiver approve a high-risk task awaiting confirmation, through the service RPC", async () => {
    const c = clients(baseTask);
    const result = await performTaskAction({
      ...c,
      userId: USER,
      memberships: [member("caregiver")],
      taskId: TASK,
      body: { action: "approve", acknowledged: true },
    });
    expect(result.status).toBe("confirmed");
    expect(c.rpcCalls).toHaveLength(1);
    expect(c.rpcCalls[0]).toMatchObject({
      fn: "apply_task_action",
      args: { p_actor: USER, p_task_id: TASK, p_action: "approve" },
    });
    expect(c.rpcCalls[0]!.args.p_payload).toMatchObject({
      action: "approve",
      executed_external_action: false,
      risk_level: "high",
    });
  });

  it("refuses an elder's approval before reaching the database", async () => {
    const c = clients(baseTask);
    await expect(
      performTaskAction({
        ...c,
        userId: USER,
        memberships: [member("elder")],
        taskId: TASK,
        body: { action: "approve", acknowledged: true },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(c.rpcCalls).toHaveLength(0);
  });

  it("refuses approving a high-risk draft directly", async () => {
    const c = clients({ ...baseTask, status: "draft" });
    await expect(
      performTaskAction({
        ...c,
        userId: USER,
        memberships: [member("coordinator")],
        taskId: TASK,
        body: { action: "approve", acknowledged: true },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    expect(c.rpcCalls).toHaveLength(0);
  });

  it("refuses when the user is not a member of the task's household", async () => {
    const c = clients(baseTask);
    await expect(
      performTaskAction({
        ...c,
        userId: USER,
        memberships: [member("coordinator", "m", "99999999-9999-4999-8999-999999999999")],
        taskId: TASK,
        body: { action: "approve", acknowledged: true },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(c.rpcCalls).toHaveLength(0);
  });

  it("treats a task hidden by RLS as not found", async () => {
    const c = clients(null);
    await expect(
      performTaskAction({
        ...c,
        userId: USER,
        memberships: [member("coordinator")],
        taskId: TASK,
        body: { action: "claim" },
      }),
    ).rejects.toMatchObject({ code: "task_not_found" });
  });

  it("masks and sends the cancellation reason", async () => {
    const c = clients(
      { ...baseTask, status: "confirmed" },
      { data: { id: TASK, status: "cancelled" } },
    );
    await performTaskAction({
      ...c,
      userId: USER,
      memberships: [member("caregiver")],
      taskId: TASK,
      body: { action: "cancel", reason: "Wrong card 4242 4242 4242 4242" },
    });
    const args = c.rpcCalls[0]!.args;
    expect(JSON.stringify(args)).not.toContain("4242 4242");
    expect(args.p_changes).toMatchObject({ reason: "Wrong card [MASKED]" });
  });

  it("maps database refusals to safe errors", async () => {
    const c = clients(baseTask, { error: { message: "approval requires an approver" } });
    await expect(
      performTaskAction({
        ...c,
        userId: USER,
        memberships: [member("caregiver")],
        taskId: TASK,
        body: { action: "approve", acknowledged: true },
      }),
    ).rejects.toMatchObject({ code: "database_failed" });
    expect(mapRpcError({ message: "forbidden" }).code).toBe("forbidden");
    expect(mapRpcError({ message: "invalid status transition draft to confirmed" }).code).toBe(
      "invalid_state",
    );
    expect(
      mapRpcError({
        message: "only low-risk drafts can be confirmed without awaiting confirmation",
      }).code,
    ).toBe("invalid_state");
    expect(mapRpcError({ message: "reason_required" }).code).toBe("reason_required");
  });
});

describe("editTask", () => {
  const draft = {
    ...baseTask,
    status: "draft",
    category: "reminder",
    risk_level: "low",
    title: "Buy rice",
    location: null,
    notes: null,
    due_at: null,
  };

  it("recomputes risk on the server and records edited fields", async () => {
    const c = clients(draft, { data: { id: TASK, status: "draft" } });
    const r = await editTask({
      ...c,
      userId: USER,
      memberships: [member("caregiver")],
      taskId: TASK,
      body: { changes: { title: "Pay the electricity bill" } },
    });
    expect(r.riskLevel).toBe("high");
    const args = c.rpcCalls[0]!.args;
    expect(args.p_action).toBe("edit");
    expect(args.p_changes).toMatchObject({ title: "Pay the electricity bill", risk_level: "high" });
    expect(args.p_payload).toMatchObject({
      action: "edit",
      edited_fields: ["title"],
      previous_risk_level: "low",
      risk_level: "high",
    });
  });

  it("refuses edits to confirmed tasks and edits by elders", async () => {
    await expect(
      editTask({
        ...clients({ ...draft, status: "confirmed" }),
        userId: USER,
        memberships: [member("caregiver")],
        taskId: TASK,
        body: { changes: { title: "x" } },
      }),
    ).rejects.toMatchObject({ code: "invalid_state" });
    await expect(
      editTask({
        ...clients(draft),
        userId: USER,
        memberships: [member("elder")],
        taskId: TASK,
        body: { changes: { title: "x" } },
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("rejects an edit that changes nothing", async () => {
    await expect(
      editTask({
        ...clients(draft),
        userId: USER,
        memberships: [member("caregiver")],
        taskId: TASK,
        body: { changes: { title: "Buy rice" } },
      }),
    ).rejects.toMatchObject({ code: "nothing_changed" });
  });

  it("masks sensitive values before persistence", async () => {
    const c = clients(draft, { data: { id: TASK, status: "draft" } });
    await editTask({
      ...c,
      userId: USER,
      memberships: [member("caregiver")],
      taskId: TASK,
      body: { changes: { notes: "password: hunter22" } },
    });
    expect(JSON.stringify(c.rpcCalls[0]!.args)).not.toContain("hunter22");
  });
});

describe("request schemas", () => {
  it("approval must be explicitly acknowledged and cannot carry a status or approver", () => {
    expect(taskActionBodySchema.safeParse({ action: "approve" }).success).toBe(false);
    expect(taskActionBodySchema.safeParse({ action: "approve", acknowledged: false }).success).toBe(
      false,
    );
    expect(taskActionBodySchema.safeParse({ action: "approve", acknowledged: true }).success).toBe(
      true,
    );
    expect(
      taskActionBodySchema.safeParse({ action: "approve", acknowledged: true, status: "confirmed" })
        .success,
    ).toBe(false);
    expect(
      taskActionBodySchema.safeParse({ action: "approve", acknowledged: true, approvedBy: USER })
        .success,
    ).toBe(false);
    expect(taskActionBodySchema.safeParse({ action: "pay" }).success).toBe(false);
  });
  it("cancel requires a reason", () => {
    expect(taskActionBodySchema.safeParse({ action: "cancel" }).success).toBe(false);
    expect(taskActionBodySchema.safeParse({ action: "cancel", reason: " " }).success).toBe(false);
    expect(
      taskActionBodySchema.safeParse({ action: "cancel", reason: "Done already" }).success,
    ).toBe(true);
  });
  it("edit uses taskUpdateSchema and cannot change status or risk", () => {
    expect(editTaskBodySchema.safeParse({ changes: { title: "x" } }).success).toBe(true);
    expect(editTaskBodySchema.safeParse({ changes: { status: "confirmed" } }).success).toBe(false);
    expect(editTaskBodySchema.safeParse({ changes: { riskLevel: "low" } }).success).toBe(false);
    expect(editTaskBodySchema.safeParse({ changes: {} }).success).toBe(false);
  });
});
