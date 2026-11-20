import { LOW_CONFIDENCE_THRESHOLD, isLowConfidence } from "@/lib/ocr/confidence";
import { normalizeDue } from "@/lib/datetime";
import { classifyRisk, detectCautions, mapCategory } from "@/lib/risk-rules";
import { maskSensitive } from "@/lib/safety/mask-sensitive";
import {
  LLM_TASK_JSON_SCHEMA,
  extractedTaskSchema,
  llmTaskOutputSchema,
  type ExtractedTask,
  type ExtractionWarning,
} from "@/lib/task-schema";
import { PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import { LlmError, type LlmAdapter, type LlmUsage } from "./types";

export type ExtractionStatus = "ok" | "needs_review" | "failed" | "unavailable";

export interface ExtractionMeta {
  provider: string | null;
  modelId: string | null;
  promptVersion: string;
  /** Combined confidence (model and OCR, whichever is lower), or null. */
  confidence: number | null;
  usage: LlmUsage | null;
  responseMode: "json_schema" | "json_object" | null;
  imageAttached: boolean;
  failureCode: string | null;
  latencyMs: number;
}

export interface ExtractionResult {
  status: ExtractionStatus;
  task: ExtractedTask | null;
  warnings: ExtractionWarning[];
  meta: ExtractionMeta;
}

export interface ParseNoteInput {
  sourceType: "image" | "text";
  /** Note text. Already masked when stored, and masked again here. */
  text: string;
  ocrConfidence: number | null;
  image: { mimeType: string; load: () => Promise<Uint8Array | null> } | null;
  referenceDate: Date;
  timeZone: string;
}

/**
 * Decides whether the photo goes to the model. The photo cannot be masked, so it is sent only when
 * it adds value (OCR empty or low confidence) and no sensitive value was found in the OCR text.
 */
export function shouldAttachImage(input: {
  sourceType: "image" | "text";
  text: string;
  ocrConfidence: number | null;
  hasMaskedValues: boolean;
  imageTypeSupported: boolean;
  visionSupported: boolean;
}): boolean {
  if (input.sourceType !== "image") return false;
  if (!input.imageTypeSupported || !input.visionSupported) return false;
  if (input.hasMaskedValues) return false;
  return input.text.trim() === "" || isLowConfidence(input.ocrConfidence);
}

/** Parses model output that should be a bare JSON object; tolerates a stray code fence. */
export function parseJsonObject(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

const emptyMeta = (adapter: LlmAdapter | null, started: number): ExtractionMeta => ({
  provider: adapter?.provider ?? null,
  modelId: adapter?.modelId ?? null,
  promptVersion: PROMPT_VERSION,
  confidence: null,
  usage: null,
  responseMode: null,
  imageAttached: false,
  failureCode: null,
  latencyMs: Date.now() - started,
});

function failure(
  status: "failed" | "unavailable",
  warning: ExtractionWarning,
  meta: ExtractionMeta,
  code: string,
): ExtractionResult {
  return { status, task: null, warnings: [warning], meta: { ...meta, failureCode: code } };
}

/**
 * Turns a note into a draft-ready task. Never throws for provider or validation problems: on any
 * failure it returns `failed` or `unavailable` with no task, and the caller keeps the original note
 * and asks the user to fill in the fields.
 */
export async function extractTaskFromNote(
  adapter: LlmAdapter | null,
  input: ParseNoteInput,
): Promise<ExtractionResult> {
  const started = Date.now();
  const masked = maskSensitive(input.text);
  const hasText = masked.text.trim() !== "";

  if (!adapter) {
    return failure(
      "unavailable",
      "extraction_unavailable",
      emptyMeta(adapter, started),
      "not_configured",
    );
  }

  let image: { bytes: Uint8Array; mimeType: string } | undefined;
  let imageAttached = false;
  try {
    const visionSupported =
      input.image !== null && adapter.supportsImageType(input.image.mimeType)
        ? await adapter.supportsVision()
        : false;
    if (
      input.image &&
      shouldAttachImage({
        sourceType: input.sourceType,
        text: masked.text,
        ocrConfidence: input.ocrConfidence,
        hasMaskedValues: masked.kinds.length > 0 || masked.text.includes("[MASKED]"),
        imageTypeSupported: adapter.supportsImageType(input.image.mimeType),
        visionSupported,
      })
    ) {
      const bytes = await input.image.load();
      if (bytes) {
        image = { bytes, mimeType: input.image.mimeType };
        imageAttached = true;
      }
    }
  } catch {
    image = undefined;
    imageAttached = false;
  }

  if (!hasText && !image) {
    return failure("failed", "no_text", emptyMeta(adapter, started), "no_input");
  }

  let completion;
  try {
    completion = await adapter.completeJson({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt({
        text: masked.text,
        sourceType: input.sourceType,
        ocrConfidence: input.ocrConfidence,
        referenceDate: input.referenceDate,
        timeZone: input.timeZone,
        imageAttached,
      }),
      image,
      schemaName: "household_task",
      jsonSchema: LLM_TASK_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch (error) {
    const code = error instanceof LlmError ? error.code : "provider_error";
    return failure(
      "failed",
      "extraction_failed",
      { ...emptyMeta(adapter, started), imageAttached },
      code,
    );
  }

  const baseMeta: ExtractionMeta = {
    ...emptyMeta(adapter, started),
    usage: completion.usage,
    responseMode: completion.responseMode,
    imageAttached: completion.imageSent,
  };

  let llm;
  try {
    const parsed = llmTaskOutputSchema.safeParse(parseJsonObject(completion.content));
    if (!parsed.success) {
      return failure("failed", "extraction_failed", baseMeta, "schema_validation_failed");
    }
    llm = parsed.data;
  } catch {
    return failure("failed", "extraction_failed", baseMeta, "invalid_json");
  }

  // Mask again: the model might have echoed a sensitive value.
  const warnings = new Set<ExtractionWarning>();
  const clean = (value: string | null): string | null => {
    if (value === null) return null;
    const r = maskSensitive(value);
    if (r.kinds.length > 0) warnings.add("sensitive_masked");
    return r.text;
  };
  const title = clean(llm.title) ?? llm.title;
  const location = clean(llm.location);
  const assigneeSuggestion = clean(llm.assigneeSuggestion);
  const notes = clean(llm.notes);
  if (masked.kinds.length > 0) warnings.add("sensitive_masked");

  const fieldText = [title, notes, location, masked.text].filter(Boolean).join("\n");
  const mapping = mapCategory(fieldText, llm.category);
  if (mapping.adjusted) warnings.add("category_adjusted");

  const confidence =
    input.ocrConfidence === null ? llm.confidence : Math.min(llm.confidence, input.ocrConfidence);
  if (llm.confidence < LOW_CONFIDENCE_THRESHOLD) warnings.add("low_confidence");
  if (input.sourceType === "image" && isLowConfidence(input.ocrConfidence)) {
    warnings.add("low_ocr_confidence");
  }
  if (llm.uncertainFields.length > 0) warnings.add("uncertain_fields");

  const due = normalizeDue({
    date: llm.dueDate,
    time: llm.dueTime,
    timeZone: input.timeZone,
    referenceDate: input.referenceDate,
  });
  due.warnings.forEach((w) => warnings.add(w));

  const risk = classifyRisk({ category: mapping.category, text: fieldText, confidence });
  if (detectCautions(fieldText).possibleFraud) warnings.add("possible_fraud");

  const warningList = [...warnings];
  const taskCandidate = {
    title,
    category: mapping.category,
    dueAt: due.dueAt,
    dueDate: due.dueDate,
    dueTime: due.dueTime,
    location,
    assigneeSuggestion,
    notes,
    confidence,
    uncertainFields: llm.uncertainFields,
    riskLevel: risk.level,
    riskReasons: risk.reasons,
    warnings: warningList,
    needsReview: warningList.length > 0,
  };
  const task = extractedTaskSchema.safeParse(taskCandidate);
  if (!task.success) {
    return failure("failed", "extraction_failed", baseMeta, "normalized_validation_failed");
  }

  return {
    status: warningList.length > 0 ? "needs_review" : "ok",
    task: task.data,
    warnings: warningList,
    meta: { ...baseMeta, confidence, latencyMs: Date.now() - started },
  };
}

/** Matches a suggested name to a household member by display name. Returns the member id or null. */
export function matchAssignee(
  suggestion: string | null,
  members: { id: string; display_name: string }[],
): string | null {
  if (!suggestion) return null;
  const needle = suggestion.trim().toLowerCase();
  if (!needle) return null;
  const exact = members.filter((m) => m.display_name.trim().toLowerCase() === needle);
  if (exact.length === 1) return exact[0]!.id;
  const partial = members.filter((m) => {
    const name = m.display_name.trim().toLowerCase();
    return name.includes(needle) || needle.includes(name);
  });
  return partial.length === 1 ? partial[0]!.id : null;
}
