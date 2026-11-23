import { describe, expect, it } from "vitest";

import * as defaults from "@/lib/care/rules/defaults";
import { REFUSAL_MESSAGE_KEYS, refusalMessageKey, type RefusalCode } from "@/lib/care/rules/refusals";

describe("refusal message keys", () => {
  const codes = Object.keys(REFUSAL_MESSAGE_KEYS) as RefusalCode[];

  it("gives every refusal code a non-empty message key", () => {
    expect(codes.length).toBe(27);
    for (const code of codes) {
      expect(refusalMessageKey(code)).toMatch(/^refusal\.[A-Za-z]+$/);
    }
  });

  it("shares one message between part_not_found and request_not_found", () => {
    expect(refusalMessageKey("part_not_found")).toBe(refusalMessageKey("request_not_found"));
  });

  it("uses a distinct message for every other code", () => {
    const keys = codes.filter((c) => c !== "request_not_found").map(refusalMessageKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("pending defaults", () => {
  it("holds the design values", () => {
    expect(defaults.REQUEST_EXPIRY_HOURS).toBe(24);
    expect(defaults.REOPEN_AND_BACKUP_ROLES).toEqual(["owner", "primary_caregiver"]);
    expect(defaults.ESCALATION_LEDGER_KEY).toEqual(["care_step_id", "deadline_kind", "deadline_at"]);
    expect(defaults.COMPLETED_LABEL_KEY).toBe("done");
    expect(defaults.HANDOVER_PAST_DUE_FALLBACK).toBe("24h");
    expect(defaults.ALLOW_LEGACY_BACKUP_CLEAR).toBe(false);
    expect(defaults.RELEASE_WINDOW_HOURS).toBe(24);
  });
});
