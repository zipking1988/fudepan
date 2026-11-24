import fc from "fast-check";
import { it } from "vitest";
import { arbEvents, arbMemberList, arbNow, arbSharedCareEvent, arbViewer, MEMBER_IDS } from "./arbitraries.test-helpers";
import { buildEventCard } from "./event-card";
import { cardInlineActions } from "./inline-actions";
import { helpersStrip } from "./helpers-strip";
import { cardWarmLines } from "./warm-copy";

it("stats", () => {
  fc.statistics(
    fc.tuple(arbSharedCareEvent({ states: ["ready"] }), arbViewer, arbMemberList, arbNow),
    ([ev, v, m, now]) => {
      const a = cardInlineActions(ev, buildEventCard(ev), v, m, now);
      return `actions=${Math.min(a.length, 4)} kinds=${[...new Set(a.map((x) => x.kind))].sort().join(",").slice(0, 0)}${a.some((x) => x.kind === "confirm") ? "C" : ""}${a.some((x) => x.kind === "done") ? "D" : ""}${a.some((x) => x.kind === "knowPlace") ? "K" : ""}`;
    },
    { numRuns: 2000 },
  );
  fc.statistics(arbSharedCareEvent({ states: ["ready"] }), (ev) => `mainOpen=${buildEventCard(ev).main?.status}`, { numRuns: 1000 });
  fc.statistics(fc.tuple(arbEvents(), fc.subarray([...MEMBER_IDS])), ([evs, act]) => `strip=${Math.min(helpersStrip(evs, new Set(act), "m1").length, 3)}`, { numRuns: 1000 });
  fc.statistics(arbSharedCareEvent({ states: ["ready"] }), (ev) => `lines=${Math.min(cardWarmLines({ event: ev, card: buildEventCard(ev), viewerId: "m1", recipientName: "H" }).length, 5)}`, { numRuns: 1000 });
});
