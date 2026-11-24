/**
 * Where a person goes after authentication, and which `/family` routes a Care_Recipient may reach
 * (family-app-demo-parity Requirements 1.7, 1.8, 6.11, 8.1, 8.3, 12.6). Pure TypeScript.
 */
import { safeNextPath } from "@/lib/auth/next-path";
import type { HouseholdRole } from "@/lib/households/membership";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RECIPIENT_ROUTES = new RegExp(`^/family(/capture|/me/${UUID}(/timeline)?)?$`);

export type RecipientRouteDecision = { kind: "stay" } | { kind: "redirect"; to: "/family" };

/**
 * Non-recipient Roles stay everywhere. A Care_Recipient stays on `/family`, `/family/capture`, and
 * `/family/me/<uuid>` (with its timeline) and is sent to `/family` from every other `/family/*` path.
 */
export function recipientRouteDecision(role: HouseholdRole, pathname: string): RecipientRouteDecision {
  if (role !== "care_recipient") return { kind: "stay" };
  return RECIPIENT_ROUTES.test(pathname) ? { kind: "stay" } : { kind: "redirect", to: "/family" };
}

const isFamilyPath = (p: string) => p === "/family" || p.startsWith("/family/");

export function postAuthDestination(input: {
  activeRole: HouseholdRole | null;
  hasInviteCookie: boolean;
  requestedNext: string | null;
}): string {
  if (input.hasInviteCookie) return "/join";
  if (input.activeRole === null) return "/welcome";
  const next = input.requestedNext;
  if (next !== null && safeNextPath(next) === next) {
    if (input.activeRole !== "care_recipient") return next;
    if (isFamilyPath(next) && recipientRouteDecision(input.activeRole, next).kind === "stay") return next;
  }
  return "/family";
}
