import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ROLES } from "@/lib/households/membership";
import { maskLogFields, LOG_FIELDS, MEMBERSHIP_LOG_EVENTS } from "@/lib/log";
import { MEMBERSHIP_EVENT_TYPES, membershipAuditPayload } from "./audit-payload";
import { generateInviteToken } from "./invite-token";

const eventType = fc.constantFrom(...MEMBERSHIP_EVENT_TYPES);
const role = fc.constantFrom(...HOUSEHOLD_ROLES);
const token = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => generateInviteToken(() => b));
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe("Feature: family-app-demo-parity, Property 10: Audit payloads and logs carry no personal data or tokens", () => {
  it("keeps only UUID, Role, state, and reason values, and drops names, emails, and tokens", () => {
    fc.assert(
      fc.property(
        eventType,
        fc.record({
          householdId: fc.uuid(),
          memberId: fc.uuid(),
          inviteId: fc.uuid(),
          role,
          oldRole: role,
          newRole: role,
          state: fc.constantFrom("pending", "accepted", "revoked", "expired"),
          reason: fc.constantFrom("member_departed", "expired"),
        }),
        fc.emailAddress(),
        fc.string({ unit: "grapheme", minLength: 1, maxLength: 40 }),
        token,
        (event, ids, email, name, tok) => {
          const payload = membershipAuditPayload(event, {
            ...ids,
            email,
            displayName: name,
            token: tok,
            note: tok,
          });
          const json = JSON.stringify(payload);
          expect(json).not.toContain(tok);
          if (!ids.reason.includes(email)) expect(json).not.toContain(email);
          for (const [k, v] of Object.entries(payload)) {
            if (k.endsWith("_id")) expect(v).toMatch(uuidRe);
            else if (k === "role" || k === "old_role" || k === "new_role") expect(HOUSEHOLD_ROLES).toContain(v);
            else expect(v).toMatch(/^[a-z][a-z0-9_]*$/);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it("drops values with the wrong shape, even in allowed fields", () => {
    fc.assert(
      fc.property(eventType, fc.string({ minLength: 1, maxLength: 30 }), (event, junk) => {
        const payload = membershipAuditPayload(event, { memberId: junk, inviteId: junk, role: junk, reason: junk });
        for (const [k, v] of Object.entries(payload)) {
          expect(k.endsWith("_id") ? uuidRe.test(v) : /^[a-z][a-z0-9_]*$/.test(v)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("log masking passes only ID and code fields for membership events", () => {
    for (const event of MEMBERSHIP_LOG_EVENTS) expect(event).toMatch(/^membership\.[a-z_]+$/);
    fc.assert(
      fc.property(fc.emailAddress(), fc.string({ unit: "grapheme", maxLength: 40 }), token, (email, name, tok) => {
        const masked = maskLogFields({
          household_id: "d1000000-0000-4000-8000-000000000001",
          reason: "unusable",
          code: "P0001",
          count: 2,
          email,
          display_name: name,
          token: tok,
          invite_token: tok,
        });
        expect(Object.keys(masked).every((k) => (LOG_FIELDS as readonly string[]).includes(k))).toBe(true);
        expect(JSON.stringify(masked)).not.toContain(tok);
        expect(JSON.stringify(masked)).not.toContain(email);
        // Even if a token is passed in an allowed field, it is redacted unless it looks like a short code.
        const leaked = maskLogFields({ reason: `${tok}${tok}`, code: email });
        expect(JSON.stringify(leaked)).not.toContain(tok);
        expect(JSON.stringify(leaked)).not.toContain(email);
      }),
      { numRuns: 200 },
    );
  });
});
