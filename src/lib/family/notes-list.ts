/**
 * One row of the household Notes list, built only from the shared care event.
 * Pure: no I/O. "Needs review" means the note was read and still has open tasks.
 */
import { eventProgress } from "./dashboard";
import { boardParts, taskState } from "./playful";
import type { SharedCareEvent } from "./shared-care-event";
export type NoteRowStatus = "reading" | "needsReview" | "done" | "failed";
export type NoteRow = {
  noteId: string;
  title: string | null;
  createdAt: string;
  status: NoteRowStatus;
  done: number;
  total: number;
  /** Why a "needsReview" note needs review, from its own tasks. Null when no concrete reason is recorded. */
  reason: { kind: "pending" | "missing" | "unassigned"; count: number } | null;
};
export function noteStatus(event: Pick<SharedCareEvent, "state" | "done" | "parts">): NoteRowStatus {
  if (event.state === "failed") return "failed";
  if (event.state !== "ready") return "reading";
  const { total } = eventProgress(event);
  return event.done && total > 0 ? "done" : "needsReview";
}
/** The most pressing reason, read only from recorded task data: confirmation, then missing details, then no owner. */
export function reviewReason(event: Pick<SharedCareEvent, "parts">): NoteRow["reason"] {
  const open = boardParts(event).filter((p) => taskState(p) !== "done");
  const pending = open.filter((p) => taskState(p) === "pending").length;
  if (pending > 0) return { kind: "pending", count: pending };
  const missing = open.filter((p) => (p.missingDetails?.length ?? 0) > 0).length;
  if (missing > 0) return { kind: "missing", count: missing };
  const unassigned = open.filter((p) => taskState(p) === "unassigned").length;
  return unassigned > 0 ? { kind: "unassigned", count: unassigned } : null;
}
export function noteRow(event: SharedCareEvent): NoteRow {
  const { done, total } = eventProgress(event);
  const status = noteStatus(event);
  return {
    noteId: event.noteId,
    title: event.title,
    createdAt: event.createdAt,
    status,
    done,
    total,
    reason: status === "needsReview" ? reviewReason(event) : null,
  };
}
