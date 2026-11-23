import type { TimelineEntry } from "@/lib/care/timeline";
import { isAwaitingApproval } from "@/lib/care/step-state";
import type { EventPart, MissingDetailView, SharedCareEvent } from "./shared-care-event";

/**
 * The Event_View as a family conversation.
 *
 * Grandma's photo is the first message, Fudepan answers with what it found,
 * each thing to do is a card in the thread, the missing details are asked one
 * at a time, and what family members did shows up as their messages. The
 * thread is built only from data that already exists (the event and its audit
 * Timeline), so nothing new is stored and nothing is invented: Fudepan's lines
 * are fixed sentences with counts, never generated text.
 */
export type ThreadItem =
  | { kind: "photo"; id: string; at: string; actorName: string | null }
  | { kind: "bot"; id: string; at: string | null; key: BotKey; params?: Record<string, string | number> }
  | { kind: "question"; id: string; partId: string; detail: MissingDetailView; remaining: number }
  | { kind: "part"; id: string; partId: string }
  | { kind: "activity"; id: string; entry: TimelineEntry; mine: boolean };

export type BotKey =
  | "thread.bot.reading"
  | "thread.bot.failed"
  | "thread.bot.found"
  | "thread.bot.foundNoMissing"
  | "thread.bot.allDone"
  | "thread.bot.stillNeeded"
  | "thread.bot.nothingNeeded"
  | "thread.bot.approvalReset";

/** Timeline events the thread already shows another way, or that are noise in a conversation. */
const HIDDEN_ACTIVITY = new Set([
  "note.uploaded",
  "extraction_started",
  "extraction_succeeded",
  "extraction_failed",
  "reminder.sent",
  "ambiguities_detected",
]);

const CLOSED = new Set(["completed", "cancelled"]);

function isClosed(part: EventPart): boolean {
  return CLOSED.has(part.progressStatus);
}

/** Open missing details in the order a family would answer them: Part order, then detail order. */
export function openQuestions(event: SharedCareEvent): { part: EventPart; detail: MissingDetailView }[] {
  return event.parts
    .filter((part) => !isClosed(part))
    .flatMap((part) => part.missingDetails.map((detail) => ({ part, detail })));
}

export type ThreadNeeds = { unclaimed: number; missing: number; awaitingConfirmation: number };

export function threadNeeds(event: SharedCareEvent): ThreadNeeds {
  const open = event.parts.filter((p) => !isClosed(p));
  return {
    unclaimed: open.filter((p) => p.owner === null).length,
    missing: openQuestions(event).length,
    awaitingConfirmation: event.parts.filter((p) =>
      isAwaitingApproval({ approvalRequired: p.approvalRequired, status: p.progressStatus, approvalState: p.approvalState }),
    ).length,
  };
}

export function buildThread(input: {
  event: SharedCareEvent;
  timeline: readonly TimelineEntry[];
  viewerName: string | null;
  /** How Fudepan names the person the note is for ("Haruko", "春子さん"). */
  recipientName?: string;
}): ThreadItem[] {
  const { event, timeline, viewerName } = input;
  const name = input.recipientName ?? "";
  const items: ThreadItem[] = [];
  const uploaded = timeline.find((e) => e.type === "note.uploaded");
  items.push({ kind: "photo", id: "photo", at: uploaded?.at ?? event.createdAt, actorName: uploaded?.actorName ?? null });

  if (event.state === "reading" || event.state === "uploaded") {
    items.push({ kind: "bot", id: "reading", at: null, key: "thread.bot.reading" });
    return items;
  }
  if (event.state === "failed") {
    items.push({ kind: "bot", id: "failed", at: null, key: "thread.bot.failed" });
    return items;
  }

  const read = timeline.find((e) => e.type === "extraction_succeeded");
  const questions = openQuestions(event);
  items.push({
    kind: "bot",
    id: "found",
    at: read?.at ?? null,
    key: questions.length > 0 ? "thread.bot.found" : "thread.bot.foundNoMissing",
    params: { name, count: event.parts.length, missing: questions.length },
  });

  // Step by step: only the first open question is asked; the rest wait their turn.
  const first = questions[0];
  if (first) {
    items.push({
      kind: "question",
      id: `question-${first.detail.key}`,
      partId: first.part.id,
      detail: first.detail,
      remaining: questions.length - 1,
    });
  }

  for (const part of event.parts) items.push({ kind: "part", id: `part-${part.id}`, partId: part.id });

  const afterRead = read ? timeline.filter((e) => e.at >= read.at && e.id !== read.id) : timeline;
  for (const entry of afterRead) {
    if (HIDDEN_ACTIVITY.has(entry.type)) continue;
    if (entry.type === "approval.reset") {
      items.push({ kind: "bot", id: `reset-${entry.id}`, at: entry.at, key: "thread.bot.approvalReset" });
      continue;
    }
    const mine = entry.actorType === "human" && viewerName !== null && entry.actorName === viewerName;
    items.push({ kind: "activity", id: entry.id, entry, mine });
  }

  if (event.done) {
    items.push({ kind: "bot", id: "status", at: null, key: "thread.bot.allDone", params: { name } });
  } else {
    const needs = threadNeeds(event);
    const anything = needs.unclaimed + needs.missing + needs.awaitingConfirmation > 0;
    items.push({
      kind: "bot",
      id: "status",
      at: null,
      key: anything ? "thread.bot.stillNeeded" : "thread.bot.nothingNeeded",
      params: { name, ...needs },
    });
  }
  return items;
}
