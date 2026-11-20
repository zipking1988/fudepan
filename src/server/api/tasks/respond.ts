import "server-only";
import { jsonError } from "@/server/api/http";
import { TaskServiceError } from "./errors";

const MESSAGES: Record<TaskServiceError["code"], [number, string]> = {
  note_not_found: [404, "We could not find that note."],
  task_not_found: [404, "We could not find that task."],
  invalid_extraction: [400, "Please read the note again and try again."],
  invalid_assignee: [400, "Please choose someone from your household."],
  invalid_state: [409, "This task cannot be changed that way right now."],
  invalid_task: [400, "Please check the task details and try again."],
  reason_required: [400, "Please give a reason."],
  nothing_changed: [400, "Nothing was changed."],
  forbidden: [403, "You do not have permission to do that."],
  database_failed: [500, "We could not save that. Please try again."],
};

/** Converts a service error into a plain-language JSON response. */
export function taskErrorResponse(error: unknown, requestId: string) {
  if (error instanceof TaskServiceError) {
    const [status, message] = MESSAGES[error.code];
    if (status >= 500) console.error("[tasks]", JSON.stringify({ requestId, code: error.code }));
    return jsonError(status, error.code, message);
  }
  console.error("[tasks]", JSON.stringify({ requestId, code: "unexpected" }));
  return jsonError(500, "unexpected", "Something went wrong. Please try again.");
}
