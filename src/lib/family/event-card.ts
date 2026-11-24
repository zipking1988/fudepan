import { parseAppointmentQuote } from "@/lib/care/appointment-quote";
import { isAwaitingApproval } from "@/lib/care/step-state";
import type { EventPart, MemberRef, SharedCareEvent } from "./shared-care-event";

/**
 * The picture-first summary of one Shared_Care_Event: what, when, where, who,
 * and the few things to bring or do. The family reads it in a glance and the
 * screen draws it with big numbers, icons and faces instead of sentences.
 * Pure: no I/O, no dictionary, so both the family card and Grandma's card use it.
 */
export type CardIcon = "clinic" | "medicine" | "car" | "card" | "money" | "phone" | "home" | "health";

const CATEGORY_ICON: Record<string, CardIcon> = {
  appointment: "clinic",
  medical: "health",
  medication: "medicine",
  transport: "car",
  document: "card",
  payment: "money",
  communication: "phone",
  household: "home",
};

export function iconFor(part: Pick<EventPart, "careCategory">): CardIcon {
  return CATEGORY_ICON[part.careCategory] ?? "home";
}

/**
 * When the main thing happens. `confirmed` is a time a family member confirmed
 * (with its zone). `fromNote` is only what the note itself says, shown with a
 * question mark until someone confirms it. Nothing else is ever shown.
 */
export type CardWhen =
  | { kind: "confirmed"; month: number; day: number; weekday: number; hour: number; minute: number; timeZone: string }
  | { kind: "fromNote"; month: number; day: number; weekday: number; hour: number | null; minute: number | null }
  | { kind: "unknown" };

export type SlotRole = "driver" | "companion" | "owner";
export type CardSlot = { role: SlotRole; member: MemberRef | null };

export type CardItem = {
  partId: string;
  icon: CardIcon;
  title: string;
  owner: MemberRef | null;
  done: boolean;
};

/** Read → find people → confirm → everything arranged ("ready") → done. */
export type CardStage = "reading" | "people" | "confirm" | "ready" | "done";

export type EventCard = {
  noteId: string;
  /** The part the card is about (the visit), or null while the note is still being read. */
  main: {
    partId: string;
    icon: CardIcon;
    title: string;
    when: CardWhen;
    /** Saved place, or null with the note's hint of whom to ask. */
    place: string | null;
    askPerson: string | null;
    slots: CardSlot[];
    awaitingConfirmation: boolean;
    done: boolean;
    status: "open" | "completed" | "cancelled";
    /** What the card still asks for. Every flag is false once the main Part is completed. */
    prompts: { timeUnknown: boolean; dateUnknown: boolean; placeUnknown: boolean; openSlots: boolean };
  } | null;
  items: CardItem[];
  stage: CardStage;
};

const CLOSED = new Set(["completed", "cancelled"]);
const isClosed = (p: EventPart) => CLOSED.has(p.progressStatus);
const isTravel = (p: EventPart) => p.careCategory === "appointment" || p.careCategory === "transport";

const isAppointment = (p: EventPart) => p.careCategory === "appointment";

/**
 * Main_Part_Rule: an appointment Part keeps the Main_Slot, also after it is
 * completed. Earliest open appointment, then first completed appointment, then
 * first appointment. Without an appointment: open travel, any open, any part.
 * Parts arrive in position order, so "earliest" is the first in that order.
 */
export function pickMainPart(parts: readonly EventPart[]): EventPart | null {
  const appointments = parts.filter(isAppointment);
  if (appointments.length > 0) {
    return (
      appointments.find((p) => !isClosed(p)) ??
      appointments.find((p) => p.progressStatus === "completed") ??
      appointments[0]
    );
  }
  const open = parts.filter((p) => !isClosed(p));
  return open.find(isTravel) ?? open[0] ?? parts[0] ?? null;
}

/** The previous order, kept for Grandma's "Coming up" card: open visit, open travel, open part, any visit, any part. */
export function pickNextOpenPart(parts: readonly EventPart[]): EventPart | null {
  const open = parts.filter((p) => !isClosed(p));
  return (
    open.find((p) => p.careCategory === "appointment") ??
    open.find(isTravel) ??
    open[0] ??
    parts.find((p) => p.careCategory === "appointment") ??
    parts[0] ??
    null
  );
}

function zonedParts(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdays.indexOf(get("weekday")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function whenOf(part: EventPart): CardWhen {
  const confirmed = part.confirmed.appointment;
  if (confirmed) {
    try {
      return { kind: "confirmed", timeZone: confirmed.timeZone, ...zonedParts(confirmed.at, confirmed.timeZone) };
    } catch {
      return { kind: "unknown" };
    }
  }
  const quoted = parseAppointmentQuote(part.sourceQuote);
  if (quoted) {
    const [y, m, d] = quoted.date.split("-").map(Number);
    const [hh, mm] = quoted.time.split(":").map(Number);
    return {
      kind: "fromNote",
      month: m,
      day: d,
      weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
      hour: hh,
      minute: mm,
    };
  }
  return { kind: "unknown" };
}

function slotsOf(part: EventPart): CardSlot[] {
  if (isTravel(part)) {
    return [
      { role: "driver", member: part.driver },
      { role: "companion", member: part.companion },
      { role: "owner", member: part.owner },
    ];
  }
  return [{ role: "owner", member: part.owner }];
}

function awaiting(part: EventPart): boolean {
  return isAwaitingApproval({
    approvalRequired: part.approvalRequired,
    status: part.progressStatus,
    approvalState: part.approvalState,
  });
}

function mainOf(part: EventPart): NonNullable<EventCard["main"]> {
  const when = whenOf(part);
  const status = part.progressStatus === "completed" ? "completed" : part.progressStatus === "cancelled" ? "cancelled" : "open";
  const allSlots = slotsOf(part);
  const completed = status === "completed";
  return {
    partId: part.id,
    icon: iconFor(part),
    title: part.title,
    when,
    place: part.location,
    askPerson: part.location ? null : part.personToAsk,
    slots: completed ? allSlots.filter((s) => s.member !== null) : allSlots,
    awaitingConfirmation: awaiting(part),
    done: isClosed(part),
    status,
    prompts: completed
      ? { timeUnknown: false, dateUnknown: false, placeUnknown: false, openSlots: false }
      : {
          timeUnknown: when.kind === "unknown",
          dateUnknown: when.kind === "unknown",
          placeUnknown: !part.location && isTravel(part),
          openSlots: allSlots.some((s) => s.member === null),
        },
  };
}

export function buildEventCard(event: SharedCareEvent, options: { mainRule?: "main" | "nextOpen" } = {}): EventCard {
  if (event.state !== "ready") {
    return { noteId: event.noteId, main: null, items: [], stage: "reading" };
  }
  const mainPart = options.mainRule === "nextOpen" ? pickNextOpenPart(event.parts) : pickMainPart(event.parts);
  const items: CardItem[] = event.parts
    .filter((p) => p.id !== mainPart?.id)
    .map((p) => ({ partId: p.id, icon: iconFor(p), title: p.title, owner: p.owner, done: isClosed(p) }));

  const open = event.parts.filter((p) => !isClosed(p));
  const peopleMissing =
    open.some((p) => p.owner === null) ||
    open.some((p) => p.missingDetails.length > 0) ||
    (mainPart !== null && !isClosed(mainPart) && isTravel(mainPart) && (!mainPart.driver || !mainPart.companion));
  const stage: CardStage = event.done
    ? "done"
    : peopleMissing
      ? "people"
      : event.parts.some(awaiting)
        ? "confirm"
        : "ready";

  return {
    noteId: event.noteId,
    main: mainPart ? mainOf(mainPart) : null,
    items,
    stage,
  };
}
