import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizePayload } from "@/lib/audit";
import type { Role } from "@/lib/permissions";
import { hasPermission } from "@/lib/permissions";
import { normalizeDue, resolveTimeZone } from "@/lib/datetime";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/ocr/confidence";
import { classifyRisk } from "@/lib/risk-rules";
import { maskSensitive } from "@/lib/safety/mask-sensitive";
import { DRAFT_STATUS, type DraftTaskInput } from "@/lib/task-schema";
import type { RiskLevel } from "@/lib/schemas/task";
import { TaskServiceError, mapRpcError } from "./errors";

export interface DraftTaskResult {
  taskId: string;
  status: typeof DRAFT_STATUS;
  riskLevel: RiskLevel;
  needsReview: boolean;
}

interface ExtractionRecord {
  confidence: number | null;
  status: string | null;
  model: string | null;
  promptVersion: string | null;
  parsed: Record<string, unknown> | null;
}

async function loadExtraction(
  supabase: SupabaseClient,
  extractionId: string,
  noteId: string,
): Promise<ExtractionRecord> {
  const { data } = await supabase
    .from("audit_events")
    .select("payload")
    .eq("id", extractionId)
    .eq("note_id", noteId)
    .eq("event_type", "task_extracted")
    .maybeSingle();
  if (!data) throw new TaskServiceError("invalid_extraction", "Extraction not found for this note");
  const p = data.payload as Record<string, unknown>;
  return {
    confidence: typeof p.confidence === "number" ? p.confidence : null,
    status: typeof p.status === "string" ? p.status : null,
    model: typeof p.model === "string" ? p.model : null,
    promptVersion: typeof p.prompt_version === "string" ? p.prompt_version : null,
    parsed: (p.parsed as Record<string, unknown> | null) ?? null,
  };
}

/**
 * Saves a draft task and its audit event in one transaction (Postgres function). The status is
 * always `draft`: nothing is confirmed, approved, or executed here. Risk is computed on the server.
 */
export async function createDraftTask(args: {
  /** Client acting as the signed-in user (RLS applies). Used for reads. */
  supabase: SupabaseClient;
  /** Service-role client. Used only for the draft-creation function. */
  admin: SupabaseClient;
  role: Role;
  userId: string;
  householdId: string;
  input: DraftTaskInput;
  envTimeZone?: string | null;
  now?: Date;
}): Promise<DraftTaskResult> {
  const { supabase, input } = args;
  if (!hasPermission(args.role, "task.draft"))
    throw new TaskServiceError("forbidden", "Not allowed");

  const { data: note } = await supabase
    .from("notes")
    .select("id, text_content, ocr_text")
    .eq("id", input.noteId)
    .maybeSingle();
  if (!note) throw new TaskServiceError("note_not_found", "Note not found");

  const extraction = input.extractionId
    ? await loadExtraction(supabase, input.extractionId, input.noteId)
    : null;

  // Mask before persistence, even for text a person typed.
  const title = maskSensitive(input.title).text;
  const location = input.location ? maskSensitive(input.location).text : null;
  const notes = input.notes ? maskSensitive(input.notes).text : null;

  const timeZone = resolveTimeZone(input.timeZone, args.envTimeZone);
  const due = normalizeDue({
    date: input.dueDate,
    time: input.dueTime,
    timeZone,
    referenceDate: args.now ?? new Date(),
  });

  const noteText = ((note.ocr_text ?? note.text_content) as string | null) ?? "";
  const risk = classifyRisk({
    category: input.category,
    text: [title, notes, location, noteText].filter(Boolean).join("\n"),
    // An AI extraction keeps its confidence. No extraction (or a failed one) means a person wrote it.
    confidence:
      extraction && extraction.status !== "failed" && extraction.status !== "unavailable"
        ? extraction.confidence
        : "manual",
  });

  const lowConfidence =
    extraction !== null &&
    extraction.status === "needs_review" &&
    (extraction.confidence === null || extraction.confidence < LOW_CONFIDENCE_THRESHOLD);
  const needsReview = due.timeDefaulted || lowConfidence || extraction?.status === "needs_review";

  const before = extraction?.parsed;
  const after: Record<string, unknown> = {
    title,
    category: input.category,
    due_date: due.dueDate,
    due_time: due.dueTime,
    location,
    notes,
  };
  const beforeMap: Record<string, unknown> = before
    ? {
        title: before.title,
        category: before.category,
        due_date: before.due_date,
        due_time: before.due_time,
        location: before.location,
        notes: before.notes,
      }
    : {};
  const editedFields = before
    ? Object.keys(after).filter((k) => (after[k] ?? null) !== (beforeMap[k] ?? null))
    : [];

  const { data, error } = await args.admin.rpc("create_draft_task", {
    p_actor: args.userId,
    p_household_id: args.householdId,
    p_note_id: input.noteId,
    p_title: title,
    p_category: input.category,
    p_risk_level: risk.level,
    p_due_at: due.dueAt,
    p_location: location,
    p_assignee_id: input.assigneeId,
    p_notes: notes,
    p_needs_review: needsReview,
    p_audit_payload: sanitizePayload({
      extraction_id: input.extractionId,
      model: extraction?.model ?? null,
      prompt_version: extraction?.promptVersion ?? null,
      extraction_confidence: extraction?.confidence ?? null,
      source: extraction ? "ai_extraction_reviewed" : "manual",
      edited_fields: editedFields,
      final: { ...after, due_at: due.dueAt, assignee_id: input.assigneeId },
      risk_level: risk.level,
      risk_reasons: risk.reasons,
      needs_review: needsReview,
      time_zone: timeZone,
    }),
  });

  if (error) throw mapRpcError(error);
  if (typeof data !== "string")
    throw new TaskServiceError("database_failed", "Could not save draft task");

  return { taskId: data, status: DRAFT_STATUS, riskLevel: risk.level, needsReview };
}
