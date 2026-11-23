import { z } from "zod";
import { hasModelOnlyDeadline } from "@/lib/care/appointment";
import {
  CARE_CATEGORIES,
  MISSING_DETAIL_KINDS,
  type CareChainDraft,
} from "@/lib/ai/schema";

/**
 * Pure mapping from a validated, normalized Care Chain draft to the jsonb
 * payload of `public.save_care_chain_draft(p_run_id, p_draft)`.
 *
 * The payload shape and limits mirror the comment block in
 * supabase/migrations/20261210000400_recognition_functions.sql. The payload
 * never carries an owner, backup owner, driver, or companion. `suggested_role`
 * and `person_to_ask` are text only. Appointment Parts never carry times.
 */

export const DRAFT_LIMITS = {
  title: 200,
  description: 1000,
  sourceQuote: 500,
  suggestedRole: 100,
  personToAsk: 100,
  evidenceLabel: 200,
  evidenceItems: 50,
  steps: 50,
  question: 500,
} as const;

const RISKS = ["low", "medium", "high"] as const;

/** Categories that always need approval, whatever the model said. */
const APPROVAL_CATEGORIES: ReadonlySet<string> = new Set([
  "medical",
  "medication",
  "appointment",
  "payment",
  "transport",
  "document",
]);

const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

// ---------------------------------------------------------------------------
// Payload schema (matches the SQL checks)
// ---------------------------------------------------------------------------

const trimmedText = (max: number) =>
  z
    .string()
    .refine((s) => s.trim() === s, "must be trimmed")
    .refine((s) => s.length >= 1, "must not be empty")
    .refine((s) => Array.from(s).length <= max, `must be at most ${max} characters`);

const optionalText = (max: number) => trimmedText(max).nullable();

const isoTimestamp = z
  .string()
  .refine((s) => ISO_WITH_ZONE.test(s) && !Number.isNaN(Date.parse(s)), "must be ISO 8601 with a zone")
  .nullable();

export const draftRowsStepSchema = z
  .object({
    title: trimmedText(DRAFT_LIMITS.title),
    description: optionalText(DRAFT_LIMITS.description),
    care_category: z.enum(CARE_CATEGORIES),
    risk_level: z.enum(RISKS),
    suggested_role: optionalText(DRAFT_LIMITS.suggestedRole),
    person_to_ask: optionalText(DRAFT_LIMITS.personToAsk),
    evidence_required: z
      .array(z.string().refine((s) => Array.from(s).length <= DRAFT_LIMITS.evidenceLabel))
      .max(DRAFT_LIMITS.evidenceItems),
    approval_required: z.boolean(),
    approval_state: z.enum(["pending", "not_required"]),
    source_quote: optionalText(DRAFT_LIMITS.sourceQuote),
    confidence: z.number().min(0).max(1).nullable(),
    due_at: isoTimestamp,
    escalation_at: isoTimestamp,
  })
  .strict()
  .superRefine((step, ctx) => {
    const expected = step.approval_required ? "pending" : "not_required";
    if (step.approval_state !== expected) {
      ctx.addIssue({ code: "custom", path: ["approval_state"], message: `must be ${expected}` });
    }
    if (
      !step.approval_required &&
      (step.risk_level === "high" || APPROVAL_CATEGORIES.has(step.care_category))
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["approval_required"],
        message: "this Part must require approval",
      });
    }
    if (hasModelOnlyDeadline(step.care_category) && (step.due_at || step.escalation_at)) {
      ctx.addIssue({
        code: "custom",
        path: ["due_at"],
        message: "appointment Parts must not carry times",
      });
    }
  });

export const draftRowsAmbiguitySchema = z
  .object({
    step_index: z.number().int().min(0),
    kind: z.enum(MISSING_DETAIL_KINDS),
    question: optionalText(DRAFT_LIMITS.question),
  })
  .strict();

export const draftRowsPayloadSchema = z
  .object({
    chain_title: trimmedText(DRAFT_LIMITS.title),
    overall_risk: z.enum(RISKS),
    steps: z.array(draftRowsStepSchema).min(1).max(DRAFT_LIMITS.steps),
    ambiguities: z.array(draftRowsAmbiguitySchema),
  })
  .strict()
  .superRefine((payload, ctx) => {
    payload.ambiguities.forEach((a, i) => {
      if (a.step_index >= payload.steps.length) {
        ctx.addIssue({
          code: "custom",
          path: ["ambiguities", i, "step_index"],
          message: "must point at an existing step",
        });
      }
    });
  });

export type DraftRowsStep = z.infer<typeof draftRowsStepSchema>;
export type DraftRowsAmbiguity = z.infer<typeof draftRowsAmbiguitySchema>;
export type DraftRowsPayload = z.infer<typeof draftRowsPayloadSchema>;

export type DraftRowsResult = {
  payload: DraftRowsPayload;
  /** Ambiguities not stored per step (no usable step or kind). Counted, never invented. */
  unlinkedAmbiguityCount: number;
};

export type DraftRowsValidation =
  | { ok: true; payload: DraftRowsPayload }
  | { ok: false; issues: string[] };

/** Checks a payload against the same rules the SQL function applies. */
export function validateDraftRowsPayload(value: unknown): DraftRowsValidation {
  const parsed = draftRowsPayloadSchema.safeParse(value);
  if (parsed.success) return { ok: true, payload: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Trims and cuts to `max` characters (code points). Empty becomes null. */
function cleanText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const cut = Array.from(trimmed).slice(0, max).join("").trim();
  return cut === "" ? null : cut;
}

function cleanTimestamp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return ISO_WITH_ZONE.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;
}

function clampConfidence(value: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.min(1, Math.max(0, value));
}

/** Reads a legacy step reference from an ambiguity `field` ("steps[2]..." zero-based, "step 3 ..." one-based). */
function stepIndexFromField(field: string): number | null {
  const zero = /^\s*steps\[(\d+)\]/i.exec(field);
  if (zero) return Number(zero[1]);
  const one = /^\s*step\s+(\d+)\b/i.exec(field);
  if (one) {
    const n = Number(one[1]);
    return n >= 1 ? n - 1 : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapDraftToRows(draft: CareChainDraft): DraftRowsResult {
  const sourceSteps = draft.steps.slice(0, DRAFT_LIMITS.steps);

  const steps: DraftRowsStep[] = sourceSteps.map((step) => {
    const approvalRequired =
      step.approval_required ||
      step.risk_level === "high" ||
      APPROVAL_CATEGORIES.has(step.care_category);
    const noTimes = hasModelOnlyDeadline(step.care_category);

    const evidence = step.evidence_required
      .map((label) => cleanText(label, DRAFT_LIMITS.evidenceLabel))
      .filter((label): label is string => label !== null)
      .slice(0, DRAFT_LIMITS.evidenceItems);

    return {
      title: cleanText(step.title, DRAFT_LIMITS.title) ?? "",
      description: cleanText(step.description, DRAFT_LIMITS.description),
      care_category: step.care_category,
      risk_level: step.risk_level,
      suggested_role: cleanText(step.suggested_owner_role, DRAFT_LIMITS.suggestedRole),
      person_to_ask: cleanText(step.person_to_ask, DRAFT_LIMITS.personToAsk),
      evidence_required: evidence,
      approval_required: approvalRequired,
      approval_state: approvalRequired ? "pending" : "not_required",
      source_quote: cleanText(step.source_quote, DRAFT_LIMITS.sourceQuote),
      confidence: clampConfidence(step.confidence),
      due_at: noTimes ? null : cleanTimestamp(step.due_at),
      escalation_at: noTimes ? null : cleanTimestamp(step.escalation_at),
    };
  });

  const ambiguities: DraftRowsAmbiguity[] = [];
  let unlinked = 0;
  for (const a of draft.ambiguities) {
    const index =
      a.step_index !== null && a.step_index !== undefined
        ? a.step_index
        : stepIndexFromField(a.field);
    if (index === null || index < 0 || index >= steps.length || !a.kind) {
      unlinked += 1;
      continue;
    }
    ambiguities.push({
      step_index: index,
      kind: a.kind,
      question: cleanText(a.question, DRAFT_LIMITS.question),
    });
  }

  return {
    payload: {
      chain_title: cleanText(draft.chain_title, DRAFT_LIMITS.title) ?? "",
      overall_risk: draft.overall_risk,
      steps,
      ambiguities,
    },
    unlinkedAmbiguityCount: unlinked,
  };
}
