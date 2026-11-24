export const INVITE_STATES = ["pending", "accepted", "revoked", "expired"] as const;
export type InviteState = (typeof INVITE_STATES)[number];

/** A pending invite is expired from `expiresAt` on, even before the database row is updated. */
export function effectiveInviteState(stored: InviteState, expiresAt: Date, now: Date): InviteState {
  if (stored === "pending" && now.getTime() >= expiresAt.getTime()) return "expired";
  return stored;
}
