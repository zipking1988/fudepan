import { z } from "zod";
import { isRealDate, isValidTime } from "@/lib/datetime";
import { riskLevelSchema, taskCategorySchema } from "@/lib/schemas/task";

/**
 * Schemas for AI task extraction. Every model response must pass `llmTaskOutputSchema` before use.
 * All objects are strict: unknown keys (for example an "executePayment" action) are rejected.
 * Nothing here can express an executable action, and new tasks are always drafts.
 */

export const EXTRACTION_FIELDS = [
  "title",
  "category",
  "dueDate",
  "dueTime",
  "location",
  "assigneeSuggestion",
  "notes",
] as const;
export type ExtractionField = (typeof EXTRACTION_FIELDS)[number];

const dateOnly = z.string().refine(isRealDate, "Expected a real date as YYYY-MM-DD");
const timeOnly = z.string().refine(isValidTime, "Expected a 24-hour time as HH:mm");
const nullableText = (max: number) =>
  z.union([z.null(), z.string().trim().max(max)]).transform((v) => (v ? v : null));

/** Shape the model must return (local date and time, no final ISO datetime). */
export const llmTaskOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: taskCategorySchema,
    dueDate: dateOnly.nullable(),
    dueTime: timeOnly.nullable(),
    location: nullableText(200),
    assigneeSuggestion: nullableText(100),
    notes: nullableText(2000),
    confidence: z.number().min(0).max(1),
    uncertainFields: z.array(z.enum(EXTRACTION_FIELDS)).max(EXTRACTION_FIELDS.length),
  })
  .strict();
export type LlmTaskOutput = z.infer<typeof llmTaskOutputSchema>;

/**
 * JSON Schema sent to the model (response_format json_schema, strict). Written by hand with plain
 * types only, because strict engines can reject `pattern` and length keywords. Zod does the real
 * validation. A test keeps the property names in sync with `llmTaskOutputSchema`.
 */
export const LLM_TASK_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "category",
    "dueDate",
    "dueTime",
    "location",
    "assigneeSuggestion",
    "notes",
    "confidence",
    "uncertainFields",
  ],
  properties: {
    title: { type: "string", description: "Short action title, max 200 characters" },
    category: {
      type: "string",
      enum: ["medication", "payment", "appointment", "pickup", "reminder", "other"],
    },
    dueDate: {
      type: ["string", "null"],
      description: "Local date YYYY-MM-DD, or null if not stated",
    },
    dueTime: {
      type: ["string", "null"],
      description: "Local 24-hour time HH:mm, or null if not stated",
    },
    location: { type: ["string", "null"] },
    assigneeSuggestion: {
      type: ["string", "null"],
      description: "Name of the person who should do it, if written",
    },
    notes: { type: ["string", "null"] },
    confidence: {
      type: "number",
      description: "0 to 1: how sure you are that every field is correct",
    },
    uncertainFields: {
      type: "array",
      items: { type: "string", enum: [...EXTRACTION_FIELDS] },
      description: "Fields you are unsure about or had to guess",
    },
  },
} as const;

export const EXTRACTION_WARNINGS = [
  "low_confidence",
  "low_ocr_confidence",
  "uncertain_fields",
  "time_not_given",
  "date_in_past",
  "invalid_date",
  "category_adjusted",
  "sensitive_masked",
  "possible_fraud",
  "extraction_failed",
  "extraction_unavailable",
  "no_text",
] as const;
export const extractionWarningSchema = z.enum(EXTRACTION_WARNINGS);
export type ExtractionWarning = z.infer<typeof extractionWarningSchema>;

/** Normalized task after date normalization, category mapping, masking and risk rules. */
export const extractedTaskSchema = z
  .object({
    title: z.string().min(1).max(200),
    category: taskCategorySchema,
    dueAt: z.string().datetime({ offset: true }).nullable(),
    dueDate: dateOnly.nullable(),
    dueTime: timeOnly.nullable(),
    location: z.string().max(200).nullable(),
    assigneeSuggestion: z.string().max(100).nullable(),
    notes: z.string().max(2000).nullable(),
    confidence: z.number().min(0).max(1),
    uncertainFields: z.array(z.enum(EXTRACTION_FIELDS)),
    riskLevel: riskLevelSchema,
    riskReasons: z.array(z.string()),
    warnings: z.array(extractionWarningSchema),
    needsReview: z.boolean(),
  })
  .strict();
export type ExtractedTask = z.infer<typeof extractedTaskSchema>;

/**
 * Body for saving a draft. There is deliberately no status, risk, or approver field: those are set
 * by the server. Unknown keys are rejected.
 */
export const draftTaskInputSchema = z
  .object({
    noteId: z.string().uuid(),
    extractionId: z.string().uuid().nullable(),
    timeZone: z.string().max(64).optional(),
    title: z.string().trim().min(1, "Please enter a title").max(200),
    category: taskCategorySchema,
    dueDate: dateOnly.nullable(),
    dueTime: timeOnly.nullable(),
    location: nullableText(200),
    assigneeId: z.string().uuid().nullable(),
    notes: nullableText(2000),
  })
  .strict();
export type DraftTaskInput = z.infer<typeof draftTaskInputSchema>;

export const DRAFT_STATUS = "draft" as const;
