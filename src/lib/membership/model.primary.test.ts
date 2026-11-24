import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyModel } from "./model";
import { RUNS, T0, activePrimaryCount, scenarioArb, runScenario, stateArb } from "./model.arbitraries";

describe("Feature: family-app-demo-parity, Property 1: A household always keeps an active primary caregiver", () => {
  it("never drops below one active primary in any sequence", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          for (const h of t.before.households) {
            if (activePrimaryCount(t.before, h.id) >= 1) {
              expect(activePrimaryCount(t.after.state, h.id)).toBeGreaterThanOrEqual(1);
            }
          }
          if (t.after.refused) expect(t.after.state.members).toEqual(t.before.members);
        }
      }),
      RUNS,
    );
  });

  it("refuses with last_primary_caregiver when an authorized action would remove the last primary", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          const op = t.op;
          if (op.kind !== "change_role" && op.kind !== "deactivate" && op.kind !== "leave") continue;
          const before = activePrimaryCount(t.before, op.householdId);
          const after = activePrimaryCount(t.after.state, op.householdId);
          if (before === 1 && after === 0) throw new Error("household lost its last primary");
          if (t.after.outcome === "last_primary_caregiver") {
            expect(before).toBe(1);
            expect(t.after.refused).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it("serializes two requests that were each valid against the same starting state", () => {
    fc.assert(
      fc.property(stateArb({ noParts: true }), fc.boolean(), (state, viaLeave) => {
        // Make household 0 have exactly two primaries, then demote both (or demote one, leave the other).
        const hid = state.households[0].id;
        const members = state.members.filter((m) => m.householdId === hid && m.isActive);
        fc.pre(members.length >= 2);
        const [a, b] = members;
        const s0 = {
          ...state,
          members: state.members.map((m) =>
            m.id === a.id || m.id === b.id ? { ...m, role: "primary_caregiver" as const } : m.householdId === hid && m.role === "primary_caregiver" ? { ...m, role: "family_member" as const } : m,
          ),
        };
        const first = applyModel(s0, { kind: "change_role", householdId: hid, actorUserId: a.userId, memberId: b.id, role: "family_member" }, T0);
        const second = viaLeave
          ? applyModel(first.state, { kind: "leave", householdId: hid, actorUserId: a.userId }, T0)
          : applyModel(first.state, { kind: "change_role", householdId: hid, actorUserId: a.userId, memberId: a.id, role: "family_member" }, T0);
        expect(first.refused).toBe(false);
        expect(second.outcome).toBe("last_primary_caregiver");
        expect(activePrimaryCount(second.state, hid)).toBe(1);
      }),
      RUNS,
    );
  });
});
