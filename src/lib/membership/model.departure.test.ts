import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { heldParts } from "./held-parts";
import { RUNS, runScenario, scenarioArb } from "./model.arbitraries";
import type { ModelPart } from "./model";

const FIELDS = ["ownerId", "driverId", "companionId", "backupOwnerId"] as const;

describe("Feature: family-app-demo-parity, Property 7: A departure leaves nothing held by the departing member", () => {
  it("clears every hold, declines pending requests, and resets approval", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          const op = t.op;
          let memberId: string | null = null;
          let householdId = "";
          if (t.after.outcome === "deactivated" && op.kind === "deactivate") [memberId, householdId] = [op.memberId, op.householdId];
          if (t.after.outcome === "left" && op.kind === "leave") {
            memberId = t.before.members.find((m) => m.userId === op.actorUserId && m.householdId === op.householdId)!.id;
            householdId = op.householdId;
          }
          if (t.after.outcome === "role_changed" && op.kind === "change_role" && op.role === "care_recipient") {
            [memberId, householdId] = [op.memberId, op.householdId];
          }
          const after = t.after.state;
          if (!memberId) {
            // Not a departure: no Part and no request changes.
            expect(after.parts).toEqual(t.before.parts);
            expect(after.requests).toEqual(t.before.requests);
            continue;
          }
          const m = memberId;
          let removed = 0;
          for (const part of after.parts.filter((p) => p.isOpen)) {
            for (const f of FIELDS) expect(part[f]).not.toBe(m);
          }
          for (const r of after.requests) {
            const part = after.parts.find((p) => p.partId === r.partId)!;
            if (part.isOpen && part.householdId === householdId) {
              expect(r.status === "pending" && (r.fromId === m || r.toId === m)).toBe(false);
            }
          }
          t.before.parts.forEach((b, i) => {
            const a: ModelPart = after.parts[i];
            if (!b.isOpen || b.householdId !== householdId) {
              expect(a).toEqual(b);
              return;
            }
            const roles = FIELDS.filter((f) => b[f] === m);
            removed += roles.length;
            for (const f of FIELDS) if (b[f] !== m) expect(a[f]).toBe(b[f]);
            const performerRemoved = roles.some((f) => f !== "backupOwnerId");
            const expectPending = b.isHighRisk && b.approvalState === "approved" && performerRemoved;
            expect(a.approvalState).toBe(expectPending ? "pending" : b.approvalState);
          });
          const released = after.audit.slice(t.before.audit.length).filter((e) => e.type === "part.released");
          expect(released).toHaveLength(removed);
          for (const e of released) expect([e.actorType, e.actorId]).toEqual(["system", null]);
          const held = heldParts(m, t.before.parts.filter((p) => p.householdId === householdId), t.before.requests);
          expect(held.reduce((n, h) => n + h.roles.length, 0)).toBe(removed);
        }
      }),
      RUNS,
    );
  });
});
