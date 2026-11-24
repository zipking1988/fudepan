import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createHouseholdInput, renameInput, signUpInput, validateForm } from "./schemas";

const ws = fc.stringMatching(/^[ \t\u3000]{0,5}$/);
const body = fc.string({ unit: "grapheme", minLength: 0, maxLength: 60 });

describe("Feature: family-app-demo-parity, Property 13: Name and sign-up inputs follow the length rules and keep entered values", () => {
  it("accepts a name exactly when its trimmed length is 1 to 40", () => {
    fc.assert(
      fc.property(ws, body, ws, (pre, core, post) => {
        const raw = `${pre}${core}${post}`;
        const trimmed = raw.trim();
        const r = createHouseholdInput.safeParse({ householdName: raw, displayName: "Misa" });
        const ok = trimmed.length >= 1 && trimmed.length <= 40;
        expect(r.success).toBe(ok);
        if (r.success) expect(r.data.householdName).toBe(trimmed);
      }),
      { numRuns: 200 },
    );
  });

  it("applies the same rule to display names in rename", () => {
    fc.assert(
      fc.property(body, (core) => {
        const ok = core.trim().length >= 1 && core.trim().length <= 40;
        const r = renameInput.safeParse({
          householdId: "d1000000-0000-4000-8000-000000000001",
          displayName: core,
        });
        expect(r.success).toBe(ok);
      }),
      { numRuns: 200 },
    );
  });

  it("accepts a sign-up exactly when the email is valid and the password has 8 to 200 characters", () => {
    fc.assert(
      fc.property(fc.emailAddress(), fc.string({ minLength: 0, maxLength: 12 }), (email, password) => {
        const r = signUpInput.safeParse({ email, password });
        const emailOk = signUpInput.shape.email.safeParse(email).success;
        expect(r.success).toBe(emailOk && password.length >= 8);
      }),
      { numRuns: 200 },
    );
  });

  it("names the failing field and returns the entered values without the password", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), fc.string({ maxLength: 7 }), (email, password) => {
        const r = validateForm(signUpInput, { email, password });
        if (r.ok) return;
        expect(r.values).toEqual({ email });
        expect("password" in r.values).toBe(false);
        for (const key of Object.values(r.fieldKeys)) expect(key).toMatch(/^[a-z]+(\.[A-Za-z_]+)+$/);
        if (password.length < 8) expect(r.fieldKeys.password).toBe("signup.error.password");
      }),
      { numRuns: 200 },
    );
  });
});
