/** Household roles from .kiro/specs/fudepan-care-chain/design.md. */
export const HOUSEHOLD_ROLES = [
  "care_recipient",
  "primary_caregiver",
  "family_member",
  "medical_coordinator",
  "finance_coordinator",
  "transport_coordinator",
  "emergency_contact",
  "professional_caregiver",
] as const;

export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export function isHouseholdRole(value: unknown): value is HouseholdRole {
  return typeof value === "string" && (HOUSEHOLD_ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<HouseholdRole, string> = {
  care_recipient: "Care recipient",
  primary_caregiver: "Primary caregiver",
  family_member: "Family member",
  medical_coordinator: "Medical coordinator",
  finance_coordinator: "Finance coordinator",
  transport_coordinator: "Transport coordinator",
  emergency_contact: "Emergency contact",
  professional_caregiver: "Professional caregiver",
};

export type Membership = {
  householdId: string;
  householdName: string;
  role: HouseholdRole;
  displayName: string;
};

/**
 * Every active member may add a note, including the care recipient, who takes the photo
 * themselves (family-shared-care Requirement 1). The database enforces the same rule in
 * private.can_upload_notes(). The role argument is kept so a future restriction stays one edit.
 */
export function canUploadNotes(role: HouseholdRole): boolean {
  return isHouseholdRole(role);
}

export type HouseholdChoice =
  | { kind: "ok"; current: Membership; all: Membership[] }
  | { kind: "no_household" }
  | { kind: "not_member" };

/**
 * Picks the household to show. `memberships` must be the person's active
 * memberships, oldest first. A requested household the person does not belong
 * to is refused rather than silently swapped for another one.
 */
export function chooseHousehold(
  memberships: Membership[],
  requestedId: string | null | undefined,
): HouseholdChoice {
  if (memberships.length === 0) return { kind: "no_household" };
  if (!requestedId) return { kind: "ok", current: memberships[0], all: memberships };
  const current = memberships.find((m) => m.householdId === requestedId);
  return current ? { kind: "ok", current, all: memberships } : { kind: "not_member" };
}
