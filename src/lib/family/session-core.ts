import { chooseHousehold, isHouseholdRole, type HouseholdRole, type Membership } from "@/lib/households/membership";
import type { Language } from "@/lib/i18n/format";
import { resolveLanguage } from "@/lib/i18n/language";

/** Everything a /family page needs to know about the signed-in person. */
export type FamilyContext = {
  userId: string;
  householdId: string;
  householdName: string;
  memberId: string;
  role: HouseholdRole;
  displayName: string;
  language: Language;
};

export type FamilyContextResult =
  | { kind: "ok"; context: FamilyContext }
  | { kind: "no_household" }
  | { kind: "not_member" };

/** The saved setting wins; otherwise Accept-Language; otherwise English. */
export function parseLanguage(value: string | null | undefined, acceptLanguage?: string | null): Language {
  return resolveLanguage(value, acceptLanguage);
}

export function isRecipient(role: HouseholdRole): boolean {
  return role === "care_recipient";
}

export type MemberRow = { id: string; ui_language: string | null; role: string };

/** Pure part of the resolver: picks the household, then adds the member row's id and language. */
export function resolveFamilyContext(
  userId: string,
  memberships: Membership[],
  requestedHouseholdId: string | null | undefined,
  readMember: (householdId: string) => MemberRow | null,
  acceptLanguage?: string | null,
): FamilyContextResult {
  const choice = chooseHousehold(memberships, requestedHouseholdId);
  if (choice.kind !== "ok") return { kind: choice.kind };
  const member = readMember(choice.current.householdId);
  if (!member || !isHouseholdRole(member.role)) return { kind: "not_member" };
  return {
    kind: "ok",
    context: {
      userId,
      householdId: choice.current.householdId,
      householdName: choice.current.householdName,
      memberId: member.id,
      role: member.role,
      displayName: choice.current.displayName,
      language: parseLanguage(member.ui_language, acceptLanguage),
    },
  };
}

export type FamilyLink = { href: string; labelKey: "nav.feed" | "nav.capture" | "nav.language" | "nav.members" };

/** Care recipients get the feed and the camera only (Requirement 13.1). */
export function familyLinks(role: HouseholdRole): FamilyLink[] {
  const feed: FamilyLink = { href: "/family", labelKey: "nav.feed" };
  const capture: FamilyLink = { href: "/family/capture", labelKey: "nav.capture" };
  if (isRecipient(role)) return [capture, feed];
  return [
    feed,
    capture,
    { href: "/family/members", labelKey: "nav.members" },
    { href: "/family/settings/language", labelKey: "nav.language" },
  ];
}

/** Whether a nav link is the current page. The feed link also covers event pages. */
export function isCurrentLink(href: string, pathname: string): boolean {
  if (href === "/family") {
    return pathname === "/family" || pathname.startsWith("/family/events/") || pathname.startsWith("/family/me/");
  }
  return pathname === href;
}
