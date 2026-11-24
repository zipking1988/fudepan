/**
 * The thanks board of one note, built only from what was recorded.
 *
 * Pure: no I/O. A row counts the Parts of this note a member finished as Owner. Equal counts
 * share a rank. "Best Supporter" is given only when every Part of the note is completed or
 * cancelled, and then to every member in first place. Nothing is guessed or carried over from
 * another note.
 */
import { firstName } from "./names";
import type { MemberRef, SharedCareEvent } from "./shared-care-event";

export type BoardRow = {
  memberId: string;
  name: string;
  done: number;
  rank: number;
  tied: boolean;
  best: boolean;
};

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function leaderboard(event: Pick<SharedCareEvent, "parts" | "done" | "state">): BoardRow[] {
  if (event.state !== "ready") return [];
  const counts = new Map<string, { member: MemberRef; done: number }>();
  for (const p of event.parts) {
    if (p.progressStatus !== "completed" || !p.owner) continue;
    const row = counts.get(p.owner.id) ?? { member: p.owner, done: 0 };
    row.done += 1;
    counts.set(p.owner.id, row);
  }
  const rows = [...counts.values()]
    .map((r) => ({ memberId: r.member.id, name: firstName(r.member.name), done: r.done }))
    .sort((a, b) => b.done - a.done || compare(a.name, b.name) || compare(a.memberId, b.memberId));
  return rows.map((r) => {
    const rank = 1 + rows.filter((o) => o.done > r.done).length;
    const tied = rows.some((o) => o.memberId !== r.memberId && o.done === r.done);
    return { ...r, rank, tied, best: event.done && rank === 1 };
  });
}

export type ContributionItem =
  | { kind: "finished"; partId: string; title: string }
  | { kind: "drove"; partId: string; title: string }
  | { kind: "wentAlong"; partId: string; title: string };

export type Contribution = { memberId: string; name: string; items: ContributionItem[] };

/** Who did what on the completed Parts of this note: finished as Owner, drove, went along. */
export function contributions(event: Pick<SharedCareEvent, "parts" | "state">): Contribution[] {
  if (event.state !== "ready") return [];
  const byMember = new Map<string, Contribution>();
  const add = (member: MemberRef | null, item: ContributionItem) => {
    if (!member) return;
    const entry = byMember.get(member.id) ?? { memberId: member.id, name: firstName(member.name), items: [] };
    entry.items.push(item);
    byMember.set(member.id, entry);
  };
  for (const p of event.parts) {
    if (p.progressStatus !== "completed") continue;
    add(p.owner, { kind: "finished", partId: p.id, title: p.title });
    add(p.driver, { kind: "drove", partId: p.id, title: p.title });
    add(p.companion, { kind: "wentAlong", partId: p.id, title: p.title });
  }
  return [...byMember.values()].sort((a, b) => compare(a.name, b.name) || compare(a.memberId, b.memberId));
}
