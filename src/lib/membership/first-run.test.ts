import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HOUSEHOLD_ROLES } from "@/lib/households/membership";
import { firstRunPrompts, type DismissiblePrompt } from "./first-run";

describe("Feature: family-app-demo-parity, Property 18: First-run prompts follow the household's state", () => {
  it("shows the prompts the household state calls for", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...HOUSEHOLD_ROLES),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(),
        fc.subarray<DismissiblePrompt>(["invite_family", "invite_recipient"]),
        (viewerRole, eventCount, activeMemberCount, hasActiveRecipient, dismissed) => {
          const out = firstRunPrompts({
            viewerRole, eventCount, activeMemberCount, hasActiveRecipient, dismissed: new Set(dismissed),
          });
          if (viewerRole === "care_recipient") {
            expect(out).toEqual(eventCount === 0 ? ["recipient_take_photo"] : []);
            return;
          }
          expect(out.includes("take_photo")).toBe(eventCount === 0);
          expect(out.includes("recipient_take_photo")).toBe(false);
          const primary = viewerRole === "primary_caregiver";
          expect(out.includes("invite_family")).toBe(primary && activeMemberCount === 1 && !dismissed.includes("invite_family"));
          expect(out.includes("invite_recipient")).toBe(primary && !hasActiveRecipient && !dismissed.includes("invite_recipient"));
        },
      ),
      { numRuns: 300 },
    );
  });
});
