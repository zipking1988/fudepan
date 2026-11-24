import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildEventCard, iconFor, pickMainPart, pickNextOpenPart, whenOf } from "./event-card";
import type { EventPart, SharedCareEvent } from "./shared-care-event";

/** The Alpha QA note. Fake data. */
const noTimes = { appointment: null, respondBy: null, taskDue: null };

function part(id: string, overrides: Partial<EventPart> = {}): EventPart {
  return {
    id,
    title: id,
    description: null,
    careCategory: "household",
    riskLevel: "low",
    progressStatus: "pending_review",
    sourceQuote: null,
    confidence: 0.9,
    approvalRequired: false,
    approvalState: "not_required",
    planVersion: 0,
    owner: null,
    driver: null,
    companion: null,
    backup: null,
    suggestedRole: null,
    personToAsk: null,
    location: null,
    confirmed: noTimes,
    suggested: noTimes,
    hasRequiredAmount: false,
    pendingRequests: [],
    missingDetails: [],
    evidence: { required: [], attachedCount: 0, attached: [] },
    ...overrides,
  };
}

const visit = part("visit", {
  title: "Attend clinic visit at 2:30 pm",
  careCategory: "appointment",
  riskLevel: "high",
  approvalRequired: true,
  approvalState: "pending",
  sourceQuote: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm.",
  personToAsk: "Misa",
});
const card = part("card", { title: "Bring insurance card", careCategory: "document" });
const glasses = part("glasses", { title: "Pick up glasses" });

function event(parts: EventPart[], overrides: Partial<SharedCareEvent> = {}): SharedCareEvent {
  return {
    noteId: "n1",
    householdId: "h1",
    state: "ready",
    retryable: false,
    failureReason: null,
    chainId: "c1",
    title: "Clinic visit",
    riskLevel: "high",
    createdAt: "2026-11-23T11:50:20Z",
    parts,
    done: false,
    ...overrides,
  };
}

describe("buildEventCard", () => {
  it("makes the clinic visit the main thing and the rest small tiles", () => {
    const c = buildEventCard(event([card, glasses, visit]));
    expect(c.main?.partId).toBe("visit");
    expect(c.main?.icon).toBe("clinic");
    expect(c.items.map((i) => [i.partId, i.icon])).toEqual([
      ["card", "card"],
      ["glasses", "home"],
    ]);
  });

  it("takes the date and time from the note's own words, marked as not yet confirmed", () => {
    expect(whenOf(visit)).toEqual({ kind: "fromNote", month: 11, day: 27, weekday: 5, hour: 14, minute: 30 });
  });

  it("prefers a family-confirmed time, read in its own zone", () => {
    const confirmed = { ...visit, confirmed: { ...noTimes, appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" as const } } };
    expect(whenOf(confirmed)).toEqual({ kind: "confirmed", month: 11, day: 27, weekday: 5, hour: 14, minute: 30, timeZone: "Asia/Tokyo" });
  });

  it("never invents a time when the note has none", () => {
    expect(whenOf(part("x", { sourceQuote: "Clinic next week" }))).toEqual({ kind: "unknown" });
  });

  it("shows empty seats for driver, companion and owner, and the hint of whom to ask", () => {
    const c = buildEventCard(event([visit, card]));
    expect(c.main?.slots).toEqual([
      { role: "driver", member: null },
      { role: "companion", member: null },
      { role: "owner", member: null },
    ]);
    expect(c.main?.place).toBeNull();
    expect(c.main?.askPerson).toBe("Misa"); // a hint only; nobody is assigned
    expect(c.main?.awaitingConfirmation).toBe(true);
    expect(c.stage).toBe("people");
  });

  it("moves to confirm once everyone is found, and to ready once confirmed", () => {
    const kenta = { id: "m1", name: "Kenta" };
    const staffed = { ...visit, owner: kenta, driver: kenta, companion: { id: "m2", name: "Misa" }, location: "Sakura Clinic" };
    const others = [{ ...card, owner: kenta }, { ...glasses, owner: kenta }];
    expect(buildEventCard(event([staffed, ...others])).stage).toBe("confirm");
    expect(buildEventCard(event([{ ...staffed, approvalState: "approved" }, ...others])).stage).toBe("ready");
    expect(buildEventCard(event([staffed, ...others], { done: true })).stage).toBe("done");
  });

  it("while the note is being read, has nothing to show but the reading stage", () => {
    expect(buildEventCard(event([], { state: "reading" }))).toEqual({ noteId: "n1", main: null, items: [], stage: "reading" });
  });

  it("picks an open visit before a finished one", () => {
    const doneVisit = { ...visit, id: "old", progressStatus: "completed" };
    expect(pickMainPart([doneVisit, glasses, visit])?.id).toBe("visit");
    expect(iconFor({ careCategory: "medication" })).toBe("medicine");
  });
});

const CATEGORIES = ["appointment", "transport", "medical", "medication", "document", "payment", "communication", "household"] as const;
const STATUSES = ["pending_review", "in_progress", "completed", "cancelled"] as const;
const isClosedStatus = (p: EventPart) => p.progressStatus === "completed" || p.progressStatus === "cancelled";

/** The order before the Main_Part_Rule, kept as the reference for Property 19. */
function oldPickMainPart(parts: readonly EventPart[]): EventPart | null {
  const open = parts.filter((p) => !isClosedStatus(p));
  const travel = (p: EventPart) => p.careCategory === "appointment" || p.careCategory === "transport";
  return (
    open.find((p) => p.careCategory === "appointment") ??
    open.find(travel) ??
    open[0] ??
    parts.find((p) => p.careCategory === "appointment") ??
    parts[0] ??
    null
  );
}

const arbPart = (index: number): fc.Arbitrary<EventPart> =>
  fc
    .record({
      careCategory: fc.constantFrom(...CATEGORIES),
      progressStatus: fc.constantFrom(...STATUSES),
      time: fc.boolean(),
      located: fc.boolean(),
      staffed: fc.boolean(),
    })
    .map(({ careCategory, progressStatus, time, located, staffed }) =>
      part(`p${index}`, {
        careCategory,
        progressStatus,
        location: located ? "Sakura Clinic" : null,
        confirmed: time
          ? { ...noTimes, appointment: { at: "2026-11-27T05:30:00Z", timeZone: "Asia/Tokyo", provenance: "human_confirmed" } }
          : noTimes,
        owner: staffed ? { id: "m1", name: "Kenta" } : null,
        driver: staffed ? { id: "m1", name: "Kenta" } : null,
        companion: staffed ? { id: "m2", name: "Misa" } : null,
      }),
    );

const arbParts = fc
  .integer({ min: 0, max: 7 })
  .chain((n) => (n === 0 ? fc.constant<EventPart[]>([]) : fc.tuple(...Array.from({ length: n }, (_, i) => arbPart(i)))));

describe("Feature: family-app-demo-parity, Property 19: The Main_Part_Rule keeps the appointment in the Main_Slot", () => {
  it("prefers open, then completed, then any appointment, and otherwise matches the old order", () => {
    fc.assert(
      fc.property(arbParts, (parts) => {
        const picked = pickMainPart(parts);
        const appointments = parts.filter((p) => p.careCategory === "appointment");
        if (parts.length === 0) return picked === null;
        if (appointments.length === 0) return picked === oldPickMainPart(parts);
        const expected =
          appointments.find((p) => !isClosedStatus(p)) ??
          appointments.find((p) => p.progressStatus === "completed") ??
          appointments[0];
        return picked === expected && picked?.careCategory === "appointment";
      }),
      { numRuns: 200 },
    );
  });

  it("keeps pickNextOpenPart identical to the old order", () => {
    fc.assert(fc.property(arbParts, (parts) => pickNextOpenPart(parts) === oldPickMainPart(parts)), { numRuns: 200 });
  });

  it("buildEventCard uses the main rule by default and the old order for mainRule nextOpen", () => {
    fc.assert(
      fc.property(arbParts, (parts) => {
        const ev = event(parts);
        return (
          buildEventCard(ev).main?.partId === (pickMainPart(parts)?.id ?? undefined) &&
          buildEventCard(ev, { mainRule: "nextOpen" }).main?.partId === (oldPickMainPart(parts)?.id ?? undefined)
        );
      }),
      { numRuns: 200 },
    );
  });
});

describe("Feature: family-app-demo-parity, Property 20: A completed main Part shows Done without open prompts, and every other Part stays listed", () => {
  it("has no prompts, only filled slots, and lists every other Part with its own done state", () => {
    fc.assert(
      fc.property(arbParts, (parts) => {
        const card = buildEventCard(event(parts));
        if (!card.main) return parts.length === 0;
        const main = parts.find((p) => p.id === card.main!.partId)!;
        const others = parts.filter((p) => p !== main);
        const listed =
          card.items.length === others.length &&
          others.every((o) => card.items.some((i) => i.partId === o.id && i.done === isClosedStatus(o)));
        if (main.progressStatus !== "completed") return listed;
        return (
          listed &&
          card.main.status === "completed" &&
          Object.values(card.main.prompts).every((v) => v === false) &&
          card.main.slots.every((s) => s.member !== null) &&
          JSON.stringify(card.main.when) === JSON.stringify(whenOf(main))
        );
      }),
      { numRuns: 200 },
    );
  });
});
