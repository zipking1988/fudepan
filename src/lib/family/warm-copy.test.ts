import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbSharedCareEvent, event, MEMBER_IDS, part } from "./arbitraries.test-helpers";
import { buildEventCard } from "./event-card";
import { ACTION_ORDER } from "./inline-actions";
import { firstName } from "./names";
import { ACK_KEYS, ackLine, cardWarmLines, WARM_KEYS, type WarmLine } from "./warm-copy";

const kenta = { id: "m1", name: "Kenta (son)" };

describe("cardWarmLines", () => {
  it("invites help by name for each empty seat and names who is already helping", () => {
    const visit = part("visit", { title: "Clinic visit", careCategory: "appointment", driver: kenta });
    const glasses = part("glasses", { title: "Pick up glasses" });
    const ev = event([visit, glasses]);
    const lines = cardWarmLines({ event: ev, card: buildEventCard(ev), viewerId: "m2", recipientName: "Haruko" });
    expect(lines).toEqual([
      { partId: "visit", slot: "driver", key: "warm.helping.drive", params: { helper: "Kenta" } },
      { partId: "visit", slot: "companion", key: "warm.need.goAlong.clinic", params: { name: "Haruko" } },
      { partId: "visit", slot: "owner", key: "warm.need.handle", params: { name: "Haruko", title: "Clinic visit" } },
      { partId: "glasses", slot: "owner", key: "warm.item.need", params: {} },
    ]);
  });

  it("uses the neutral form without a name, and the 'you' form for the viewer", () => {
    const ride = part("ride", { title: "Ride home", careCategory: "transport", driver: kenta });
    const ev = event([ride]);
    const lines = cardWarmLines({ event: ev, card: buildEventCard(ev), viewerId: "m1", recipientName: null });
    expect(lines.map((l) => l.key)).toEqual(["warm.helping.you.drive", "warm.need.goAlong.noName", "warm.need.handle.noName"]);
  });
});

describe("ackLine", () => {
  it("thanks by name, or in the neutral form", () => {
    expect(ackLine("drive", { recipientName: "Haruko", title: "Clinic visit" })).toEqual({
      key: "ack.drive",
      params: { name: "Haruko", title: "Clinic visit" },
    });
    expect(ackLine("done", { recipientName: null, title: "Clinic visit" })).toEqual({
      key: "ack.done.noName",
      params: { title: "Clinic visit" },
    });
    for (const kind of ACTION_ORDER) {
      expect(ACK_KEYS).toContain(ackLine(kind, { recipientName: "Haruko", title: "x" }).key);
      expect(ACK_KEYS).toContain(ackLine(kind, { recipientName: null, title: "x" }).key);
    }
  });
});

/** Need keys that take `{name}`; each has a `.noName` twin. */
const NAMED_NEED = /^warm\.need\./;
const isAbsent = (name: string | null) => name === null || name.trim() === "";

const arbReady = arbSharedCareEvent({ states: ["ready"] });
const arbOpenMain = arbReady.filter((ev) => buildEventCard(ev).main?.status === "open");
const arbRecipientName = fc.option(fc.oneof(fc.constantFrom("Haruko", "春子", "おばあちゃん"), fc.string()), { nil: null });

describe("Feature: family-app-demo-parity, Property 25: Warm lines match the card's open needs and helpers", () => {
  it("has one line per Main_Slot seat and per open item, with need, helping, or 'you' as the seat says", () => {
    fc.assert(
      fc.property(arbOpenMain, arbRecipientName, fc.constantFrom(...MEMBER_IDS), (ev, recipientName, viewerId) => {
        const card = buildEventCard(ev);
        const main = card.main!;
        const lines = cardWarmLines({ event: ev, card, viewerId, recipientName });

        const seats = [
          ...main.slots.map((s) => ({ partId: main.partId, slot: s.role, holder: s.member, main: true })),
          ...card.items.filter((i) => !i.done).map((i) => ({ partId: i.partId, slot: "owner" as const, holder: i.owner, main: false })),
        ];
        expect(lines.map((l) => [l.partId, l.slot])).toEqual(seats.map((s) => [s.partId, s.slot]));

        const titles = new Set(ev.parts.map((p) => p.title));
        seats.forEach((seat, i) => {
          const line: WarmLine = lines[i];
          expect(WARM_KEYS).toContain(line.key);
          if (seat.holder === null) {
            expect(line.key.startsWith(seat.main ? "warm.need." : "warm.item.need")).toBe(true);
          } else if (seat.holder.id === viewerId) {
            expect(line.key.startsWith(seat.main ? "warm.helping.you." : "warm.item.you")).toBe(true);
            expect(line.params.helper).toBeUndefined();
          } else {
            expect(line.key.startsWith(seat.main ? "warm.helping." : "warm.item.helping")).toBe(true);
            expect(line.key.includes(".you.")).toBe(false);
            expect(line.params.helper).toBe(firstName(seat.holder.name));
          }
          if (NAMED_NEED.test(line.key)) {
            expect(line.key.endsWith(".noName")).toBe(isAbsent(recipientName));
          }
          // Fills are only the Care_Recipient_Name, a holder's first name, and a Part title.
          if (line.params.name !== undefined) expect(line.params.name).toBe(recipientName);
          if (line.params.title !== undefined) expect(titles.has(line.params.title)).toBe(true);
          expect(Object.keys(line.params).every((k) => ["name", "helper", "title"].includes(k))).toBe(true);
        });
      }),
      { numRuns: 200 },
    );
  });

  it("gives no main line while the Main_Slot Part is closed, and no line for a closed item Part", () => {
    fc.assert(
      fc.property(arbReady, arbRecipientName, fc.constantFrom(...MEMBER_IDS), (ev, recipientName, viewerId) => {
        const card = buildEventCard(ev);
        const lines = cardWarmLines({ event: ev, card, viewerId, recipientName });
        if (card.main && card.main.status !== "open") {
          expect(lines.some((l) => l.partId === card.main!.partId)).toBe(false);
        }
        for (const item of card.items.filter((i) => i.done)) {
          expect(lines.some((l) => l.partId === item.partId)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });
});
