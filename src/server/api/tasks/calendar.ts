import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toAuditRow } from "@/lib/audit";
import { buildTaskIcs, icsFileName } from "@/lib/calendar/ics";
import { t } from "@/lib/i18n/messages";
import type { TaskCategory } from "@/lib/schemas/task";
import type { Membership } from "@/server/session";
import { TaskServiceError } from "./errors";

export type CalendarExportErrorCode = "not_confirmed" | "no_due_date";

export class CalendarExportError extends Error {
  constructor(public readonly code: CalendarExportErrorCode) {
    super(code);
    this.name = "CalendarExportError";
  }
}

/**
 * Exports a confirmed task as an .ics file. Any member of the task's household may export it to
 * their own calendar. An audit event is written first; if it cannot be written, nothing is exported.
 */
export async function exportTaskToCalendar(args: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  memberships: Membership[];
  taskId: string;
  origin: string;
  now?: Date;
}): Promise<{ body: string; fileName: string }> {
  // RLS: tasks outside the user's households are invisible.
  const { data: task } = await args.supabase
    .from("tasks")
    .select("id, household_id, note_id, title, category, status, due_at, location")
    .eq("id", args.taskId)
    .maybeSingle();
  if (!task) throw new TaskServiceError("task_not_found", "Task not found");
  if (!args.memberships.some((m) => m.householdId === task.household_id)) {
    throw new TaskServiceError("forbidden", "Not allowed");
  }
  if (task.status !== "confirmed") throw new CalendarExportError("not_confirmed");
  if (!task.due_at) throw new CalendarExportError("no_due_date");

  const body = buildTaskIcs({
    taskId: task.id as string,
    title: task.title as string,
    categoryLabel: t.review.categories[task.category as TaskCategory],
    dueAt: task.due_at as string,
    location: (task.location as string | null) ?? null,
    taskUrl: `${args.origin.replace(/\/+$/, "")}/tasks/${task.id as string}`,
    now: args.now,
  });

  // Service role is used only for this insert, after membership was checked above.
  const { error } = await args.admin.from("audit_events").insert(
    toAuditRow({
      householdId: task.household_id as string,
      taskId: task.id as string,
      noteId: (task.note_id as string | null) ?? null,
      actorId: args.userId,
      eventType: "calendar_event_created",
      payload: { method: "ics_download", provider: "none", due_at: task.due_at },
    }),
  );
  if (error) throw new TaskServiceError("database_failed", "Could not write audit event");

  return { body, fileName: icsFileName(task.title as string) };
}
