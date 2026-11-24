/**
 * What a departing member holds (family-app-demo-parity Requirements 11.6, 12.7, 13.1-13.3, 13.8).
 * Pure TypeScript. The model's departure and the SQL `release_departing_member` use the same selection.
 */
import type { ApprovalState } from "@/lib/care/rules/types";

export type HeldRole = "owner" | "driver" | "companion" | "backup_owner";
export const HELD_ROLE_ORDER: readonly HeldRole[] = ["owner", "driver", "companion", "backup_owner"];

export type PartHolders = {
  partId: string;
  title: string;
  /** Not completed, cancelled, or failed. Closed Parts are never touched. */
  isOpen: boolean;
  ownerId: string | null;
  driverId: string | null;
  companionId: string | null;
  backupOwnerId: string | null;
  isHighRisk: boolean;
  approvalState: ApprovalState;
};

export type RequestRef = {
  id: string;
  partId: string;
  fromId: string;
  toId: string;
  status: "pending" | "accepted" | "declined" | "expired";
};

export type HeldPart = {
  partId: string;
  title: string;
  roles: HeldRole[];
  pendingRequestIds: string[];
  ownerless: boolean;
  approvalWillReset: boolean;
};

const HOLDER_FIELD = {
  owner: "ownerId",
  driver: "driverId",
  companion: "companionId",
  backup_owner: "backupOwnerId",
} as const satisfies Record<HeldRole, keyof PartHolders>;

/** Open Parts the member holds or has a pending request on, ordered by part id. No 24-hour protection. */
export function heldParts(
  memberId: string,
  parts: readonly PartHolders[],
  requests: readonly RequestRef[],
): HeldPart[] {
  const out: HeldPart[] = [];
  for (const part of parts) {
    if (!part.isOpen) continue;
    const roles = HELD_ROLE_ORDER.filter((role) => part[HOLDER_FIELD[role]] === memberId);
    const pendingRequestIds = requests
      .filter(
        (r) => r.partId === part.partId && r.status === "pending" && (r.fromId === memberId || r.toId === memberId),
      )
      .map((r) => r.id);
    if (roles.length === 0 && pendingRequestIds.length === 0) continue;
    out.push({
      partId: part.partId,
      title: part.title,
      roles,
      pendingRequestIds,
      ownerless: roles.includes("owner"),
      approvalWillReset:
        part.isHighRisk &&
        part.approvalState === "approved" &&
        roles.some((r) => r === "owner" || r === "driver" || r === "companion"),
    });
  }
  return out.sort((a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
}
