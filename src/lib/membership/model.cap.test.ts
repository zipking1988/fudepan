import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { effectiveInviteState } from "./invite-state";
import { PENDING_INVITE_CAP } from "./invite-token";
import { runScenario, scenarioArb } from "./model.arbitraries";
import type { ModelState } from "./model";

const effectivePending = (s: ModelState, householdId: string, now: Date) =>
  s.invites.filter((i) => i.householdId === householdId && effectiveInviteState(i.state, i.expiresAt, now) === "pending").length;

describe("Feature: family-app-demo-parity, Property 5: Pending invites stay within the cap", () => {
  it("never exceeds 20 effectively pending invites and refuses creation exactly at 20", () => {
    fc.assert(
      fc.property(scenarioArb({ freshPending: [14, PENDING_INVITE_CAP], households: [1, 1], noParts: true }), (sc) => {
        for (const t of runScenario(sc)) {
          for (const h of t.after.state.households) {
            expect(effectivePending(t.after.state, h.id, t.now)).toBeLessThanOrEqual(PENDING_INVITE_CAP);
          }
          if (t.op.kind !== "create_invite") continue;
          const op = t.op;
          const authorized = t.before.members.some(
            (m) => m.userId === op.actorUserId && m.householdId === op.householdId && m.isActive && m.role === "primary_caregiver",
          );
          if (!authorized) continue;
          const count = effectivePending(t.before, op.householdId, t.now);
          expect(t.after.outcome === "invite_cap_reached").toBe(count >= PENDING_INVITE_CAP);
        }
      }),
      { numRuns: 200 },
    );
  });
});
