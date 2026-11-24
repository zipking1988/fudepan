import { z } from "zod";
import { HOUSEHOLD_ROLES } from "@/lib/households/membership";
import type { MessageKey } from "@/lib/i18n/messages";
import { INVITE_TOKEN_PATTERN } from "./invite-token";

const name40 = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.string().min(1).max(40));

export const signUpInput = z.object({
  email: z.string().trim().min(1).max(320).pipe(z.email()),
  password: z.string().min(8).max(200),
  next: z.string().optional(),
});
export const createHouseholdInput = z.object({ householdName: name40, displayName: name40 });
export const createInviteInput = z.object({ householdId: z.uuid(), role: z.enum(HOUSEHOLD_ROLES) });
export const revokeInviteInput = z.object({ householdId: z.uuid(), inviteId: z.uuid() });
export const openInviteInput = z.object({ token: z.string().regex(INVITE_TOKEN_PATTERN).nullable() });
export const acceptInviteInput = z.object({ displayName: name40 });
export const changeRoleInput = z.object({
  householdId: z.uuid(),
  memberId: z.uuid(),
  role: z.enum(HOUSEHOLD_ROLES),
});
export const memberTargetInput = z.object({ householdId: z.uuid(), memberId: z.uuid() });
export const renameInput = z.object({ householdId: z.uuid(), displayName: name40 });

/** Message keys for field errors. Each names the field and the rule. */
const FIELD_KEYS: Record<string, MessageKey> = {
  email: "signup.error.email",
  password: "signup.error.password",
  householdName: "welcome.error.householdName",
  displayName: "welcome.error.displayName",
  role: "invites.error.role",
};

/** Used when a field has no specific key (for example an ID that the form never shows). */
const FALLBACK_KEY: MessageKey = "membership.refusal.invalid_input";

/** Field name to message key for the first problem in each field. Raw Zod messages are never used. */
export function issuesToFieldKeys(error: z.ZodError): Record<string, MessageKey> {
  const out: Record<string, MessageKey> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!(field in out)) out[field] = FIELD_KEYS[field] ?? FALLBACK_KEY;
  }
  return out;
}

export type FormErrors<V extends Record<string, string>> = {
  fieldKeys: Record<string, MessageKey>;
  /** What the person typed, with every password field removed. */
  values: Partial<V>;
};

/** Runs a schema over raw form text. On failure, returns field keys and the entered values without the password. */
export function validateForm<S extends z.ZodType>(
  schema: S,
  raw: Record<string, string>,
): { ok: true; data: z.output<S> } | ({ ok: false } & FormErrors<Record<string, string>>) {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (k !== "password") values[k] = v;
  return { ok: false, fieldKeys: issuesToFieldKeys(parsed.error), values };
}
