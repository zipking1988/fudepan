import { z } from "zod";

export const AUDIT_EVENT_TYPES = [
  "note_created",
  "task_extracted",
  "task_updated",
  "task_confirmation_requested",
  "task_approved",
  "task_rejected",
  "task_completed",
  "task_cancelled",
  "calendar_event_created",
  "notification_sent",
  "household_created",
  "member_joined",
  "member_role_changed",
  "invitation_revoked",
] as const;

/** Events about a household or its members rather than a task or note. */
export const HOUSEHOLD_LEVEL_EVENTS: readonly string[] = [
  "household_created",
  "member_joined",
  "member_role_changed",
  "invitation_revoked",
];

export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

/** Input for writing an audit event. `created_at` is set by the database. */
export const auditEventInputSchema = z
  .object({
    householdId: z.string().uuid(),
    taskId: z.string().uuid().nullable(),
    noteId: z.string().uuid().nullable().default(null),
    actorId: z.string().uuid().nullable(),
    eventType: auditEventTypeSchema,
    payload: z.record(z.string(), z.unknown()).default({}),
  })
  .refine(
    (e) => e.taskId !== null || e.noteId !== null || HOUSEHOLD_LEVEL_EVENTS.includes(e.eventType),
    { message: "An audit event must reference a task or a note" },
  );
export type AuditEventInput = z.infer<typeof auditEventInputSchema>;

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  householdId: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  noteId: z.string().uuid().nullable(),
  actorId: z.string().uuid().nullable(),
  eventType: auditEventTypeSchema,
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime({ offset: true }),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
