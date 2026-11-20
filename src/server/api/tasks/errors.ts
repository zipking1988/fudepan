import "server-only";

export type TaskServiceErrorCode =
  | "note_not_found"
  | "task_not_found"
  | "invalid_extraction"
  | "invalid_assignee"
  | "invalid_state"
  | "invalid_task"
  | "reason_required"
  | "nothing_changed"
  | "forbidden"
  | "database_failed";

export class TaskServiceError extends Error {
  constructor(
    public readonly code: TaskServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TaskServiceError";
  }
}

interface RpcError {
  code?: string;
  message?: string;
}

/** Maps a database error to a service error without exposing database details. */
export function mapRpcError(error: RpcError): TaskServiceError {
  const message = error.message ?? "";
  if (message === "forbidden" || error.code === "42501")
    return new TaskServiceError("forbidden", "Not allowed");
  if (message === "task_not_found") return new TaskServiceError("task_not_found", "Task not found");
  if (
    message === "invalid_state" ||
    /invalid status transition|task is closed|confirmed tasks cannot be edited|awaiting confirmation/.test(
      message,
    )
  ) {
    return new TaskServiceError("invalid_state", "Not allowed in this state");
  }
  if (message === "invalid_assignee" || error.code === "23503")
    return new TaskServiceError("invalid_assignee", "Invalid assignee");
  if (message === "reason_required")
    return new TaskServiceError("reason_required", "A reason is required");
  if (error.code === "23514") return new TaskServiceError("invalid_task", "Invalid task");
  return new TaskServiceError("database_failed", "Database error");
}
