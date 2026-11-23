/**
 * Pure routing rule for `/family/me/[noteId]` (family-shared-care Requirement 13.1).
 * Only a care recipient stays on the Recipient_View. Everyone else goes to the full event page.
 */
import type { HouseholdRole } from "@/lib/households/membership";

export type MeRouteDecision = { kind: "stay" } | { kind: "redirect"; to: string };

export function meRouteDecision(role: HouseholdRole, noteId: string): MeRouteDecision {
  return role === "care_recipient" ? { kind: "stay" } : { kind: "redirect", to: `/family/events/${noteId}` };
}
