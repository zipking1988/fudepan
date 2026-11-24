import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { INVITE_STATES, effectiveInviteState } from "./invite-state";
import { INVITE_TTL_MS } from "./invite-token";
import { applyModel } from "./model";
import { RUNS, T0, newInviteUuid, runScenario, scenarioArb, stateArb, userUuid } from "./model.arbitraries";

describe("Feature: family-app-demo-parity, Property 4: Expiry is enforced on access and audited exactly once", () => {
  it("computes the effective state from the stored state and the clock", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...INVITE_STATES),
        fc.integer({ min: 0, max: 4e12 }),
        fc.integer({ min: -3, max: 3 }).chain((d) => fc.constant(d)),
        (stored, ms, delta) => {
          const expiresAt = new Date(ms);
          const now = new Date(ms + delta);
          const eff = effectiveInviteState(stored, expiresAt, now);
          expect(eff === "expired").toBe(stored === "expired" || (stored === "pending" && delta >= 0));
          if (stored !== "pending") expect(eff).toBe(stored);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("refuses accepts at or after the expiry time and audits each expiry once", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        const trace = runScenario(sc);
        for (const t of trace) {
          if (t.op.kind !== "accept_invite") continue;
          const op = t.op;
          const inv = t.before.invites.find((i) => i.token === op.token);
          if (!inv || t.now.getTime() < inv.expiresAt.getTime()) continue;
          expect(t.after.outcome).toBe("unusable");
          if (inv.state === "pending") {
            expect(t.after.state.invites.find((i) => i.id === inv.id)!.state).toBe("expired");
          }
        }
        const last = trace.length ? trace[trace.length - 1].after.state : sc.initial;
        for (const inv of last.invites) {
          const expiredEvents = last.audit.filter((a) => a.type === "invite.expired" && a.payload.invite_id === inv.id);
          expect(expiredEvents.length).toBe(inv.state === "expired" ? 1 : 0);
          if (inv.state === "accepted") expect(inv.acceptedAt!.getTime()).toBeLessThan(inv.expiresAt.getTime());
          if (inv.state === "expired") expect(inv.expiredAt).not.toBeNull();
        }
      }),
      RUNS,
    );
  });

  it("accepts one millisecond before expiry and refuses exactly at expiry", () => {
    fc.assert(
      fc.property(stateArb({ noParts: true }), fc.integer({ min: -2, max: 2 }), fc.boolean(), (state, delta, viaPreview) => {
        const primary = state.members.find((m) => m.isActive && m.role === "primary_caregiver")!;
        const created = applyModel(
          state,
          { kind: "create_invite", householdId: primary.householdId, actorUserId: primary.userId, role: "family_member", inviteId: newInviteUuid(0), token: "t-edge" },
          T0,
        );
        fc.pre(!created.refused);
        const at = new Date(T0.getTime() + INVITE_TTL_MS + delta);
        const out = viaPreview
          ? applyModel(created.state, { kind: "preview_invite", token: "t-edge" }, at)
          : applyModel(created.state, { kind: "accept_invite", token: "t-edge", userId: userUuid(13), displayName: "Guest", memberId: "00000000-0000-4000-8000-000000009001" }, at);
        const live = delta < 0;
        expect(out.outcome).toBe(live ? (viaPreview ? "usable" : "joined") : "unusable");
        // A second access after expiry writes no second audit event.
        const again = applyModel(out.state, { kind: "preview_invite", token: "t-edge" }, new Date(at.getTime() + 1));
        const events = again.state.audit.filter((a) => a.type === "invite.expired" && a.payload.invite_id === newInviteUuid(0));
        expect(events.length).toBeLessThanOrEqual(1);
        if (!live) expect(events).toHaveLength(1);
      }),
      RUNS,
    );
  });
});
