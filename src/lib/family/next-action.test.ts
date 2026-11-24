import { describe, expect, it } from "vitest";
import { nextAction } from "./next-action";
const base = { offers: { claim: [], approve: false, complete: false }, closed: false, canWrite: true, hasQuestion: false, ownedByOther: false };
const mk = (o: object) => ({ ...base, ...o }) as unknown as Parameters<typeof nextAction>[0];
describe("nextAction", () => {
  it("promotes one step in order: confirm, complete, details, claim, wait", () => {
    expect(nextAction(mk({ offers: { claim: ["owner"], approve: true, complete: true }, hasQuestion: true })).kind).toBe("confirm");
    expect(nextAction(mk({ offers: { claim: ["owner"], approve: false, complete: true } })).kind).toBe("complete");
    expect(nextAction(mk({ hasQuestion: true, offers: { claim: ["owner"], approve: false, complete: false } })).kind).toBe("details");
    expect(nextAction(mk({ offers: { claim: ["owner"], approve: false, complete: false } })).kind).toBe("claim");
    expect(nextAction(mk({ ownedByOther: true })).kind).toBe("waitingOwner");
  });
  it("promotes Mark as done when completion is offered, whatever proof is listed", () => {
    const offers = { claim: ["owner"], approve: false, complete: true };
    expect(nextAction(mk({ offers })).kind).toBe("complete");
    expect(nextAction(mk({ offers: { ...offers, approve: true } })).kind).toBe("confirm");
  });
  it("offers nothing when closed or read-only", () => {
    expect(nextAction(mk({ closed: true, offers: { claim: ["owner"], approve: true, complete: true } })).kind).toBe("none");
    expect(nextAction(mk({ canWrite: false })).kind).toBe("none");
  });
});
