import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyModel } from "./model";
import { RUNS, roleArb, runScenario, scenarioArb, uuid } from "./model.arbitraries";
import { guardMembershipAction, wouldLeaveNoPrimary, type MemberRecord, type MembershipAction } from "./rules";

const H = [uuid(1), uuid(2)];
const membersArb = fc.array(
  fc.record({
    userId: fc.integer({ min: 0, max: 5 }).map((n) => uuid(10 + n)),
    householdId: fc.constantFrom(...H),
    role: roleArb,
    isActive: fc.boolean(),
  }),
  { maxLength: 7 },
).map((rows): MemberRecord[] => rows.map((r, i) => ({ id: uuid(100 + i), ...r })));

const actionArb: fc.Arbitrary<MembershipAction> = fc.oneof(
  fc.record({ kind: fc.constantFrom("create_invite", "revoke_invite"), householdId: fc.constantFrom(...H) }),
  fc.record({
    kind: fc.constant("change_role"),
    householdId: fc.constantFrom(...H),
    targetMemberId: fc.integer({ min: 0, max: 8 }).map((n) => uuid(100 + n)),
    newRole: roleArb,
  }),
  fc.record({
    kind: fc.constant("deactivate"),
    householdId: fc.constantFrom(...H),
    targetMemberId: fc.integer({ min: 0, max: 8 }).map((n) => uuid(100 + n)),
  }),
  fc.record({ kind: fc.constant("leave"), householdId: fc.constantFrom(...H) }),
  fc.record({
    kind: fc.constant("rename"),
    householdId: fc.constantFrom(...H),
    targetMemberId: fc.integer({ min: 0, max: 8 }).map((n) => uuid(100 + n)),
  }),
) as fc.Arbitrary<MembershipAction>;

/** Independent oracle for the guard. */
function expected(actorUserId: string, members: MemberRecord[], a: MembershipAction): string | null {
  const actor = members.find((m) => m.userId === actorUserId && m.householdId === a.householdId && m.isActive);
  if (!actor) return "not_found";
  const primaries = members.filter((m) => m.householdId === a.householdId && m.isActive && m.role === "primary_caregiver");
  const isLastPrimary = (id: string) => primaries.length === 1 && primaries[0].id === id;
  const target = "targetMemberId" in a ? members.find((m) => m.id === a.targetMemberId && m.householdId === a.householdId && m.isActive) : undefined;
  switch (a.kind) {
    case "create_invite":
    case "revoke_invite":
      return actor.role === "primary_caregiver" ? null : "not_primary_caregiver";
    case "rename":
      return a.targetMemberId === actor.id ? null : "not_self";
    case "leave":
      return isLastPrimary(actor.id) ? "last_primary_caregiver" : null;
    case "change_role":
      if (actor.role !== "primary_caregiver") return "not_primary_caregiver";
      if (!target) return "not_found";
      return a.newRole !== "primary_caregiver" && isLastPrimary(target.id) ? "last_primary_caregiver" : null;
    case "deactivate":
      if (actor.role !== "primary_caregiver") return "not_primary_caregiver";
      if (!target) return "not_found";
      if (target.id === actor.id) return "self_target";
      return isLastPrimary(target.id) ? "last_primary_caregiver" : null;
  }
}

describe("Feature: family-app-demo-parity, Property 2: Membership actions are authorized against the current state", () => {
  it("allows exactly the actions the actor may take and names the refusal", () => {
    fc.assert(
      fc.property(membersArb, fc.integer({ min: 0, max: 5 }), actionArb, (members, u, action) => {
        const actorUserId = uuid(10 + u);
        const want = expected(actorUserId, members, action);
        const got = guardMembershipAction(actorUserId, members, action);
        expect(got).toEqual(want === null ? { ok: true } : { ok: false, refusal: want });
        if (!want) return;
        // A refusal never needs household data: a stranger and a missing row look the same.
        if (want === "not_found") expect(got).toEqual({ ok: false, refusal: "not_found" });
      }),
      { numRuns: 500 },
    );
  });

  it("wouldLeaveNoPrimary is false for actions that touch no primary", () => {
    fc.assert(
      fc.property(membersArb, actionArb, (members, action) => {
        if (action.kind !== "change_role" && action.kind !== "deactivate") {
          expect(wouldLeaveNoPrimary(members, action)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("leaves state, audit, feed, and reminders unchanged when the model refuses", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          if (!t.after.refused) continue;
          expect(t.after.state).toEqual(t.before);
          expect(t.after.state.audit).toHaveLength(t.before.audit.length);
          expect(t.after.state.feed).toHaveLength(t.before.feed.length);
          expect(t.after.state.reminders).toHaveLength(t.before.reminders.length);
        }
      }),
      RUNS,
    );
  });

  it("refuses a non-member with not_found for every guarded operation", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          const op = t.op;
          if (!("actorUserId" in op) || !t.after.refused) continue;
          const isMember = t.before.members.some((m) => m.userId === op.actorUserId && m.householdId === op.householdId && m.isActive);
          if (!isMember) expect(t.after.outcome).toBe("not_found");
        }
      }),
      RUNS,
    );
    expect(applyModel).toBeTypeOf("function");
  });
});
