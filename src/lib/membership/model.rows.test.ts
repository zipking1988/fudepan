import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { RUNS, runScenario, scenarioArb } from "./model.arbitraries";

describe("Feature: family-app-demo-parity, Property 6: Membership rows are never duplicated or deleted, and an Account has at most one active household", () => {
  it("keeps rows unique and permanent, and one active household per Account", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          const after = t.after.state;
          const keys = after.members.map((m) => `${m.householdId}|${m.userId}`);
          expect(new Set(keys).size).toBe(keys.length);
          const activeUsers = after.members.filter((m) => m.isActive).map((m) => m.userId);
          expect(new Set(activeUsers).size).toBe(activeUsers.length);
          expect(after.members.length).toBeGreaterThanOrEqual(t.before.members.length);
          for (const b of t.before.members) {
            const a = after.members.find((m) => m.id === b.id)!;
            expect(a).toBeDefined();
            expect([a.householdId, a.userId]).toEqual([b.householdId, b.userId]);
          }
          const op = t.op;
          if (t.after.outcome === "deactivated" || t.after.outcome === "left") {
            const changed = after.members.filter((m, i) => JSON.stringify(m) !== JSON.stringify(t.before.members[i]));
            expect(changed).toHaveLength(1);
            expect(changed[0].isActive).toBe(false);
            expect({ ...changed[0], isActive: true }).toEqual(t.before.members.find((m) => m.id === changed[0].id));
          }
          if (op.kind === "accept_invite") {
            const inv = t.before.invites.find((i) => i.token === op.token);
            if (inv && inv.state === "pending" && t.now.getTime() < inv.expiresAt.getTime()) {
              const own = t.before.members.find((m) => m.userId === op.userId && m.householdId === inv.householdId);
              const elsewhere = t.before.members.some((m) => m.userId === op.userId && m.isActive);
              if (own?.isActive) expect(t.after.outcome).toBe("already_member");
              else if (elsewhere) expect(t.after.outcome).toBe("one_household_only");
            }
            if (t.after.outcome === "already_member" || t.after.outcome === "one_household_only") {
              expect(after.invites.find((i) => i.id === inv!.id)!.state).toBe("pending");
            }
            if (t.after.outcome === "joined") {
              const former = t.before.members.find((m) => m.userId === op.userId && m.householdId === inv!.householdId);
              if (former) {
                expect(former.isActive).toBe(false);
                expect(after.members).toHaveLength(t.before.members.length);
                expect(after.members.find((m) => m.id === former.id)!.isActive).toBe(true);
              } else {
                expect(after.members).toHaveLength(t.before.members.length + 1);
              }
            }
          }
        }
      }),
      RUNS,
    );
  });

  it("reactivates a former member's row on a new invite", () => {
    fc.assert(
      fc.property(scenarioArb({ noParts: true, minLength: 6, maxLength: 30 }), (sc) => {
        for (const t of runScenario(sc)) {
          if (t.op.kind === "accept_invite" && t.after.outcome === "joined") {
            const joinedRow = t.after.state.members.find((m) => m.userId === (t.op as { userId: string }).userId && m.isActive)!;
            const dupes = t.after.state.members.filter((m) => m.householdId === joinedRow.householdId && m.userId === joinedRow.userId);
            expect(dupes).toHaveLength(1);
          }
        }
      }),
      { numRuns: 200 },
    );
  });
});
