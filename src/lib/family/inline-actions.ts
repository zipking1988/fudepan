/**
 * Inline_Actions: the one-tap actions a card offers one person, and the Next_Step among them.
 *
 * Pure: no I/O, no clock (callers pass `now`). Every action comes from `computeOffers`, which
 * uses the same rule module as the server, so a card never offers what the rules would refuse.
 * The server stays the authority and re-checks every action. Highlighting the Next_Step changes
 * nothing: it is only the order in which buttons are shown.
 */
import type { EventCard } from "./event-card";
import { computeOffers, type EventViewer, type ReceiverOption } from "./event-offers";
import type { SharedCareEvent } from "./shared-care-event";

export type InlineActionKind = "confirm" | "knowPlace" | "drive" | "goAlong" | "handle" | "done";

/** The fixed order of actions within one Part. */
export const ACTION_ORDER: readonly InlineActionKind[] = ["confirm", "knowPlace", "drive", "goAlong", "handle", "done"];

/** `main` is true for the Main_Slot Part, false for an item Part. */
export type InlineAction = { kind: InlineActionKind; partId: string; main: boolean };

const CLOSED = new Set(["completed", "cancelled"]);

/** A stable key for one action, for React keys and focus handling. */
export function actionKey(action: Pick<InlineAction, "kind" | "partId">): string {
  return `${action.kind}:${action.partId}`;
}

/**
 * The actions of one card: the Main_Slot Part first, then the item Parts in card order, each in
 * `ACTION_ORDER`. Nothing for a Care_Recipient, for a note that is not read yet, or on a Part that
 * is completed or cancelled. "I know the clinic" opens the place form on an open appointment
 * without a saved place.
 */
export function cardInlineActions(
  event: SharedCareEvent,
  card: EventCard,
  viewer: EventViewer,
  members: readonly ReceiverOption[],
  now: Date,
): InlineAction[] {
  if (event.state !== "ready" || viewer.role === "care_recipient" || !card.main) return [];
  const ids = [card.main.partId, ...card.items.map((i) => i.partId)];
  const out: InlineAction[] = [];
  for (const id of ids) {
    const part = event.parts.find((p) => p.id === id);
    if (!part || CLOSED.has(String(part.progressStatus))) continue;
    const main = id === card.main.partId;
    const offers = computeOffers(part, viewer, members, now);
    const offered: Record<InlineActionKind, boolean> = {
      confirm: offers.approve,
      knowPlace: main && part.careCategory === "appointment" && !part.location,
      drive: offers.claim.includes("driver"),
      goAlong: offers.claim.includes("companion"),
      handle: offers.claim.includes("owner"),
      done: offers.complete,
    };
    for (const kind of ACTION_ORDER) if (offered[kind]) out.push({ kind, partId: id, main });
  }
  return out;
}

/** Main Part: confirm, place, drive, go along, take charge; then an item's "I'll do it"; then done. */
const MAIN_RANK: Partial<Record<InlineActionKind, number>> = {
  confirm: 0,
  knowPlace: 1,
  drive: 2,
  goAlong: 3,
  handle: 4,
  done: 6,
};
const ITEM_RANK: Partial<Record<InlineActionKind, number>> = { handle: 5 };

function rank(action: InlineAction): number {
  return (action.main ? MAIN_RANK : ITEM_RANK)[action.kind] ?? Number.POSITIVE_INFINITY;
}

/**
 * The Next_Step: the action with the lowest rank, the earliest one on a tie. Null when no action
 * qualifies. The input is never changed.
 */
export function nextStep(actions: readonly InlineAction[]): InlineAction | null {
  let best: InlineAction | null = null;
  for (const action of actions) {
    const r = rank(action);
    if (r === Number.POSITIVE_INFINITY) continue;
    if (best === null || r < rank(best)) best = action;
  }
  return best;
}

/** The Next_Step as the primary button and every other action once, in input order. */
export function arrangeActions(actions: readonly InlineAction[]): {
  primary: InlineAction | null;
  secondary: InlineAction[];
} {
  const primary = nextStep(actions);
  const at = primary === null ? -1 : actions.indexOf(primary);
  return { primary, secondary: actions.filter((_, i) => i !== at) };
}

/** After an action ran, focus moves only when the activated button is gone. */
export function shouldMoveFocus(activatedKey: string, remainingKeys: readonly string[]): boolean {
  return !remainingKeys.includes(activatedKey);
}
