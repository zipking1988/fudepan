import { z } from "zod";
import { hasModelOnlyDeadline } from "@/lib/care/appointment";

/**
 * Care Chain JSON output contract from .kiro/specs/fudepan-care-chain/design.md.
 * Validated with Zod before the draft is written to the database.
 */

export const CARE_CATEGORIES = [
  "medical",
  "medication",
  "appointment",
  "payment",
  "transport",
  "document",
  "household",
  "communication",
] as const;

export type CareCategory = (typeof CARE_CATEGORIES)[number];

const riskLevelSchema = z.enum(["low", "medium", "high"]);

const careStepDraftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().default(""),
  care_category: z.enum(CARE_CATEGORIES),
  risk_level: riskLevelSchema,
  suggested_owner_role: z.string().max(100).optional().default(""),
  /**
   * Name of the person the note says to ASK (for example "Misa" in "Ask Misa
   * which clinic"). Information only: never an owner, helper, or assignee.
   */
  person_to_ask: z.string().trim().min(1).max(100).nullable().optional().default(null),
  due_at: z.string().nullable().optional().default(null),
  escalation_at: z.string().nullable().optional().default(null),
  evidence_required: z.array(z.string().max(200)).default([]),
  approval_required: z.boolean(),
  source_quote: z.string().max(500).optional().default(""),
  confidence: z.number().min(0).max(1),
});

export type CareStepDraft = z.infer<typeof careStepDraftSchema>;

export const MISSING_DETAIL_KINDS = [
  "date",
  "time",
  "location",
  "person",
  "document",
  "amount",
  "contact",
] as const;

export type MissingDetailKind = (typeof MISSING_DETAIL_KINDS)[number];

const ambiguitySchema = z.object({
  field: z.string().max(100),
  question: z.string().max(500),
  reason: z.string().max(500),
  /** Zero-based index into `steps` of the step this ambiguity belongs to. */
  step_index: z.number().int().min(0).nullable().optional().default(null),
  /** Which kind of critical detail is missing. */
  kind: z.enum(MISSING_DETAIL_KINDS).nullable().optional().default(null),
});

export type Ambiguity = z.infer<typeof ambiguitySchema>;

const aiBoundarySchema = z.object({
  medical_advice_requested: z.boolean().default(false),
  blocked_actions: z.array(z.string().max(200)).default([]),
  explanation: z.string().max(1000).optional().default(""),
});

export const careChainDraftSchema = z.object({
  chain_title: z.string().min(1).max(200),
  overall_risk: riskLevelSchema,
  steps: z.array(careStepDraftSchema).min(1).max(50),
  ambiguities: z.array(ambiguitySchema).default([]),
  ai_boundary: aiBoundarySchema.optional().default({
    medical_advice_requested: false,
    blocked_actions: [],
    explanation: "",
  }),
});

export type CareChainDraft = z.infer<typeof careChainDraftSchema>;

/**
 * Normalize a Care Chain draft by removing unsupported timestamps.
 * 
 * If a step has due_at or escalation_at but the source_quote doesn't contain
 * an explicit time, the timestamp is cleared and an ambiguity is added.
 * 
 * This prevents AI-invented times while preserving the rest of the valid draft.
 */
export function normalizeCareChainDraft(draft: CareChainDraft): CareChainDraft {
  const normalized: CareChainDraft = {
    ...draft,
    steps: draft.steps.map((step) => {
      const changes: {
        due_at?: null;
        escalation_at?: null;
        ambiguities_added?: Array<{ field: string; question: string; reason: string }>;
      } = { ambiguities_added: [] };

      // Check due_at
      if (step.due_at && !hasExplicitTimeInQuote(step.source_quote, step.due_at)) {
        changes.due_at = null;
        changes.ambiguities_added!.push({
          field: "due_at",
          question: "What is the exact time for this step?",
          reason: "The note mentions a date but not a specific time.",
        });
      }

      // Check escalation_at
      if (step.escalation_at && !hasExplicitTimeInQuote(step.source_quote, step.escalation_at)) {
        changes.escalation_at = null;
        changes.ambiguities_added!.push({
          field: "escalation_at",
          question: "What is the exact escalation time?",
          reason: "The note mentions a date but not a specific time.",
        });
      }

      if (changes.due_at === null || changes.escalation_at === null) {
        return {
          ...step,
          ...(changes.due_at === null && { due_at: null }),
          ...(changes.escalation_at === null && { escalation_at: null }),
        };
      }

      return step;
    }),
    ambiguities: [
      ...draft.ambiguities,
      ...draft.steps.flatMap((step, idx) => {
        const stepChanges: Ambiguity[] = [];

        if (step.due_at && !hasExplicitTimeInQuote(step.source_quote, step.due_at)) {
          stepChanges.push({
            field: `step ${idx + 1} due_at`,
            question: `What is the exact time for "${step.title}"?`,
            reason: "The note mentions a date but not a specific time.",
            step_index: idx,
            kind: "time",
          });
        }

        if (step.escalation_at && !hasExplicitTimeInQuote(step.source_quote, step.escalation_at)) {
          stepChanges.push({
            field: `step ${idx + 1} escalation_at`,
            question: `What is the exact escalation time for "${step.title}"?`,
            reason: "The note mentions a date but not a specific time.",
            step_index: idx,
            kind: "time",
          });
        }

        return stepChanges;
      }),
    ],
  };

  // Appointment steps never keep a model timestamp as a deadline: the clock
  // time in the note has no time zone, so any instant here is a guess. The
  // literal date/time stays in source_quote and prefills the appointment form.
  normalized.steps = normalized.steps.map((step) =>
    hasModelOnlyDeadline(step.care_category) && (step.due_at || step.escalation_at)
      ? { ...step, due_at: null, escalation_at: null }
      : step,
  );

  // person_to_ask is text only. An ambiguity pointing at a step that does not
  // exist loses its link instead of attaching to the wrong Part.
  const stepCount = normalized.steps.length;
  normalized.ambiguities = normalized.ambiguities.map((a) =>
    a.step_index !== null && a.step_index >= stepCount ? { ...a, step_index: null } : a,
  );

  return normalized;
}

/**
 * Check if a source quote contains an explicit time that supports the given ISO timestamp.
 * 
 * Returns true only if:
 * - The quote contains a specific clock time (e.g., "5:00 PM", "14:30", "9 AM")
 * - The ISO timestamp is not just midnight (which often indicates date-only)
 * 
 * Generic words like "morning" or "afternoon" don't count as explicit times.
 */
function hasExplicitTimeInQuote(sourceQuote: string | undefined, isoTimestamp: string): boolean {
  if (!sourceQuote) return false;

  // Parse the timestamp to check if it has a non-midnight time
  let parsed: Date;
  try {
    parsed = new Date(isoTimestamp);
    if (isNaN(parsed.getTime())) return false;
  } catch {
    return false;
  }

  // Get the time components - we need to check the actual time in the ISO string
  // to avoid UTC/local confusion, extract HH:MM from the ISO string directly
  const timeMatch = isoTimestamp.match(/T(\d{2}):(\d{2})/);
  if (!timeMatch) return false;

  const hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);

  // If it's midnight (00:00), it's likely a date-only value
  if (hours === 0 && minutes === 0) return false;

  // Look for explicit time patterns in the source quote
  // Matches: "5:00 PM", "14:30", "9 AM", "6:00 JST", etc.
  const explicitTimePatterns = [
    /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)/i, // 5:00 PM, 9:00 am
    /\d{1,2}:\d{2}\s*(?:JST|UTC|EST|PST|GMT)/i, // 5:00 PM JST
    /\d{1,2}\s*(?:AM|PM|am|pm)\b/i, // 9 AM, 3pm (without colon)
    /\b(?:at|by|before|after)\s+\d{1,2}:\d{2}/i, // at 14:30, by 5:00
  ];

  // Generic time words like "morning" don't count as explicit times
  const hasExplicitTime = explicitTimePatterns.some((pattern) => pattern.test(sourceQuote));

  return hasExplicitTime;
}

/**
 * Validation rules from .kiro/specs/fudepan-care-chain/design.md.
 * Returns a list of violations; empty means the draft is safe to persist.
 */
export function validateCareChainDraft(draft: CareChainDraft): string[] {
  const violations: string[] = [];

  for (const step of draft.steps) {
    // High-risk steps must require approval
    if (step.risk_level === "high" && !step.approval_required) {
      violations.push(
        `Step "${step.title}" is high-risk but approval_required is false. High-risk steps must wait for human approval.`,
      );
    }

    // Medical category steps must require approval
    if (
      (step.care_category === "medical" ||
        step.care_category === "medication" ||
        step.care_category === "appointment") &&
      !step.approval_required
    ) {
      violations.push(
        `Step "${step.title}" is a ${step.care_category} step but approval_required is false. Medical actions require human approval.`,
      );
    }

    // Payment steps must require approval
    if (step.care_category === "payment" && !step.approval_required) {
      violations.push(
        `Step "${step.title}" is a payment step but approval_required is false. Payments require human approval.`,
      );
    }

    // Date-like strings must be parseable ISO 8601
    if (step.due_at && step.due_at !== null) {
      const d = new Date(step.due_at);
      if (isNaN(d.getTime())) {
        violations.push(
          `Step "${step.title}" has an unparseable due_at: "${step.due_at}". Use ISO 8601 or null.`,
        );
      }
    }
  }

  // If the boundary was triggered, medical advice must not appear in steps
  if (draft.ai_boundary?.medical_advice_requested) {
    violations.push(
      "ai_boundary.medical_advice_requested is true: medical advice must not appear in care steps.",
    );
  }

  return violations;
}
