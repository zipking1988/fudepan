import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizePayload } from "@/lib/audit";
import { classifyRisk } from "@/lib/risk-rules";
import { maskSensitive } from "@/lib/safety/mask-sensitive";
import type { TaskCategory, RiskLevel, TaskStatus } from "@/lib/schemas/task";
import type { EditTaskBody } from "@/lib/schemas/workflow";
import { buildTaskActionEvent } from "@/lib/workflow/task-events";
import { checkTaskAction } from "@/lib/workflow/transitions";
import type { Membership } from "@/server/session";
import { TaskServiceError, mapRpcError } from "./errors";

const mask = (v: string | null | undefined) => (v ? maskSensitive(v).text : v);

/**
 * Edits a saved task (draft or awaiting approval) with the Phase 1 `taskUpdateSchema` body.
 * Text is masked, risk is recomputed on the server, and the change is audited in the same
 * transaction as the update. Confirmed tasks cannot be edited.
 */
export async function editTask(args: {
  supabase: SupabaseClient;
  admin: SupabaseClient;
  userId: string;
  memberships: Membership[];
  taskId: string;
  body: EditTaskBody;
}): Promise<{ id: string; status: TaskStatus; riskLevel: RiskLevel }> {
  const { data: task } = await args.supabase
    .from("tasks")
    .select(
      "id, household_id, note_id, status, risk_level, category, title, location, notes, due_at, assignee_id",
    )
    .eq("id", args.taskId)
    .maybeSingle();
  if (!task) throw new TaskServiceError("task_not_found", "Task not found");

  const membership = args.memberships.find((m) => m.householdId === task.household_id);
  if (!membership) throw new TaskServiceError("forbidden", "Not allowed");
  const check = checkTaskAction("edit", {
    role: membership.role,
    memberId: membership.memberId,
    task: {
      status: task.status as TaskStatus,
      riskLevel: task.risk_level as RiskLevel,
      assigneeId: task.assignee_id,
    },
  });
  if (!check.ok) throw new TaskServiceError(check.reason, "Not allowed");

  const input = args.body.changes;
  const next = {
    title: input.title !== undefined ? mask(input.title)! : (task.title as string),
    category: (input.category ?? task.category) as TaskCategory,
    location:
      input.location !== undefined
        ? (mask(input.location) ?? null)
        : (task.location as string | null),
    notes: input.notes !== undefined ? (mask(input.notes) ?? null) : (task.notes as string | null),
    dueAt: input.dueAt !== undefined ? input.dueAt : (task.due_at as string | null),
    assigneeId:
      input.assigneeId !== undefined ? input.assigneeId : (task.assignee_id as string | null),
  };

  const changes: Record<string, unknown> = {};
  const edited: string[] = [];
  const same = (x: unknown, y: unknown) => (x ?? null) === (y ?? null);
  const record = (column: string, value: unknown, previous: unknown) => {
    if (same(value, previous)) return;
    changes[column] = value;
    edited.push(column);
  };
  record("title", next.title, task.title);
  record("category", next.category, task.category);
  record("location", next.location, task.location);
  record("notes", next.notes, task.notes);
  if (input.dueAt !== undefined) {
    const toMs = (v: unknown) => (typeof v === "string" ? new Date(v).getTime() : null);
    record("due_at", next.dueAt, toMs(next.dueAt) === toMs(task.due_at) ? next.dueAt : task.due_at);
  }
  record("assignee_id", next.assigneeId, task.assignee_id);
  if (edited.length === 0) throw new TaskServiceError("nothing_changed", "Nothing was changed");

  // Risk is recomputed from the final text. An edit is a human decision, so confidence is "manual".
  const { data: note } = task.note_id
    ? await args.supabase
        .from("notes")
        .select("text_content, ocr_text")
        .eq("id", task.note_id)
        .maybeSingle()
    : { data: null };
  const noteText = ((note?.ocr_text ?? note?.text_content) as string | null) ?? "";
  const risk = classifyRisk({
    category: next.category,
    text: [next.title, next.notes, next.location, noteText].filter(Boolean).join("\n"),
    confidence: "manual",
  });
  changes.risk_level = risk.level;
  changes.needs_review = args.body.timeDefaulted === true;

  const event = buildTaskActionEvent({
    action: "edit",
    householdId: task.household_id as string,
    taskId: task.id as string,
    noteId: (task.note_id as string | null) ?? null,
    actorId: args.userId,
    details: sanitizePayload({
      edited_fields: edited,
      risk_level: risk.level,
      previous_risk_level: task.risk_level,
      changes: Object.fromEntries(
        Object.entries(changes).filter(([k]) => !["risk_level", "needs_review"].includes(k)),
      ),
    }),
  });

  const { data, error } = await args.admin.rpc("apply_task_action", {
    p_actor: args.userId,
    p_task_id: task.id,
    p_action: "edit",
    p_changes: changes,
    p_payload: event.payload,
  });
  if (error) throw mapRpcError(error);
  const result = data as { id?: string; status?: TaskStatus } | null;
  if (!result?.id || !result.status)
    throw new TaskServiceError("database_failed", "Unexpected response");
  return { id: result.id, status: result.status, riskLevel: risk.level };
}
