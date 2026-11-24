import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { arbEvents, event, MEMBER_IDS, MEMBERS, part } from "./arbitraries.test-helpers";
import { helpersStrip, type HelperEntry } from "./helpers-strip";
import { firstName } from "./names";
import type { MemberRef, SharedCareEvent } from "./shared-care-event";

const kenta = { id: "m1", name: "Kenta" };
const misa = { id: "m2", name: "Misa (daughter)" };

describe("helpersStrip", () => {
  it("shows each helping member once with what they do, and leaves out backups", () => {
    const visit = part("visit", { title: "Clinic visit", careCategory: "appointment", driver: kenta, companion: misa, backup: misa });
    const card = part("card", { title: "Bring insurance card", careCategory: "document", owner: kenta });
    const strip = helpersStrip([event([visit, card])], new Set(["m1", "m2"]), "m2");
    expect(strip).toEqual([
      {
        memberId: "m1",
        name: "Kenta",
        isViewer: false,
        claims: [
          { role: "driver", noteId: "n1", partId: "visit", partTitle: "Clinic visit", icon: "clinic" },
          { role: "owner", noteId: "n1", partId: "card", partTitle: "Bring insurance card", icon: "card" },
        ],
      },
      {
        memberId: "m2",
        name: "Misa",
        isViewer: true,
        claims: [{ role: "companion", noteId: "n1", partId: "visit", partTitle: "Clinic visit", icon: "clinic" }],
      },
    ]);
  });

  it("is empty when nobody helps, or only on finished, failed, or former members' Parts", () => {
    const done = part("a", { owner: kenta, progressStatus: "completed" });
    const failed = part("b", { owner: kenta, progressStatus: "failed" });
    const open = part("c", { owner: misa });
    expect(helpersStrip([event([done, failed, open])], new Set(["m1"]), "m1")).toEqual([]);
  });
});

type Triple = string;
const key = (memberId: string, role: string, noteId: string, partId: string): Triple =>
  `${memberId}|${role}|${noteId}|${partId}`;

/** The direct filter: every Owner, Driver, or Companion of an active member on a current Part of an Open_Event. */
function expectedTriples(events: readonly SharedCareEvent[], active: ReadonlySet<string>): Triple[] {
  const out: Triple[] = [];
  for (const ev of events) {
    const open = ev.state === "ready" && ev.parts.some((p) => p.progressStatus !== "completed" && p.progressStatus !== "cancelled");
    if (!open) continue;
    for (const p of ev.parts) {
      if (["completed", "cancelled", "failed"].includes(String(p.progressStatus))) continue;
      for (const role of ["owner", "driver", "companion"] as const) {
        const h = p[role];
        if (h && active.has(h.id)) out.push(key(h.id, role, ev.noteId, p.id));
      }
    }
  }
  return out.sort();
}

function stripTriples(strip: readonly HelperEntry[]): Triple[] {
  return strip.flatMap((e) => e.claims.map((c) => key(e.memberId, c.role, c.noteId, c.partId))).sort();
}

const arbActive = fc.subarray([...MEMBER_IDS]).map((ids) => new Set<string>(ids));

/** Mutates a copy of the events: clears one holder, or closes the Part that holder is on. */
function withChange(
  events: readonly SharedCareEvent[],
  triple: Triple,
  change: "clear" | "close",
): SharedCareEvent[] {
  const [, role, noteId, partId] = triple.split("|");
  return events.map((ev) =>
    ev.noteId !== noteId
      ? ev
      : {
          ...ev,
          parts: ev.parts.map((p) =>
            p.id !== partId ? p : change === "clear" ? { ...p, [role]: null } : { ...p, progressStatus: "completed" },
          ),
        },
  );
}

describe("Feature: family-app-demo-parity, Property 23: The Helpers_Strip shows exactly the Current_Claims", () => {
  it("holds exactly the current Owner, Driver, and Companion claims of active members, one entry per member", () => {
    fc.assert(
      fc.property(arbEvents(), arbActive, fc.constantFrom(...MEMBER_IDS), fc.nat(), fc.constantFrom("clear" as const, "close" as const), (events, active, viewerId, pick, change) => {
        const strip = helpersStrip(events, active, viewerId);
        const expected = expectedTriples(events, active);
        expect(stripTriples(strip)).toEqual(expected);

        const ids = strip.map((e) => e.memberId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const e of strip) {
          expect(e.claims.length).toBeGreaterThan(0);
          expect(e.isViewer).toBe(e.memberId === viewerId);
        }

        if (expected.length === 0) return;
        const chosen = expected[pick % expected.length];
        const after = stripTriples(helpersStrip(withChange(events, chosen, change), active, viewerId));
        if (change === "clear") {
          // Clearing one holder removes exactly that claim.
          expect(after).toEqual(expected.filter((t) => t !== chosen));
        } else {
          // Closing the holder's Part removes exactly the claims on that Part, including the chosen one.
          const [, , noteId, partId] = chosen.split("|");
          expect(after).toEqual(expected.filter((t) => !t.endsWith(`|${noteId}|${partId}`)));
        }
      }),
      { numRuns: 200 },
    );
  });
});

/** Members m1 to m4 with random display names, including blank ones and shared first names. */
const arbNamedMembers: fc.Arbitrary<MemberRef[]> = fc
  .tuple(
    ...MEMBERS.map(() =>
      fc.oneof(fc.constantFrom("Kenta", "Misa", "Aki (son)", "Kenta （叔父）", "春子（母）", ""), fc.string({ maxLength: 8 })),
    ),
  )
  .map((names) => MEMBERS.map((m, i) => ({ id: m.id, name: names[i] })));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

describe("Feature: family-app-demo-parity, Property 24: The Helpers_Strip order does not depend on how much someone does", () => {
  it("orders by first name, then member id, and keeps that order when claims are added or removed", () => {
    fc.assert(
      fc.property(
        arbNamedMembers.chain((members) => fc.tuple(fc.constant(members), arbEvents({ members }), arbEvents({ members }))),
        arbActive,
        fc.constantFrom(...MEMBER_IDS),
        ([members, before, after], active, viewerId) => {
          const a = helpersStrip(before, active, viewerId);
          const b = helpersStrip(after, active, viewerId);

          for (const strip of [a, b]) {
            for (let i = 1; i < strip.length; i++) {
              const prev = strip[i - 1];
              const cur = strip[i];
              expect(cmp(prev.name, cur.name) || cmp(prev.memberId, cur.memberId)).toBe(-1);
            }
            for (const e of strip) {
              expect(e.name).toBe(firstName(members.find((m) => m.id === e.memberId)!.name));
              // No count, rank, score, or total on an entry.
              expect(Object.keys(e).sort()).toEqual(["claims", "isViewer", "memberId", "name"]);
              expect(Object.values(e).some((v) => typeof v === "number")).toBe(false);
            }
          }

          // `before` and `after` differ only by claims added or removed. Members in both keep their order.
          const inB = new Set(b.map((e) => e.memberId));
          const inA = new Set(a.map((e) => e.memberId));
          expect(a.map((e) => e.memberId).filter((id) => inB.has(id))).toEqual(
            b.map((e) => e.memberId).filter((id) => inA.has(id)),
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});
