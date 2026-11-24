import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { roleArb, uuid } from "./model.arbitraries";
import { memberActionsFor } from "./member-actions";
import type { MemberRecord } from "./rules";

const memberArb = (id: number): fc.Arbitrary<MemberRecord> =>
  fc.record({
    id: fc.constant(uuid(id)),
    userId: fc.constant(uuid(id + 50)),
    householdId: fc.constantFrom(uuid(1), uuid(2)),
    role: roleArb,
    isActive: fc.boolean(),
  });

describe("Feature: family-app-demo-parity, Property 16: Member row actions match the viewer's rights", () => {
  it("offers exactly the actions the viewer may take", () => {
    fc.assert(
      fc.property(memberArb(1), memberArb(2), fc.boolean(), (viewer, other, same) => {
        const target: MemberRecord = same ? { ...viewer } : { ...other, householdId: viewer.householdId };
        const actions = memberActionsFor(viewer, target);
        const self = target.id === viewer.id;
        const expectSelf = self && viewer.isActive && viewer.role !== "care_recipient";
        const expectOthers = !self && viewer.isActive && viewer.role === "primary_caregiver" && target.isActive;
        expect(actions.includes("edit_name")).toBe(expectSelf);
        expect(actions.includes("leave")).toBe(expectSelf);
        expect(actions.includes("change_role")).toBe(expectOthers);
        expect(actions.includes("remove")).toBe(expectOthers);
        expect(actions.length).toBe(expectSelf || expectOthers ? 2 : 0);
      }),
      { numRuns: 200 },
    );
  });

  it("offers nothing across households", () => {
    fc.assert(
      fc.property(memberArb(1), memberArb(2), (viewer, other) => {
        fc.pre(viewer.householdId !== other.householdId);
        expect(memberActionsFor(viewer, other)).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
