import { toAuditRow } from "@/lib/audit";
import type { TaskAction } from "./transitions";
import { ACTION_EVENT_TYPE } from "./transitions";

export interface TaskActionEventInput {
  action: TaskAction;
  householdId: string;
  taskId: string;
  noteId: string | null;
  /** Auth user ID of the person acting. */
  actorId: string;
  /** Extra facts for the timeline. Free text is masked by `toAuditRow`. */
  details?: Record<string, unknown>;
}

/**
 * Builds the audit event for a task action. The database function adds `from_status` and
 * `to_status` itself and takes the event type from the action, so these values cannot be forged.
 * Approval payloads state that no external action was executed.
 */
export function buildTaskActionEvent(input: TaskActionEventInput) {
  const extra: Record<string, unknown> =
    input.action === "approve" ? { executed_external_action: false } : {};
  return toAuditRow({
    householdId: input.householdId,
    taskId: input.taskId,
    noteId: input.noteId,
    actorId: input.actorId,
    eventType: ACTION_EVENT_TYPE[input.action],
    payload: { action: input.action, ...input.details, ...extra },
  });
}
