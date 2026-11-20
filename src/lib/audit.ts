import { auditEventInputSchema, type AuditEventInput } from "@/lib/schemas/audit";
import { maskSensitive } from "@/lib/safety/mask-sensitive";

/** Masks sensitive values in every string of an audit payload, recursively. */
export function sanitizePayload<T>(value: T): T {
  if (typeof value === "string") return maskSensitive(value).text as T;
  if (Array.isArray(value)) return value.map((v) => sanitizePayload(v)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizePayload(v)]),
    ) as T;
  }
  return value;
}

/**
 * Builds a database row for `audit_events` from validated input. Every task state change and every
 * AI extraction should go through this so payloads are validated and masked. `created_at` is set
 * by the database.
 */
export function toAuditRow(input: AuditEventInput & { id?: string }) {
  const { id, ...rest } = input;
  const parsed = auditEventInputSchema.parse(rest);
  return {
    ...(id ? { id } : {}),
    household_id: parsed.householdId,
    task_id: parsed.taskId,
    note_id: parsed.noteId,
    actor_id: parsed.actorId,
    event_type: parsed.eventType,
    payload: sanitizePayload(parsed.payload),
  };
}
