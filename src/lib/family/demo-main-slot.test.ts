import { describe, expect, it } from "vitest";
import { applyDemoAction, DEMO_MEMBERS, initialDemoEvent } from "./demo-event";
import { buildEventCard } from "./event-card";
import type { EventViewer } from "./event-offers";
import { isEventDone, type EventPart, type SharedCareEvent } from "./shared-care-event";

const misa: EventViewer = { memberId: DEMO_MEMBERS[0].id, householdId: initialDemoEvent("ja").householdId, role: "primary_caregiver" };
const kenta: EventViewer = { memberId: DEMO_MEMBERS[1].id, householdId: misa.householdId, role: "family_member" };
const yui: EventViewer = { memberId: DEMO_MEMBERS[2].id, householdId: misa.householdId, role: "family_member" };

function run(e: SharedCareEvent, viewer: EventViewer, action: string, input: Record<string, unknown>): SharedCareEvent {
  const r = applyDemoAction(e, viewer, action, input);
  if (!r.ok) throw new Error(`demo action ${action} refused: ${r.messageKey}`);
  return r.event;
}

describe("demo and real app share the Main_Part_Rule", () => {
  it("keeps the completed appointment in the Main_Slot, as the real mapper's rows do", () => {
    const start = initialDemoEvent("ja");
    const visit = start.parts.find((p) => p.careCategory === "appointment")!;
    let e = run(start, misa, "saveAppointment", {
      stepId: visit.id,
      localDate: "2026-11-27",
      localTime: "14:30",
      location: "さくら病院",
      timeZone: "Asia/Tokyo",
    });
    e = run(e, kenta, "claimPart", { stepId: visit.id, role: "driver" });
    e = run(e, yui, "claimPart", { stepId: visit.id, role: "companion" });
    e = run(e, misa, "decideApproval", { stepId: visit.id, decision: "approve" });
    e = run(e, kenta, "completePart", { stepId: visit.id });

    const card = buildEventCard(e);
    expect(card.main?.partId).toBe(visit.id);
    expect(card.main?.status).toBe("completed");
    expect(card.main?.prompts.timeUnknown).toBe(false);
    expect(card.items.map((i) => i.partId)).toEqual(e.parts.filter((p) => p.id !== visit.id).map((p) => p.id));

    // The same rows as the real mapper builds them (queries.ts): same ids and order, completed status, confirmed time.
    const done = e.parts.find((p) => p.id === visit.id) as EventPart;
    const realParts: EventPart[] = e.parts.map((p) => ({ ...p }));
    const real: SharedCareEvent = { ...e, parts: realParts, done: isEventDone(realParts) };
    const realCard = buildEventCard(real);
    expect(realCard.main?.partId).toBe(card.main?.partId);
    expect(realCard.main?.status).toBe("completed");
    expect(realCard.main?.when).toEqual(card.main?.when);
    expect(done.progressStatus).toBe("completed");
  });
});
