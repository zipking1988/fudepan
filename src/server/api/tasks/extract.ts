import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { toAuditRow } from "@/lib/audit";
import type { LlmAdapter } from "@/lib/ai";
import { extractTaskFromNote, matchAssignee, type ExtractionResult } from "@/lib/ai/parser";
import type { TaskCategory, RiskLevel } from "@/lib/schemas/task";
import type { ExtractionField } from "@/lib/task-schema";
import { NOTE_IMAGES_BUCKET } from "@/server/notes/create-note";
import { TaskServiceError } from "./errors";

/** What the browser receives. Contains masked task fields only, never raw OCR text or images. */
export interface ExtractionResponse {
  extractionId: string;
  status: ExtractionResult["status"];
  confidence: number | null;
  warnings: ExtractionResult["warnings"];
  task: {
    title: string;
    category: TaskCategory;
    dueDate: string | null;
    dueTime: string | null;
    location: string | null;
    assigneeSuggestion: string | null;
    assigneeId: string | null;
    notes: string | null;
    riskLevel: RiskLevel;
    riskReasons: string[];
    uncertainFields: ExtractionField[];
  } | null;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
};

/** Audit payload for an extraction. No raw OCR text, no image, only masked parsed fields. */
export function buildExtractionAuditPayload(result: ExtractionResult) {
  const { meta, task } = result;
  return {
    status: result.status,
    provider: meta.provider,
    model: meta.modelId,
    prompt_version: meta.promptVersion,
    confidence: meta.confidence,
    usage: meta.usage && {
      prompt_tokens: meta.usage.promptTokens,
      completion_tokens: meta.usage.completionTokens,
      total_tokens: meta.usage.totalTokens,
      reasoning_tokens: meta.usage.reasoningTokens,
    },
    response_mode: meta.responseMode,
    image_attached: meta.imageAttached,
    failure_code: meta.failureCode,
    latency_ms: meta.latencyMs,
    warnings: result.warnings,
    parsed: task && {
      title: task.title,
      category: task.category,
      due_at: task.dueAt,
      due_date: task.dueDate,
      due_time: task.dueTime,
      location: task.location,
      assignee_suggestion: task.assigneeSuggestion,
      notes: task.notes,
      risk_level: task.riskLevel,
    },
  };
}

export async function extractTaskForNote(args: {
  supabase: SupabaseClient;
  userId: string;
  householdId: string;
  noteId: string;
  timeZone: string;
  llm: LlmAdapter | null;
  requestId: string;
  now?: Date;
  log?: (entry: Record<string, unknown>) => void;
}): Promise<ExtractionResponse> {
  const { supabase } = args;

  // RLS limits this to notes in the user's household.
  const { data: note } = await supabase
    .from("notes")
    .select("id, source_type, text_content, image_path, ocr_text, ocr_confidence")
    .eq("id", args.noteId)
    .maybeSingle();
  if (!note) throw new TaskServiceError("note_not_found", "Note not found");

  const { data: members } = await supabase.from("members").select("id, display_name");

  const isImage = note.source_type === "image";
  const imagePath = (note.image_path as string | null) ?? null;
  const ext = imagePath?.split(".").pop()?.toLowerCase() ?? "";

  const result = await extractTaskFromNote(args.llm, {
    sourceType: isImage ? "image" : "text",
    text: ((isImage ? note.ocr_text : note.text_content) as string | null) ?? "",
    ocrConfidence: note.ocr_confidence === null ? null : Number(note.ocr_confidence),
    image:
      isImage && imagePath
        ? {
            mimeType: MIME_BY_EXT[ext] ?? "application/octet-stream",
            load: async () => {
              const { data, error } = await supabase.storage
                .from(NOTE_IMAGES_BUCKET)
                .download(imagePath);
              return error || !data ? null : new Uint8Array(await data.arrayBuffer());
            },
          }
        : null,
    referenceDate: args.now ?? new Date(),
    timeZone: args.timeZone,
  });

  // Every extraction attempt is audited, including failures. Metadata only.
  const extractionId = randomUUID();
  const { error } = await supabase.from("audit_events").insert(
    toAuditRow({
      id: extractionId,
      householdId: args.householdId,
      taskId: null,
      noteId: args.noteId,
      actorId: args.userId,
      eventType: "task_extracted",
      payload: buildExtractionAuditPayload(result),
    }),
  );
  if (error) throw new TaskServiceError("database_failed", "Could not write audit event");

  args.log?.({
    requestId: args.requestId,
    householdId: args.householdId,
    provider: result.meta.provider,
    model: result.meta.modelId,
    outcome: result.meta.failureCode ?? result.status,
    latencyMs: result.meta.latencyMs,
    totalTokens: result.meta.usage?.totalTokens ?? null,
  });

  const task = result.task;
  return {
    extractionId,
    status: result.status,
    confidence: result.meta.confidence,
    warnings: result.warnings,
    task: task && {
      title: task.title,
      category: task.category,
      dueDate: task.dueDate,
      dueTime: task.dueTime,
      location: task.location,
      assigneeSuggestion: task.assigneeSuggestion,
      assigneeId: matchAssignee(
        task.assigneeSuggestion,
        (members ?? []) as { id: string; display_name: string }[],
      ),
      notes: task.notes,
      riskLevel: task.riskLevel,
      riskReasons: task.riskReasons,
      uncertainFields: task.uncertainFields,
    },
  };
}
