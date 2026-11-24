import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyModel } from "./model";
import { RUNS, T0, newInviteUuid, runScenario, scenarioArb, stateArb, userUuid } from "./model.arbitraries";

describe("Feature: family-app-demo-parity, Property 3: Invites are single use and terminal states never change", () => {
  it("lets at most one accept per token succeed, and terminal states stay put", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        const joins = new Map<string, number>();
        for (const t of runScenario(sc)) {
          if (t.op.kind === "accept_invite" && t.after.outcome === "joined") {
            joins.set(t.op.token, (joins.get(t.op.token) ?? 0) + 1);
            const inv = t.after.state.invites.find((i) => i.token === (t.op as { token: string }).token)!;
            const member = t.after.state.members.find((m) => m.id === inv.acceptedMemberId)!;
            expect(member.role).toBe(inv.role);
            expect(member.isActive).toBe(true);
          }
          for (const before of t.before.invites) {
            if (before.state === "pending") continue;
            const after = t.after.state.invites.find((i) => i.id === before.id)!;
            expect(after).toEqual(before);
            if (t.op.kind === "accept_invite" && t.op.token === before.token) expect(t.after.outcome).toBe("unusable");
          }
          if (t.after.outcome === "not_pending") {
            const state = t.after.result.state;
            expect(["accepted", "revoked", "expired"]).toContain(state);
            const inv = t.after.state.invites.find((i) => i.id === (t.op as { inviteId: string }).inviteId)!;
            expect(inv.state).toBe(state);
          }
        }
        for (const n of joins.values()) expect(n).toBeLessThanOrEqual(1);
      }),
      RUNS,
    );
  });

  it("lets exactly one of several different Accounts accept one invite", () => {
    fc.assert(
      fc.property(stateArb({ noParts: true }), fc.integer({ min: 2, max: 6 }), (state, accounts) => {
        const primary = state.members.find((m) => m.isActive && m.role === "primary_caregiver")!;
        let s = applyModel(
          state,
          { kind: "create_invite", householdId: primary.householdId, actorUserId: primary.userId, role: "family_member", inviteId: newInviteUuid(0), token: "t-one" },
          T0,
        );
        fc.pre(!s.refused);
        let joined = 0;
        for (let k = 0; k < accounts; k++) {
          s = applyModel(
            s.state,
            { kind: "accept_invite", token: "t-one", userId: userUuid(12 + k), displayName: `Guest ${k}`, memberId: `00000000-0000-4000-8000-0000000090${k}0` },
            T0,
          );
          if (s.outcome === "joined") joined++;
          else expect(s.outcome).toBe("unusable");
        }
        expect(joined).toBe(1);
      }),
      RUNS,
    );
  });
});
