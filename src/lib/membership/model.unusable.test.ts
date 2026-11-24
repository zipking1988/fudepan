import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { effectiveInviteState } from "./invite-state";
import { applyModel } from "./model";
import { HOUR, T0, DAY, stateArb } from "./model.arbitraries";

describe("Feature: family-app-demo-parity, Property 12: Unusable and unknown invite links look the same", () => {
  it("previews every non-usable link as exactly { outcome: 'unusable' }", () => {
    fc.assert(
      fc.property(
        stateArb(),
        fc.constantFrom(0, HOUR, DAY, 6 * DAY, 7 * DAY, 8 * DAY),
        fc.string({ maxLength: 30 }),
        (state, offset, randomToken) => {
          const now = new Date(T0.getTime() + offset);
          const tokens = [...state.invites.map((i) => i.token), `random-${randomToken}`];
          for (const token of tokens) {
            const inv = state.invites.find((i) => i.token === token);
            const out = applyModel(state, { kind: "preview_invite", token }, now);
            expect(out.refused).toBe(false);
            if (inv && effectiveInviteState(inv.state, inv.expiresAt, now) === "pending") {
              expect(out.result.outcome).toBe("usable");
              expect(Object.keys(out.result).sort()).toEqual(
                ["creator_display_name", "expires_at", "household_name", "outcome", "role"],
              );
            } else {
              expect(out.result).toEqual({ outcome: "unusable" });
              expect(out.outcome).toBe("unusable");
            }
            if (!inv) expect(out.state).toEqual(state);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
