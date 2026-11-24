import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  arbMemberList,
  arbNow,
  arbSharedCareEvent,
  arbShuffled,
  arbViewer,
  event,
  part,
} from "./arbitraries.test-helpers";
import { buildEventCard } from "./event-card";
import { computeOffers, receiverOptionsFrom, type EventViewer, type ReceiverOption } from "./event-offers";
import {
  ACTION_ORDER,
  actionKey,
  arrangeActions,
  cardInlineActions,
  nextStep,
  shouldMoveFocus,
  type InlineAction,
  type InlineActionKind,
} from "./inline-actions";

const NOW = new Date("2026-11-25T00:00:00Z");
const primary: EventViewer = { memberId: "m1", householdId: "h1", role: "primary_caregiver" };
const members: ReceiverOption[] = [
  { id: "m1", name: "Kenta", role: "primary_caregiver" },
  { id: "m2", name: "Misa", role: "family_member" },
];

describe("cardInlineActions", () => {
  const visit = part("visit", {
    careCategory: "appointment",
    riskLevel: "high",
    approvalRequired: true,
    approvalState: "pending",
  });
  const glasses = part("glasses", { title: "Pick up glasses" });

  it("lists the Main_Slot Part first, then the items, each in the fixed action order", () => {
    const ev = event([glasses, visit]);
    const actions = cardInlineActions(ev, buildEventCard(ev), primary, members, NOW);
    expect(actions).toEqual([
      { kind: "confirm", partId: "visit", main: true },
      { kind: "knowPlace", partId: "visit", main: true },
      { kind: "drive", partId: "visit", main: true },
      { kind: "goAlong", partId: "visit", main: true },
      { kind: "handle", partId: "visit", main: true },
      { kind: "handle", partId: "glasses", main: false },
    ]);
  });

  it("offers a Care_Recipient nothing, and nothing on a note that is not read yet", () => {
    const ev = event([visit, glasses]);
    const recipient: EventViewer = { ...primary, role: "care_recipient" };
    expect(cardInlineActions(ev, buildEventCard(ev), recipient, members, NOW)).toEqual([]);
    const reading = event([], { state: "reading" });
    expect(cardInlineActions(reading, buildEventCard(reading), primary, members, NOW)).toEqual([]);
  });

  it("offers no clinic form once the place is saved", () => {
    const ev = event([{ ...visit, location: "Sakura Clinic" }]);
    const kinds = cardInlineActions(ev, buildEventCard(ev), primary, members, NOW).map((a) => a.kind);
    expect(kinds).not.toContain("knowPlace");
  });
});

describe("nextStep and arrangeActions", () => {
  it("puts Confirmed first, and an item's I'll do it before Done on the main Part", () => {
    const done: InlineAction = { kind: "done", partId: "visit", main: true };
    const item: InlineAction = { kind: "handle", partId: "glasses", main: false };
    const confirm: InlineAction = { kind: "confirm", partId: "visit", main: true };
    expect(nextStep([done, item])).toBe(item);
    expect(arrangeActions([done, item, confirm])).toEqual({ primary: confirm, secondary: [done, item] });
    expect(arrangeActions([])).toEqual({ primary: null, secondary: [] });
  });

  it("moves focus only when the activated action is gone", () => {
    const a: InlineAction = { kind: "drive", partId: "visit", main: true };
    expect(actionKey(a)).toBe("drive:visit");
    expect(shouldMoveFocus("drive:visit", ["goAlong:visit"])).toBe(true);
    expect(shouldMoveFocus("drive:visit", ["drive:visit"])).toBe(false);
  });
});

describe("receiverOptionsFrom", () => {
  it("keeps active members only, sorted by display name, then id", () => {
    expect(
      receiverOptionsFrom([
        { id: "b", displayName: "Misa", role: "family_member", isActive: true },
        { id: "z", displayName: "Kenta", role: "family_member", isActive: true },
        { id: "a", displayName: "Kenta", role: "primary_caregiver", isActive: true },
        { id: "c", displayName: "Aki", role: "family_member", isActive: false },
      ]),
    ).toEqual([
      { id: "a", name: "Kenta", role: "primary_caregiver" },
      { id: "z", name: "Kenta", role: "family_member" },
      { id: "b", name: "Misa", role: "family_member" },
    ]);
  });
});

const isClosed = (status: string) => status === "completed" || status === "cancelled";

describe("Feature: family-app-demo-parity, Property 21: Inline_Actions follow the Offer_Rules and are the same on both cards", () => {
  it("matches computeOffers for every shown Part, and does not depend on the member order", () => {
    fc.assert(
      fc.property(
        arbSharedCareEvent({ states: ["ready"] }),
        arbViewer,
        arbMemberList.chain((list) => fc.tuple(fc.constant(list), arbShuffled(list))),
        arbNow,
        (ev, viewer, [list, reordered], now) => {
          const card = buildEventCard(ev);
          const actions = cardInlineActions(ev, card, viewer, list, now);

          // Same result for every order of the member list.
          expect(cardInlineActions(ev, card, viewer, reordered, now)).toEqual(actions);

          if (viewer.role === "care_recipient" || !card.main) {
            expect(actions).toEqual([]);
            return;
          }

          const shown = [card.main.partId, ...card.items.map((i) => i.partId)];
          const expected: InlineAction[] = [];
          for (const id of shown) {
            const p = ev.parts.find((x) => x.id === id)!;
            if (isClosed(String(p.progressStatus))) continue;
            const offers = computeOffers(p, viewer, list, now);
            const main = id === card.main.partId;
            const offered: Record<InlineActionKind, boolean> = {
              confirm: offers.approve,
              knowPlace: main && p.careCategory === "appointment" && !p.location,
              drive: offers.claim.includes("driver"),
              goAlong: offers.claim.includes("companion"),
              handle: offers.claim.includes("owner"),
              done: offers.complete,
            };
            for (const kind of ACTION_ORDER) if (offered[kind]) expected.push({ kind, partId: id, main });
          }
          expect(actions).toEqual(expected);

          // No action on a completed or cancelled Part.
          for (const a of actions) {
            const p = ev.parts.find((x) => x.id === a.partId)!;
            expect(isClosed(String(p.progressStatus))).toBe(false);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

const arbAction: fc.Arbitrary<InlineAction> = fc.record({
  kind: fc.constantFrom(...ACTION_ORDER),
  partId: fc.constantFrom("p0", "p1", "p2"),
  main: fc.boolean(),
});

function deepFreeze(actions: InlineAction[]): readonly InlineAction[] {
  for (const a of actions) Object.freeze(a);
  return Object.freeze(actions);
}

/** Reference: rank each action by the Requirement 23.1 order; the lowest rank wins, then the earliest. */
function rank(a: InlineAction): number {
  if (a.main) {
    const order: InlineActionKind[] = ["confirm", "knowPlace", "drive", "goAlong", "handle"];
    const i = order.indexOf(a.kind);
    if (i >= 0) return i;
    if (a.kind === "done") return 6;
    return Number.POSITIVE_INFINITY;
  }
  return a.kind === "handle" ? 5 : Number.POSITIVE_INFINITY;
}

function expectedIndex(actions: readonly InlineAction[]): number {
  let best = -1;
  actions.forEach((a, i) => {
    if (rank(a) !== Number.POSITIVE_INFINITY && (best === -1 || rank(a) < rank(actions[best]))) best = i;
  });
  return best;
}

describe("Feature: family-app-demo-parity, Property 22: The Next_Step follows the fixed order and changes nothing", () => {
  it("picks the first match in the fixed order, keeps the input, and lists every other action once", () => {
    fc.assert(
      fc.property(fc.array(arbAction, { maxLength: 12 }), (raw) => {
        const snapshot = JSON.stringify(raw);
        const actions = deepFreeze(raw);
        const at = expectedIndex(actions);

        const step = nextStep(actions);
        expect(step).toBe(at === -1 ? null : actions[at]);
        // Equal inputs give equal results.
        expect(nextStep(structuredClone(raw))).toEqual(step);

        const arranged = arrangeActions(actions);
        expect(arranged.primary).toBe(step);
        expect(arranged.secondary).toEqual(actions.filter((_, i) => i !== at));
        expect(arranged.secondary.length + (arranged.primary ? 1 : 0)).toBe(actions.length);

        // Highlighting changes nothing.
        expect(JSON.stringify(actions)).toBe(snapshot);
      }),
      { numRuns: 300 },
    );
  });
});
