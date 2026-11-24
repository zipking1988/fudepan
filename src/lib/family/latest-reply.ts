/**
 * The care recipient's recorded replies on one note ("Thank you" or "I have a question").
 *
 * Pure: reads Timeline entries that were already loaded with the viewer's RLS client. Only the
 * fixed reply code is used; a reply never carries free text. The name already has the "(left the
 * household)" suffix when the sender is a former member.
 */
import type { TimelineEntry } from "@/lib/care/timeline";

export type RecipientReplyCode = "thanks" | "question";

export type LatestReplyView = { id: string; reply: RecipientReplyCode; name: string | null; at: string };

function isReply(value: unknown): value is RecipientReplyCode {
  return value === "thanks" || value === "question";
}

/** Every recorded reply, newest first. */
export function recipientReplies(timeline: readonly TimelineEntry[]): LatestReplyView[] {
  return timeline
    .filter((e) => e.type === "recipient.replied" && isReply(e.params.reply))
    .map((e) => ({ id: e.id, reply: e.params.reply as RecipientReplyCode, name: e.actorName, at: e.at }))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
}

export function latestReply(timeline: readonly TimelineEntry[]): LatestReplyView | null {
  return recipientReplies(timeline)[0] ?? null;
}
