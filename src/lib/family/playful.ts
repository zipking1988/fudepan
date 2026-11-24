/**
 * Pure helpers for the Playful Dashboard Beta screens.
 *
 * No I/O, no clock, no dictionary. Everything here is derived from a Shared_Care_Event the
 * viewer's own RLS client already loaded, so the screens show only recorded facts: who owns a
 * task, what is confirmed, what is done. Nothing here assigns a person or approves anything.
 */
import { effectiveApprovalState } from "@/lib/care/rules/approval";
import { iconFor, pickMainPart, type CardIcon } from "./event-card";
import { isClosedPart } from "./dashboard";
import type { EventPart, MemberRef, SharedCareEvent } from "./shared-care-event";

/** The fictional demo household seeded by supabase/seed.sql (local development only). */
export const DEMO_HOUSEHOLD_ID = "d0000000-0000-4000-8000-000000000001";

const DEMO_PORTRAITS: Readonly<Record<string, string>> = {
  "d2000000-0000-4000-8000-000000000001": "/landing/grandma-smile.png",
  "d2000000-0000-4000-8000-000000000002": "/landing/misa.png",
  "d2000000-0000-4000-8000-000000000003": "/landing/kenta.png",
  "d2000000-0000-4000-8000-000000000004": "/landing/yui.png",
};

/**
 * A portrait only for the seeded fictional demo family. Real households have no stored member
 * photos, so everyone else shows their initial. Never guesses from a display name.
 */
export function portraitFor(householdId: string | null | undefined, memberId: string | null | undefined): string | null {
  if (householdId !== DEMO_HOUSEHOLD_ID || !memberId) return null;
  return DEMO_PORTRAITS[memberId] ?? null;
}

export type TaskState = "done" | "pending" | "unassigned" | "owned";

export type TaskView = {
  partId: string;
  title: string;
  icon: CardIcon;
  state: TaskState;
  travel: boolean;
  owner: MemberRef | null;
  driver: MemberRef | null;
  companion: MemberRef | null;
  place: string | null;
  isMain: boolean;
};

/** Parts that still count: a cancelled Part is not shown on the board and not in the progress. */
export function boardParts(event: Pick<SharedCareEvent, "parts">): EventPart[] {
  return event.parts.filter((p) => p.progressStatus !== "cancelled");
}

export function taskState(part: EventPart): TaskState {
  if (part.progressStatus === "completed") return "done";
  const approval = effectiveApprovalState({
    approvalRequired: part.approvalRequired,
    storedApprovalState: part.approvalState,
    legacyStatus: String(part.progressStatus),
  });
  if (!isClosedPart(part) && part.approvalRequired && approval === "pending") return "pending";
  return part.owner ? "owned" : "unassigned";
}

export function taskViews(event: Pick<SharedCareEvent, "parts">): TaskView[] {
  const main = pickMainPart(event.parts as EventPart[]);
  return boardParts(event).map((p) => ({
    partId: p.id,
    title: p.title,
    icon: iconFor(p),
    state: taskState(p),
    travel: p.careCategory === "appointment" || p.careCategory === "transport",
    owner: p.owner,
    driver: p.driver,
    companion: p.companion,
    place: p.location,
    isMain: p.id === main?.id,
  }));
}

/** Width of each progress segment: one per counted task, so any number of tasks works. */
export function segmentStates(done: number, total: number): boolean[] {
  return Array.from({ length: Math.max(0, total) }, (_, i) => i < done);
}

/** The local-storage key that remembers the one-shot celebration of one note. */
export function celebrationKey(noteId: string): string {
  return `fudepan:celebrated:${noteId}`;
}

/** First letter for a photo-less avatar. */
export function initialOf(name: string | null | undefined): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}
