import { describe, expect, it } from "vitest";
import type { Membership } from "@/lib/households/membership";
import { familyLinks, isCurrentLink, parseLanguage, resolveFamilyContext } from "./session-core";

const m = (id: string, role: Membership["role"] = "family_member"): Membership => ({
  householdId: id,
  householdName: "Home",
  role,
  displayName: "Sam",
});
const member = { id: "m-1", role: "care_recipient", ui_language: "ja" };

describe("resolveFamilyContext", () => {
  it("picks the first household and reads role and language from the member row", () => {
    const r = resolveFamilyContext("u", [m("h1"), m("h2")], null, () => member);
    expect(r).toMatchObject({ kind: "ok", context: { householdId: "h1", memberId: "m-1", role: "care_recipient", language: "ja" } });
  });
  it("reports no household and a household the person is not in", () => {
    expect(resolveFamilyContext("u", [], null, () => member).kind).toBe("no_household");
    expect(resolveFamilyContext("u", [m("h1")], "h9", () => member).kind).toBe("not_member");
  });
  it("refuses a missing member row or unknown role", () => {
    expect(resolveFamilyContext("u", [m("h1")], null, () => null).kind).toBe("not_member");
    expect(resolveFamilyContext("u", [m("h1")], null, () => ({ ...member, role: "x" })).kind).toBe("not_member");
  });
});

describe("helpers", () => {
  it("defaults the language to English", () => {
    expect(parseLanguage(null)).toBe("en");
    expect(parseLanguage("fr")).toBe("en");
    expect(parseLanguage("ja")).toBe("ja");
  });
  it("limits links for the care recipient", () => {
    expect(familyLinks("care_recipient").map((l) => l.href)).toEqual(["/family/capture", "/family"]);
    expect(familyLinks("primary_caregiver")).toHaveLength(3);
  });
  it("marks the feed link current on event pages only for the feed", () => {
    expect(isCurrentLink("/family", "/family/events/x")).toBe(true);
    expect(isCurrentLink("/family", "/family/capture")).toBe(false);
    expect(isCurrentLink("/family/capture", "/family/capture")).toBe(true);
  });
});
