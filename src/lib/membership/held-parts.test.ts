import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { heldParts } from "./held-parts";
import { applyModel } from "./model";
import { stateArb, T0 } from "./model.arbitraries";

describe("Feature: family-app-demo-parity, Property 17: Held_Parts listed on confirmation match the departure", () => {
  it("lists exactly what a leave changes", () => {
    fc.assert(
      fc.property(stateArb(), fc.nat(50), (state, ref) => {
        const active = state.members.filter((m) => m.isActive);
        const member = active[ref % active.length];
        const householdParts = state.parts.filter((p) => p.householdId === member.householdId);
        const held = heldParts(member.id, householdParts, state.requests);
        const out = applyModel(state, { kind: "leave", householdId: member.householdId, actorUserId: member.userId }, T0);
        fc.pre(!out.refused); // the last primary cannot leave
        const after = out.state;

        expect(held.map((h) => h.partId)).toEqual([...held.map((h) => h.partId)].sort());
        for (const part of householdParts) {
          const h = held.find((x) => x.partId === part.partId);
          const now = after.parts.find((p) => p.partId === part.partId)!;
          const removed = (
            [["owner", "ownerId"], ["driver", "driverId"], ["companion", "companionId"], ["backup_owner", "backupOwnerId"]] as const
          ).filter(([, f]) => part[f] === member.id && now[f] === null).map(([r]) => r);
          const declined = state.requests
            .filter((r) => r.partId === part.partId && r.status === "pending" && after.requests.find((x) => x.id === r.id)!.status === "declined")
            .map((r) => r.id);
          if (!h) {
            expect(removed).toEqual([]);
            expect(declined).toEqual([]);
            expect(now).toEqual(part);
            continue;
          }
          expect(h.roles).toEqual(removed);
          expect(h.pendingRequestIds).toEqual(declined);
          expect(h.ownerless).toBe(removed.includes("owner"));
          expect(h.approvalWillReset).toBe(part.approvalState === "approved" && now.approvalState === "pending");
        }
        // Closed parts never appear.
        for (const h of held) expect(householdParts.find((p) => p.partId === h.partId)!.isOpen).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
