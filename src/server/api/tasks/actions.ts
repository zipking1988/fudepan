import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Membership } from "@/server/session";
import { maskSensitive } from "@/lib/safety/mask-sensitive";
import type { RiskLevel, TaskStatus } from "@/lib/schemas/task";
import type { TaskActionBody } from "@/lib/schemas/workflow";
import { buildTaskActionEvent } from "@/lib/workflow/task-events";
import { checkTaskAction, type TaskAction } from "@/lib/workflow/transitions";
import { TaskServiceError, mapRpcError } from "./errors";

export interface TaskActionResult {
  id: string;
  status: TaskStatus;
}

/**
 * Applies claim, assign, submit, approve, reject, complete or cancel.
 *
 * 1. Load the task through the user's RLS client (not visible means not found).
 * 2. Check the user's role in the task's household and the transition rules.
 * 3. Call the service-role-only database function with the actor's ID. It re-checks the role and
 *    the transition, updates the task and writes the audit event in one transaction.
 */
export async function performTaskAction(args: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  memberships: Membership[];
  taskId: string;
  body: TaskActionBody;
}): Promise<TaskActionResult> {
  const { data: task } = await args.supabase
    .from("tasks")
    .select("id, household_id, note_id, status, risk_level, assignee_id")
    .eq("id", args.taskId)
    .maybeSingle();
  if (!task) throw new TaskServiceError("task_not_found", "Task not found");

  const membership = args.memberships.find((m) => m.householdId === task.household_id);
  if (!membership) throw new TaskServiceError("forbidden", "Not allowed");

  const action: TaskAction = args.body.action;
  const check = checkTaskAction(action, {
    role: membership.role,
    memberId: membership.memberId,
    task: {
      status: task.status as TaskStatus,
      riskLevel: task.risk_level as RiskLevel,
      assigneeId: (task.assignee_id as string | null) ?? null,
    },
  });
  if (!check.ok) {
    throw new TaskServiceError(
      check.reason,
      check.reason === "forbidden" ? "Not allowed" : "Not allowed in this state",
    );
  }

  const changes: Record<string, unknown> = {};
  const details: Record<string, unknown> = {};
  if (args.body.action === "assign") {
    changes.assignee_id = args.body.assigneeId;
    details.assignee_id = args.body.assigneeId;
    details.previous_assignee_id = task.assignee_id;
  }
  if (args.body.action === "claim") details.assignee_id = membership.memberId;
  if (args.body.action === "approve") {
    details.risk_level = task.risk_level;
    details.approved_by_member_id = membership.memberId;
  }
  if (args.body.action === "reject" || args.body.action === "cancel") {
    const reason = args.body.reason ? maskSensitive(args.body.reason).text : undefined;
    if (args.body.action === "cancel" && !reason)
      throw new TaskServiceError("reason_required", "A reason is required");
    if (reason) {
      changes.reason = reason;
      details.reason = reason;
    }
  }

  const event = buildTaskActionEvent({
    action,
    householdId: task.household_id as string,
    taskId: task.id as string,
    noteId: (task.note_id as string | null) ?? null,
    actorId: args.userId,
    details,
  });

  const { data, error } = await args.admin.rpc("apply_task_action", {
    p_actor: args.userId,
    p_task_id: task.id,
    p_action: action,
    p_changes: changes,
    p_payload: event.payload,
  });
  if (error) throw mapRpcError(error);
  const result = data as { id?: string; status?: TaskStatus } | null;
  if (!result?.id || !result.status)
    throw new TaskServiceError("database_failed", "Unexpected response");
  return { id: result.id, status: result.status };
}
