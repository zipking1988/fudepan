import type { HouseholdRole } from "@/lib/households/membership";

export type FirstRunPrompt = "take_photo" | "invite_family" | "invite_recipient" | "recipient_take_photo";
export type DismissiblePrompt = "invite_family" | "invite_recipient";

/** Prompts for an empty or small household (family-app-demo-parity Requirements 16.1-16.4). */
export function firstRunPrompts(input: {
  viewerRole: HouseholdRole;
  eventCount: number;
  activeMemberCount: number;
  hasActiveRecipient: boolean;
  dismissed: ReadonlySet<DismissiblePrompt>;
}): FirstRunPrompt[] {
  if (input.viewerRole === "care_recipient") {
    return input.eventCount === 0 ? ["recipient_take_photo"] : [];
  }
  const out: FirstRunPrompt[] = [];
  if (input.eventCount === 0) out.push("take_photo");
  if (input.viewerRole === "primary_caregiver") {
    if (input.activeMemberCount === 1 && !input.dismissed.has("invite_family")) out.push("invite_family");
    if (!input.hasActiveRecipient && !input.dismissed.has("invite_recipient")) out.push("invite_recipient");
  }
  return out;
}
