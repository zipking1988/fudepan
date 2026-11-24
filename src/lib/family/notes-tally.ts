/**
 * Completed-task totals across the notes of the Notes list.
 *
 * Pure: no I/O. Same owner-based meaning as the per-note leaderboard: a task counts for its
 * Owner when it is completed. Claims, approvals, cancelled tasks and driver/companion stickers
 * do not count. Only notes that are ready are read, and only the notes passed in, so the numbers
 * are explicitly "in this list".
 */
import type { SharedCareEvent } from "./shared-care-event";
export type TallyTask = { partId: string; title: string };
export type TallyNote = { noteId: string; title: string | null; tasks: TallyTask[] };
export type TallyRow = {
  memberId: string;
  name: string;
  done: number;
  rank: number;
  tied: boolean;
};
export type NotesTally = {
  /** Number of notes the counts cover. */
  notes: number;
  mine: { count: number; byNote: TallyNote[] };
  family: TallyRow[];
};
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
export function notesTally(events: readonly SharedCareEvent[], viewerId: string): NotesTally {
  const counts = new Map<string, { name: string; done: number }>();
  const byNote: TallyNote[] = [];
  for (const event of events) {
    if (event.state !== "ready") continue;
    const tasks: TallyTask[] = [];
    for (const part of event.parts) {
      if (part.progressStatus !== "completed" || !part.owner) continue;
      // Full display name: two members can share a first word ("Alpha Test Organizer", "Alpha Test Backup").
      const row = counts.get(part.owner.id) ?? { name: (part.owner.name ?? "").trim(), done: 0 };
      row.done += 1;
      counts.set(part.owner.id, row);
      if (part.owner.id === viewerId) tasks.push({ partId: part.id, title: part.title });
    }
    if (tasks.length > 0) byNote.push({ noteId: event.noteId, title: event.title, tasks });
  }
  const sorted = [...counts.entries()]
    .map(([memberId, r]) => ({ memberId, ...r }))
    .sort((a, b) => b.done - a.done || compare(a.name, b.name) || compare(a.memberId, b.memberId));
  const family = sorted.map((r) => ({
    ...r,
    rank: 1 + sorted.filter((o) => o.done > r.done).length,
    tied: sorted.some((o) => o.memberId !== r.memberId && o.done === r.done),
  }));
  return {
    notes: events.length,
    mine: { count: byNote.reduce((n, x) => n + x.tasks.length, 0), byNote },
    family,
  };
}
