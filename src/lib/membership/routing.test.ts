import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/auth/next-path";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@/lib/households/membership";
import { uuid } from "./model.arbitraries";
import { postAuthDestination, recipientRouteDecision } from "./routing";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const allowed = [
  "/notes", "/family", "/family/capture", "/family/settings/language", "/family/members", "/family/invites",
  `/notes/${uuid(1)}`, `/family/events/${uuid(2)}`, `/family/events/${uuid(2)}/timeline`,
  `/family/me/${uuid(3)}`, `/family/me/${uuid(3)}/timeline`, "/join", "/welcome",
];
const pathArb = fc.oneof(
  fc.constantFrom(...allowed),
  fc.string({ maxLength: 20 }).map((s) => `/family/${s}`),
  fc.string({ maxLength: 20 }),
  fc.constant("https://evil.example/family"),
);
const roleOrNone = fc.constantFrom<HouseholdRole | null>(null, ...HOUSEHOLD_ROLES);

describe("Feature: family-app-demo-parity, Property 14: After authentication, each person lands in the right place", () => {
  it("routes by invite cookie, membership, and an allowed next path", () => {
    fc.assert(
      fc.property(roleOrNone, fc.boolean(), fc.option(pathArb, { nil: null }), (activeRole, hasInviteCookie, requestedNext) => {
        const to = postAuthDestination({ activeRole, hasInviteCookie, requestedNext });
        if (hasInviteCookie) {
          expect(to).toBe("/join");
          return;
        }
        if (activeRole === null) {
          expect(to).toBe("/welcome");
          return;
        }
        expect(to === "/family" || safeNextPath(to) === to).toBe(true);
        if (requestedNext !== null && safeNextPath(requestedNext) === requestedNext && activeRole !== "care_recipient") {
          expect(to).toBe(requestedNext);
        }
        if (activeRole === "care_recipient") {
          expect(to === "/family" || to.startsWith("/family/")).toBe(true);
          expect(recipientRouteDecision(activeRole, to).kind).toBe("stay");
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("ordinary sign-in from the landing page (no ?next=)", () => {
  // The login form carries safeNextPath(undefined) when the address has no next page.
  const plain = safeNextPath(undefined);
  it("opens the family home for an existing family member", () => {
    for (const role of HOUSEHOLD_ROLES.filter((r) => r !== "care_recipient")) {
      expect(postAuthDestination({ activeRole: role, hasInviteCookie: false, requestedNext: plain })).toBe("/family");
    }
  });
  it("keeps the care recipient, first household, and pending invite routes", () => {
    expect(postAuthDestination({ activeRole: "care_recipient", hasInviteCookie: false, requestedNext: plain })).toBe("/family");
    expect(postAuthDestination({ activeRole: "care_recipient", hasInviteCookie: false, requestedNext: "/notes" })).toBe("/family");
    expect(postAuthDestination({ activeRole: null, hasInviteCookie: false, requestedNext: plain })).toBe("/welcome");
    expect(postAuthDestination({ activeRole: "family_member", hasInviteCookie: true, requestedNext: plain })).toBe("/join");
  });
  it("still honors an allowed deep link asked for on purpose", () => {
    const event = `/family/events/${uuid(2)}`;
    expect(postAuthDestination({ activeRole: "family_member", hasInviteCookie: false, requestedNext: event })).toBe(event);
    expect(postAuthDestination({ activeRole: "primary_caregiver", hasInviteCookie: false, requestedNext: `/notes/${uuid(1)}` })).toBe(
      `/notes/${uuid(1)}`,
    );
  });
});

describe("Feature: family-app-demo-parity, Property 15: A care recipient only reaches recipient routes", () => {
  it("lets non-recipient roles stay everywhere", () => {
    fc.assert(
      fc.property(roleOrNone.filter((r): r is HouseholdRole => r !== null && r !== "care_recipient"), pathArb, (role, p) => {
        expect(recipientRouteDecision(role, p)).toEqual({ kind: "stay" });
      }),
      { numRuns: 150 },
    );
  });

  it("lets a care recipient stay only on /family, /family/capture, and /family/me/<uuid>", () => {
    fc.assert(
      fc.property(fc.oneof(pathArb, fc.string({ maxLength: 12 }).map((s) => `/family/me/${s}`)), (p) => {
        const isRecipientRoute =
          p === "/family" ||
          p === "/family/capture" ||
          (p.startsWith("/family/me/") && UUID_RE.test(p.slice("/family/me/".length).replace(/\/timeline$/, "")));
        const decision = recipientRouteDecision("care_recipient", p);
        expect(decision).toEqual(isRecipientRoute ? { kind: "stay" } : { kind: "redirect", to: "/family" });
      }),
      { numRuns: 300 },
    );
  });

  it("redirects the management pages", () => {
    for (const p of ["/family/members", "/family/invites", "/family/settings/language"]) {
      expect(recipientRouteDecision("care_recipient", p)).toEqual({ kind: "redirect", to: "/family" });
    }
  });
});
