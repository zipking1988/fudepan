import { describe, expect, it } from "vitest";

import { safeNextPath } from "@/lib/auth/next-path";

import { HOUSEHOLD_ROLES, canUploadNotes, chooseHousehold, type Membership } from "./membership";

const demo: Membership = {
  householdId: "d0000000-0000-4000-8000-000000000001",
  householdName: "Demo household",
  role: "primary_caregiver",
  displayName: "Misa",
};
const second: Membership = {
  householdId: "e0000000-0000-4000-8000-000000000001",
  householdName: "Grandpa's house",
  role: "family_member",
  displayName: "Misa",
};

describe("canUploadNotes", () => {
  it("lets every active role upload, including the care recipient", () => {
    for (const role of HOUSEHOLD_ROLES) {
      expect(canUploadNotes(role), role).toBe(true);
    }
  });
});

describe("chooseHousehold", () => {
  it("uses the oldest membership by default", () => {
    expect(chooseHousehold([demo, second], null)).toEqual({
      kind: "ok",
      current: demo,
      all: [demo, second],
    });
  });

  it("switches to another household the person belongs to", () => {
    expect(chooseHousehold([demo, second], second.householdId)).toMatchObject({
      kind: "ok",
      current: second,
    });
  });

  it("refuses a household the person does not belong to, instead of showing another", () => {
    expect(chooseHousehold([demo], second.householdId)).toEqual({ kind: "not_member" });
  });

  it("reports when the person has no household", () => {
    expect(chooseHousehold([], null)).toEqual({ kind: "no_household" });
    expect(chooseHousehold([], demo.householdId)).toEqual({ kind: "no_household" });
  });
});

describe("safeNextPath", () => {
  it("allows only this app's note pages after sign-in", () => {
    expect(safeNextPath("/notes")).toBe("/notes");
    expect(safeNextPath(`/notes/${demo.householdId}`)).toBe(`/notes/${demo.householdId}`);
    for (const bad of [
      "https://evil.example/notes",
      "//evil.example",
      "/notes/../admin",
      "/notes?household=x",
      "/notes/not-a-uuid",
      "/login",
      null,
      undefined,
      42,
    ]) {
      expect(safeNextPath(bad)).toBe("/notes");
    }
  });
});
