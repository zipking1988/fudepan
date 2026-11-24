import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MEMBERSHIP_EVENT_TYPES } from "./audit-payload";
import { heldParts } from "./held-parts";
import { RUNS, runScenario, scenarioArb, type TraceEntry } from "./model.arbitraries";

const MEMBERSHIP = new Set<string>(MEMBERSHIP_EVENT_TYPES);

function newlyExpired(t: TraceEntry, householdId: string): number {
  return t.before.invites.filter(
    (i) => i.householdId === householdId && i.state === "pending" && t.now.getTime() >= i.expiresAt.getTime(),
  ).length;
}

function expectedTypes(t: TraceEntry): string[] {
  const op = t.op;
  const expired = (h: string) => Array<string>(newlyExpired(t, h)).fill("invite.expired");
  switch (t.after.outcome) {
    case "created":
      return op.kind === "create_household"
        ? ["household.created", "member.joined"]
        : [...expired((op as { householdId: string }).householdId), "invite.created"];
    case "listed":
      return expired((op as { householdId: string }).householdId);
    case "revoked":
      return [...expired((op as { householdId: string }).householdId), "invite.revoked"];
    case "not_pending":
      return expired((op as { householdId: string }).householdId);
    case "usable":
    case "unusable": {
      if (op.kind === "preview_invite") {
        const inv = t.before.invites.find((i) => i.token === op.token);
        return inv ? expired(inv.householdId) : [];
      }
      if (op.kind === "accept_invite") {
        const inv = t.before.invites.find((i) => i.token === op.token);
        return inv && inv.state === "pending" && t.now.getTime() >= inv.expiresAt.getTime() ? ["invite.expired"] : [];
      }
      return [];
    }
    case "joined": {
      const o = op as { userId: string; token: string };
      const inv = t.before.invites.find((i) => i.token === o.token)!;
      const former = t.before.members.some((m) => m.userId === o.userId && m.householdId === inv.householdId);
      return [former ? "member.rejoined" : "member.joined", "invite.accepted"];
    }
    case "role_changed":
      return ["member.role_changed"];
    case "deactivated":
      return ["member.deactivated"];
    case "left":
      return ["member.left"];
    case "renamed":
      return ["member.display_name_changed"];
    default:
      return [];
  }
}

describe("Feature: family-app-demo-parity, Property 8: Every successful membership action writes its audit, feed, and reminder records", () => {
  it("writes exactly the audit events, feed items, and reminders the design lists", () => {
    fc.assert(
      fc.property(scenarioArb(), (sc) => {
        for (const t of runScenario(sc)) {
          const after = t.after.state;
          // Audit rows are append-only.
          expect(after.audit.slice(0, t.before.audit.length)).toEqual(t.before.audit);
          if (t.after.refused) continue;

          const fresh = after.audit.slice(t.before.audit.length).filter((e) => MEMBERSHIP.has(e.type));
          expect(fresh.map((e) => e.type).sort()).toEqual(expectedTypes(t).sort());
          const op = t.op;
          const actor = "actorUserId" in op ? op.actorUserId : "userId" in op ? op.userId : null;
          for (const e of fresh) {
            if (e.type === "invite.expired") expect([e.actorType, e.actorId]).toEqual(["system", null]);
            else expect([e.actorType, e.actorId]).toEqual(["human", actor]);
          }

          const feed = after.feed.slice(t.before.feed.length);
          const reminders = after.reminders.slice(t.before.reminders.length);

          if (t.after.outcome === "joined") {
            const memberId = t.after.result.member_id as string;
            const hid = after.members.find((m) => m.id === memberId)!.householdId;
            expect(feed.map((f) => f.kind)).toEqual(["member_joined"]);
            expect(feed[0].params.member_id).toBe(memberId);
            const others = after.members.filter((m) => m.householdId === hid && m.isActive && m.role === "primary_caregiver" && m.id !== memberId);
            expect(reminders.map((r) => [r.kind, r.memberId])).toEqual(others.map((m) => ["member_joined", m.id]));
          } else if (t.after.outcome === "role_changed" && (op as { role: string }).role !== "care_recipient") {
            expect(feed.map((f) => f.kind)).toEqual(["member_role_changed"]);
            expect(reminders.map((r) => [r.kind, r.memberId])).toEqual([["member_role_changed", (op as { memberId: string }).memberId]]);
          } else if (["role_changed", "deactivated", "left"].includes(t.after.outcome)) {
            const memberId =
              op.kind === "leave"
                ? t.before.members.find((m) => m.userId === op.actorUserId && m.householdId === op.householdId)!.id
                : (op as { memberId: string }).memberId;
            const hid = (op as { householdId: string }).householdId;
            const held = heldParts(memberId, t.before.parts.filter((p) => p.householdId === hid), t.before.requests);
            const ownerless = held.filter((h) => h.ownerless);
            const needs = feed.filter((f) => f.kind === "part_released");
            expect(needs.map((f) => f.partId).sort()).toEqual(ownerless.map((h) => h.partId).sort());
            const remaining = after.members.filter((m) => m.householdId === hid && m.isActive && m.role === "primary_caregiver" && m.id !== memberId);
            const noticeReminders = reminders.filter((r) => r.kind === "part_needs_someone");
            expect(noticeReminders).toHaveLength(ownerless.length * remaining.length);
            for (const h of ownerless) {
              expect(noticeReminders.filter((r) => r.partId === h.partId).map((r) => r.memberId).sort()).toEqual(remaining.map((m) => m.id).sort());
            }
            expect(feed.filter((f) => f.kind === "member_role_changed")).toHaveLength(t.after.outcome === "role_changed" ? 1 : 0);
          } else {
            expect(feed).toEqual([]);
            expect(reminders).toEqual([]);
          }
        }
      }),
      RUNS,
    );
  });
});
