import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SIGN_IN_HELP } from "./help";

const all = [
  SIGN_IN_HELP.title,
  ...SIGN_IN_HELP.noAccount.steps,
  SIGN_IN_HELP.demoStep,
  ...SIGN_IN_HELP.forgotPassword.steps,
]
  .join(" ")
  .toLowerCase();

describe("sign-in help matches how accounts work today", () => {
  it("says who to contact and what to ask for, for both problems", () => {
    expect(SIGN_IN_HELP.noAccount.steps.join(" ")).toMatch(/organizes care in your household/);
    expect(SIGN_IN_HELP.noAccount.steps.join(" ")).toMatch(/invite link/);
    expect(SIGN_IN_HELP.noAccount.steps.join(" ")).not.toMatch(/Create an account/);
    expect(SIGN_IN_HELP.demoStep).toMatch(/Sign in to the demo/);
    expect(SIGN_IN_HELP.forgotPassword.steps.join(" ")).toMatch(/household organizer/);
    expect(SIGN_IN_HELP.forgotPassword.steps.join(" ")).toMatch(/password reset/);
  });

  it("does not send people looking for codes, emails, or pages that do not exist", () => {
    expect(all).toMatch(/no invite code to look for/);
    expect(all).toMatch(/can’t send a reset link/);
    expect(all).not.toMatch(/https?:|\/[a-z]+-?[a-z]*\b(?=\s|$)/);
    expect(all).not.toMatch(
      /we(’|')ll (send|email)|check your (inbox|email)|enter (your|the) code/,
    );
  });

  it("stays true to the auth settings: sign-up is on", () => {
    const config = readFileSync(new URL("../../../supabase/config.toml", import.meta.url), "utf8");
    const auth = config.slice(
      config.indexOf("[auth]"),
      config.indexOf("[auth.", config.indexOf("[auth]") + 1),
    );
    expect(auth).toMatch(/^enable_signup = true$/m);
  });
});
