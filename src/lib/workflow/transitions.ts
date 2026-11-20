import { isStaff, type Role } from "@/lib/permissions";
import type { AuditEventType } from "@/lib/schemas/audit";
import type { RiskLevel, TaskStatus } from "@/lib/schemas/task";

/**
 * Task workflow rules. The database repeats these rules (trigger `enforce_task_workflow` and
 * function `apply_task_action`), so a bug here cannot let a task skip approval.
 *
 *   draft -> awaiting_confirmation -> confirmed -> completed
 *   draft -> confirmed            (only when the task is low risk)
 *   awaiting_confirmation -> rejected
 *   draft | awaiting_confirmation | confirmed -> cancelled
 */
export const TASK_ACTIONS = [
  "claim",
  "assign",
  "edit",
  "submit",
  "approve",
  "reject",
  "complete",
  "cancel",
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

export const OPEN_STATUSES: readonly TaskStatus[] = ["draft", "awaiting_confirmation", "confirmed"];
export const CLOSED_STATUSES: readonly TaskStatus[] = ["completed", "cancelled", "rejected"];

const ALLOWED_TRANSITIONS: readonly (readonly [TaskStatus, TaskStatus])[] = [
  ["draft", "awaiting_confirmation"],
  ["draft", "confirmed"],
  ["draft", "cancelled"],
  ["awaiting_confirmation", "confirmed"],
  ["awaiting_confirmation", "rejected"],
  ["awaiting_confirmation", "cancelled"],
  ["confirmed", "completed"],
  ["confirmed", "cancelled"],
];

export function isAllowedTransition(from: TaskStatus, to: TaskStatus): boolean {
  return ALLOWED_TRANSITIONS.some(([a, b]) => a === from && b === to);
}

/** Only a low-risk draft can be confirmed without waiting in awaiting_confirmation. */
export function canConfirmFrom(from: TaskStatus, risk: RiskLevel): boolean {
  if (from === "awaiting_confirmation") return true;
  return from === "draft" && risk === "low";
}

/** Audit event type written for each action. Claims, assignments and edits use task_updated. */
export const ACTION_EVENT_TYPE: Record<TaskAction, AuditEventType> = {
  claim: "task_updated",
  assign: "task_updated",
  edit: "task_updated",
  submit: "task_confirmation_requested",
  approve: "task_approved",
  reject: "task_rejected",
  complete: "task_completed",
  cancel: "task_cancelled",
};

export interface ActionContext {
  role: Role;
  memberId: string;
  task: { status: TaskStatus; riskLevel: RiskLevel; assigneeId: string | null };
}

export type ActionCheck =
  { ok: true; toStatus: TaskStatus } | { ok: false; reason: "forbidden" | "invalid_state" };

const denied = (reason: "forbidden" | "invalid_state"): ActionCheck => ({ ok: false, reason });

export function checkTaskAction(action: TaskAction, ctx: ActionContext): ActionCheck {
  const { role, task } = ctx;
  const staff = isStaff(role);
  const status = task.status;

  if (action !== "complete" && !staff) return denied("forbidden");

  switch (action) {
    case "claim":
      return OPEN_STATUSES.includes(status) && task.assigneeId === null
        ? { ok: true, toStatus: status }
        : denied("invalid_state");
    case "assign":
      return OPEN_STATUSES.includes(status)
        ? { ok: true, toStatus: status }
        : denied("invalid_state");
    case "edit":
      return status === "draft" || status === "awaiting_confirmation"
        ? { ok: true, toStatus: status }
        : denied("invalid_state");
    case "submit":
      return status === "draft"
        ? { ok: true, toStatus: "awaiting_confirmation" }
        : denied("invalid_state");
    case "approve":
      return canConfirmFrom(status, task.riskLevel) && status !== "confirmed"
        ? { ok: true, toStatus: "confirmed" }
        : denied("invalid_state");
    case "reject":
      return status === "awaiting_confirmation"
        ? { ok: true, toStatus: "rejected" }
        : denied("invalid_state");
    case "complete":
      if (status !== "confirmed") return denied("invalid_state");
      return staff || task.assigneeId === ctx.memberId
        ? { ok: true, toStatus: "completed" }
        : denied("forbidden");
    case "cancel":
      return OPEN_STATUSES.includes(status)
        ? { ok: true, toStatus: "cancelled" }
        : denied("invalid_state");
  }
}

/** Actions the current user may take now. Used to decide which buttons to show. */
export function availableActions(ctx: ActionContext): TaskAction[] {
  return TASK_ACTIONS.filter((action) => {
    if (action === "claim" && ctx.task.assigneeId !== null) return false;
    return checkTaskAction(action, ctx).ok;
  });
}
