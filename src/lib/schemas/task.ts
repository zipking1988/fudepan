import { z } from "zod";

export const TASK_CATEGORIES = [
  "medication",
  "payment",
  "appointment",
  "pickup",
  "reminder",
  "other",
] as const;
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export const TASK_STATUSES = [
  "draft",
  "awaiting_confirmation",
  "confirmed",
  "completed",
  "cancelled",
  "rejected",
] as const;

export const taskCategorySchema = z.enum(TASK_CATEGORIES);
export const riskLevelSchema = z.enum(RISK_LEVELS);
export const taskStatusSchema = z.enum(TASK_STATUSES);

export type TaskCategory = z.infer<typeof taskCategorySchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type TaskStatus = z.infer<typeof taskStatusSchema>;

/** Categories that must default to high risk (requirements US-3). */
export const HIGH_RISK_CATEGORIES: readonly TaskCategory[] = [
  "medication",
  "payment",
  "appointment",
  "pickup",
];

const isoDateTime = z.string().datetime({ offset: true });

/** Shape the parser produces from a note. Dates are ISO 8601. Nothing here executes an action. */
export const parsedTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: taskCategorySchema,
  dueAt: isoDateTime.nullable(),
  location: z.string().trim().max(200).nullable(),
  assigneeSuggestion: z.string().trim().max(100).nullable(),
  notes: z.string().trim().max(2000).nullable(),
  confidence: z.number().min(0).max(1),
  needsReview: z.boolean(),
});
export type ParsedTask = z.infer<typeof parsedTaskSchema>;

/**
 * Fields a user may edit. Status, risk, and approval are intentionally absent: they change only
 * through workflow functions that also write an audit event.
 */
export const taskUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    category: taskCategorySchema,
    dueAt: isoDateTime.nullable(),
    location: z.string().trim().max(200).nullable(),
    assigneeId: z.string().uuid().nullable(),
    notes: z.string().trim().max(2000).nullable(),
  })
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided",
  });
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;
