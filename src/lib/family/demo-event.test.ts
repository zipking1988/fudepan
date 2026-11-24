import { describe, expect, it } from "vitest";
import { demoProgress } from "@/app/demo/demo-board";
import { applyDemoAction, DEMO_HOUSEHOLD, DEMO_MEMBERS, initialDemoEvent } from "./demo-event";
import { buildEventCard } from "./event-card";
import type { EventViewer } from "./event-offers";
import type { SharedCareEvent } from "./shared-care-event";

const [misa, kenta, yui] = DEMO_MEMBERS;
const as = (m: (typeof DEMO_MEMBERS)[number]): EventViewer => ({ memberId: m.id, householdId: DEMO_HOUSEHOLD, role: m.role });

function step(event: SharedCareEvent, who: (typeof DEMO_MEMBERS)[number], action: string, input: Record<string, unknown>) {
  const r = applyDemoAction(event, as(who), action, input);
  if (!r.ok) throw new Error(`${action} refused: ${r.messageKey}`);
  return r.event;
}

describe("demo event", () => {
  const start = initialDemoEvent("ja");
  const visit = start.parts[0].id;

  it("starts with the time only from the note and no clinic", () => {
    const card = buildEventCard(start);
    expect(card.main?.when).toMatchObject({ kind: "fromNote", month: 11, day: 27, hour: 14, minute: 30 });
    expect(card.main?.place).toBeNull();
    expect(demoProgress(start)).toEqual([false, false, false, false, false, false]);
  });

  it("walks the five steps with the real rules", () => {
    let e = step(start, kenta, "saveAppointment", {
      stepId: visit,
      location: "さくら内科",
      localDate: "2026-11-27",
      localTime: "14:30",
      timeZone: "Asia/Tokyo",
    });
    expect(buildEventCard(e).main?.when).toMatchObject({ kind: "confirmed", hour: 14, minute: 30 });
    e = step(e, kenta, "claimPart", { stepId: visit, role: "driver" });
    e = step(e, yui, "claimPart", { stepId: visit, role: "companion" });
    for (const p of e.parts.slice(1)) e = step(e, yui, "claimPart", { stepId: p.id, role: "owner" });
    e = step(e, misa, "decideApproval", { stepId: visit, decision: "approve" });
    e = step(e, kenta, "completePart", { stepId: visit });
    expect(demoProgress(e)).toEqual([true, true, true, true, true, false]);
    for (const p of e.parts.slice(1)) e = step(e, yui, "completePart", { stepId: p.id });
    expect(e.done).toBe(true);
    expect(demoProgress(e)).toEqual([true, true, true, true, true, true]);
  });

  it("refuses what the rules refuse: only the primary caregiver confirms, only the owner finishes", () => {
    expect(applyDemoAction(start, as(kenta), "decideApproval", { stepId: visit, decision: "approve" }).ok).toBe(false);
    expect(applyDemoAction(start, as(kenta), "completePart", { stepId: visit }).ok).toBe(false);
    expect(applyDemoAction(start, as(yui), "completePart", { stepId: visit }).ok).toBe(false);
  });

  it("sends an approved visit back to 'Requires confirmation' when the people change", () => {
    let e = step(start, misa, "decideApproval", { stepId: visit, decision: "approve" });
    expect(e.parts[0].approvalState).toBe("approved");
    e = step(e, yui, "claimPart", { stepId: visit, role: "driver" });
    expect(e.parts[0].approvalState).toBe("pending");
  });
});
