/**
 * Warm_Copy line builders (family-app-demo-parity design, "Pure modules";
 * Requirements 23.5, 25.1, 25.3, 25.8, 25.10, 27.3).
 *
 * Pure: no I/O, no dictionary. A line is a fixed dictionary key plus fills. The fills are only
 * the Care_Recipient_Name, a helper's first name, and a Part title, so no sentence is ever
 * generated, and no line counts, ranks, or blames anyone.
 */
import type { CardSlot, EventCard, SlotRole } from "./event-card";
import type { InlineActionKind } from "./inline-actions";
import { firstName } from "./names";
import type { MemberRef, SharedCareEvent } from "./shared-care-event";

/** Every key that `cardWarmLines` returns. */
export const WARM_KEYS = [
  "warm.need.drive.clinic",
  "warm.need.drive.clinic.noName",
  "warm.need.drive",
  "warm.need.drive.noName",
  "warm.need.goAlong.clinic",
  "warm.need.goAlong.clinic.noName",
  "warm.need.goAlong",
  "warm.need.goAlong.noName",
  "warm.need.handle",
  "warm.need.handle.noName",
  "warm.helping.drive",
  "warm.helping.goAlong",
  "warm.helping.handle",
  "warm.helping.you.drive",
  "warm.helping.you.goAlong",
  "warm.helping.you.handle",
  "warm.item.need",
  "warm.item.helping",
  "warm.item.you",
] as const;
export type WarmKey = (typeof WARM_KEYS)[number];

/** Every key that `ackLine` returns. */
export const ACK_KEYS = [
  "ack.confirm",
  "ack.confirm.noName",
  "ack.knowPlace",
  "ack.knowPlace.noName",
  "ack.drive",
  "ack.drive.noName",
  "ack.goAlong",
  "ack.goAlong.noName",
  "ack.handle",
  "ack.handle.noName",
  "ack.done",
  "ack.done.noName",
] as const;
export type AckKey = (typeof ACK_KEYS)[number];

export type WarmParams = { name?: string; helper?: string; title?: string };

/** One Warm_Copy sentence about one helper slot of one Part. */
export type WarmLine = { partId: string; slot: SlotRole; key: WarmKey; params: WarmParams };

/** The sentence of one warm line in the reader's language. Only the line's own fills are used. */
export function warmText(line: Pick<WarmLine, "key" | "params">, tr: { t: (key: WarmKey | AckKey, params?: Record<string, string>) => string }): string {
  return tr.t(line.key, line.params);
}

/** A blank Care_Recipient_Name counts as absent, so the neutral form is used (Requirement 25.8). */
export function presentName(name: string | null | undefined): string | null {
  return name != null && name.trim() !== "" ? name : null;
}

type NeedKeys = { named: WarmKey; noName: WarmKey };

/** Need keys for an empty Driver or Companion slot of the Main_Slot Part. */
const TRAVEL_NEED: Record<"driver" | "companion", { clinic: NeedKeys; other: NeedKeys }> = {
  driver: {
    clinic: { named: "warm.need.drive.clinic", noName: "warm.need.drive.clinic.noName" },
    other: { named: "warm.need.drive", noName: "warm.need.drive.noName" },
  },
  companion: {
    clinic: { named: "warm.need.goAlong.clinic", noName: "warm.need.goAlong.clinic.noName" },
    other: { named: "warm.need.goAlong", noName: "warm.need.goAlong.noName" },
  },
};

const MAIN_HELPING: Record<SlotRole, { other: WarmKey; you: WarmKey }> = {
  driver: { other: "warm.helping.drive", you: "warm.helping.you.drive" },
  companion: { other: "warm.helping.goAlong", you: "warm.helping.you.goAlong" },
  owner: { other: "warm.helping.handle", you: "warm.helping.you.handle" },
};

type MainContext = {
  partId: string;
  title: string;
  clinic: boolean;
  viewerId: string;
  name: string | null;
};

function mainLine(slot: CardSlot, ctx: MainContext): WarmLine {
  const { partId, title, clinic, viewerId, name } = ctx;
  const holder: MemberRef | null = slot.member;
  const line = (key: WarmKey, params: WarmParams): WarmLine => ({
    partId,
    slot: slot.role,
    key,
    params,
  });
  if (holder === null) {
    if (slot.role === "owner") {
      return name === null
        ? line("warm.need.handle.noName", { title })
        : line("warm.need.handle", { name, title });
    }
    const keys = TRAVEL_NEED[slot.role][clinic ? "clinic" : "other"];
    return name === null ? line(keys.noName, {}) : line(keys.named, { name });
  }
  const withTitle = slot.role === "owner" ? { title } : {};
  if (holder.id === viewerId) return line(MAIN_HELPING[slot.role].you, withTitle);
  return line(MAIN_HELPING[slot.role].other, { helper: firstName(holder.name), ...withTitle });
}

/**
 * The warm lines of one card. The Main_Slot gets one line per helper slot while its Part is
 * open; each open item Part gets one line about its Owner. Closed Parts get no line.
 */
export function cardWarmLines(input: {
  event: SharedCareEvent;
  card: EventCard;
  viewerId: string;
  recipientName: string | null;
}): WarmLine[] {
  const { event, card, viewerId } = input;
  const name = presentName(input.recipientName);
  const lines: WarmLine[] = [];

  const main = card.main;
  if (main && main.status === "open") {
    const part = event.parts.find((p) => p.id === main.partId);
    const ctx: MainContext = {
      partId: main.partId,
      title: main.title,
      clinic: part?.careCategory === "appointment",
      viewerId,
      name,
    };
    for (const slot of main.slots) lines.push(mainLine(slot, ctx));
  }

  for (const item of card.items) {
    if (item.done) continue;
    const owner = item.owner;
    const base = { partId: item.partId, slot: "owner" as const };
    if (owner === null) lines.push({ ...base, key: "warm.item.need", params: {} });
    else if (owner.id === viewerId) lines.push({ ...base, key: "warm.item.you", params: {} });
    else
      lines.push({ ...base, key: "warm.item.helping", params: { helper: firstName(owner.name) } });
  }
  return lines;
}

const ACK: Record<InlineActionKind, { named: AckKey; noName: AckKey }> = {
  confirm: { named: "ack.confirm", noName: "ack.confirm.noName" },
  knowPlace: { named: "ack.knowPlace", noName: "ack.knowPlace.noName" },
  drive: { named: "ack.drive", noName: "ack.drive.noName" },
  goAlong: { named: "ack.goAlong", noName: "ack.goAlong.noName" },
  handle: { named: "ack.handle", noName: "ack.handle.noName" },
  done: { named: "ack.done", noName: "ack.done.noName" },
};

/** The Acknowledgment after an Inline_Action succeeds, with the neutral form when there is no name. */
export function ackLine(
  kind: InlineActionKind,
  input: { recipientName: string | null; title: string },
): { key: AckKey; params: { name?: string; title: string } } {
  const name = presentName(input.recipientName);
  return name === null
    ? { key: ACK[kind].noName, params: { title: input.title } }
    : { key: ACK[kind].named, params: { name, title: input.title } };
}
