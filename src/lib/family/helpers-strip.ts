/**
 * Helpers_Strip: who is helping right now, across the household's open events.
 *
 * Pure: no I/O. One entry per active member with at least one Current_Claim: an Owner, Driver,
 * or Companion role on a Part that is not completed, cancelled, or failed, in an event that is
 * read and still open. Backups are not claims. Entries are ordered by first name, then member
 * id, so the order never depends on how much someone does. No count, rank, or score is kept.
 */
import { iconFor, type CardIcon } from "./event-card";
import { firstName } from "./names";
import type { SharedCareEvent } from "./shared-care-event";

export type StripRole = "owner" | "driver" | "companion";

export type HelperClaim = {
  role: StripRole;
  noteId: string;
  partId: string;
  partTitle: string;
  icon: CardIcon;
};

export type HelperEntry = {
  memberId: string;
  name: string;
  isViewer: boolean;
  claims: HelperClaim[];
};

const ROLES: readonly StripRole[] = ["owner", "driver", "companion"];
const NOT_CURRENT = new Set(["completed", "cancelled", "failed"]);
const CLOSED = new Set(["completed", "cancelled"]);

function isOpenEvent(event: SharedCareEvent): boolean {
  return event.state === "ready" && event.parts.some((p) => !CLOSED.has(String(p.progressStatus)));
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function helpersStrip(
  events: readonly SharedCareEvent[],
  activeMemberIds: ReadonlySet<string>,
  viewerId: string,
): HelperEntry[] {
  const byMember = new Map<string, HelperEntry>();
  for (const ev of events) {
    if (!isOpenEvent(ev)) continue;
    for (const p of ev.parts) {
      if (NOT_CURRENT.has(String(p.progressStatus))) continue;
      for (const role of ROLES) {
        const holder = p[role];
        if (!holder || !activeMemberIds.has(holder.id)) continue;
        let entry = byMember.get(holder.id);
        if (!entry) {
          entry = { memberId: holder.id, name: firstName(holder.name), isViewer: holder.id === viewerId, claims: [] };
          byMember.set(holder.id, entry);
        }
        entry.claims.push({ role, noteId: ev.noteId, partId: p.id, partTitle: p.title, icon: iconFor(p) });
      }
    }
  }
  return [...byMember.values()].sort((a, b) => compare(a.name, b.name) || compare(a.memberId, b.memberId));
}
