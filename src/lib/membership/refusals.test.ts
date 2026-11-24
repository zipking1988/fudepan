import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createTranslator, isMessageKey } from "@/lib/i18n/messages";
import { MEMBERSHIP_REFUSAL_CODES, membershipRefusalKey } from "./refusals";
import { generateInviteToken } from "./invite-token";

const token = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => generateInviteToken(() => b));

describe("Feature: family-app-demo-parity, Property 11: Every failure maps to a plain-language message", () => {
  const input = fc.oneof(
    fc.string({ maxLength: 80 }),
    fc.constantFrom(...MEMBERSHIP_REFUSAL_CODES, "server_error"),
    fc.constantFrom(
      'duplicate key value violates unique constraint "household_invites_token_hash_unique"',
      "relation \"public.household_members\" does not exist",
      "JWT expired",
    ),
    token,
    token.map((t) => `error at /join#${t}`),
  );

  it("always gives a known key whose English and Japanese text is non-empty and leaks nothing", () => {
    fc.assert(
      fc.property(input, (code) => {
        const key = membershipRefusalKey(code);
        expect(isMessageKey(key)).toBe(true);
        for (const lang of ["en", "ja"] as const) {
          const text = createTranslator(lang).t(key);
          expect(text.length).toBeGreaterThan(0);
          expect(text).not.toMatch(/P0001|Error:|\bat\s+\S+\.(ts|js)|constraint|relation|JWT|stack/i);
          if (code.length >= 8) expect(text).not.toContain(code);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("maps every known code to its own key and everything else to the generic key", () => {
    for (const code of MEMBERSHIP_REFUSAL_CODES) {
      expect(membershipRefusalKey(code)).toBe(`membership.refusal.${code}`);
    }
    expect(membershipRefusalKey("server_error")).toBe("membership.error.generic");
    expect(membershipRefusalKey("__proto__")).toBe("membership.error.generic");
    expect(membershipRefusalKey("toString")).toBe("membership.error.generic");
  });
});
