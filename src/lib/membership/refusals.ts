import type { MessageKey } from "@/lib/i18n/messages";

const KEYS = {
  not_found: "membership.refusal.not_found",
  not_primary_caregiver: "membership.refusal.not_primary_caregiver",
  not_self: "membership.refusal.not_self",
  self_target: "membership.refusal.self_target",
  last_primary_caregiver: "membership.refusal.last_primary_caregiver",
  invalid_input: "membership.refusal.invalid_input",
  already_in_household: "membership.refusal.already_in_household",
  already_member: "membership.refusal.already_member",
  one_household_only: "membership.refusal.one_household_only",
  invite_cap_reached: "membership.refusal.invite_cap_reached",
  not_pending: "membership.refusal.not_pending",
  unusable: "membership.refusal.unusable",
} as const satisfies Record<string, MessageKey>;

export const MEMBERSHIP_REFUSAL_CODES = Object.keys(KEYS) as (keyof typeof KEYS)[];

/** Total: any other code (including "server_error" or raw text) gives the generic message key. */
export function membershipRefusalKey(code: string): MessageKey {
  return Object.prototype.hasOwnProperty.call(KEYS, code)
    ? KEYS[code as keyof typeof KEYS]
    : "membership.error.generic";
}
