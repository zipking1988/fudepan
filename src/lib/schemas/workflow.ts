import { z } from "zod";
import { roleSchema } from "@/lib/permissions";
import { taskUpdateSchema } from "./task";

const uuid = z.string().uuid();
const reason = z.string().trim().min(1, "Please give a reason").max(500);

/** Body for POST /api/tasks/[id]/actions. Strict: no status, risk, or approver can be supplied. */
export const taskActionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z.object({ action: z.literal("assign"), assigneeId: uuid.nullable() }).strict(),
  z.object({ action: z.literal("submit") }).strict(),
  // Approval must be an explicit act: the person confirms they checked the original note.
  z.object({ action: z.literal("approve"), acknowledged: z.literal(true) }).strict(),
  z.object({ action: z.literal("reject"), reason: reason.optional() }).strict(),
  z.object({ action: z.literal("complete") }).strict(),
  z.object({ action: z.literal("cancel"), reason }).strict(),
]);
export type TaskActionBody = z.infer<typeof taskActionBodySchema>;

/** Body for PATCH /api/tasks/[id]. `changes` reuses the Phase 1 taskUpdateSchema. */
export const editTaskBodySchema = z
  .object({
    changes: taskUpdateSchema,
    /** True when the user gave a date without a time (09:00 was used). */
    timeDefaulted: z.boolean().optional(),
  })
  .strict();
export type EditTaskBody = z.infer<typeof editTaskBodySchema>;

const displayName = z.string().trim().min(1, "Please enter a name").max(100);

export const createHouseholdSchema = z
  .object({ name: z.string().trim().min(1, "Please enter a household name").max(100), displayName })
  .strict();

export const createInvitationSchema = z
  .object({ role: roleSchema, email: z.string().trim().email().max(254).nullable().optional() })
  .strict();

export const acceptInvitationSchema = z
  .object({ token: z.string().min(20).max(100), displayName })
  .strict();

export const setRoleSchema = z.object({ role: roleSchema }).strict();
export const selectHouseholdSchema = z.object({ householdId: uuid }).strict();
