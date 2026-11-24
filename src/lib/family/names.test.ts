import { describe, expect, it } from "vitest";
import { careRecipientName, firstName, hasHonorific } from "./names";

const member = (role: string, displayName: string, isActive = true) => ({
  role,
  displayName,
  isActive,
});

describe("firstName", () => {
  it("drops the family's note in brackets and keeps the rest as written", () => {
    expect(firstName("Haruko (Mom)")).toBe("Haruko");
    expect(firstName("春子（母）")).toBe("春子");
    expect(firstName(undefined)).toBe("");
  });
});

describe("hasHonorific", () => {
  it("is true for names that already end with an honorific", () => {
    expect(hasHonorific("おばあちゃん")).toBe(true);
    expect(hasHonorific("春子さん ")).toBe(true);
    expect(hasHonorific("田中様")).toBe(true);
    expect(hasHonorific("けんたくん")).toBe(true);
    expect(hasHonorific("春子")).toBe(false);
    expect(hasHonorific("Haruko")).toBe(false);
  });
});

describe("careRecipientName", () => {
  it("is the first name of the only active care recipient", () => {
    expect(
      careRecipientName([
        member("primary_caregiver", "Kenta"),
        member("care_recipient", "Haruko (Mom)"),
      ]),
    ).toBe("Haruko");
    expect(
      careRecipientName([
        member("care_recipient", "Haruko"),
        member("care_recipient", "Jiro", false),
      ]),
    ).toBe("Haruko");
  });

  it("is null with no active care recipient, more than one, or a blank first name", () => {
    expect(careRecipientName([member("primary_caregiver", "Kenta")])).toBeNull();
    expect(careRecipientName([member("care_recipient", "Haruko", false)])).toBeNull();
    expect(
      careRecipientName([member("care_recipient", "Haruko"), member("care_recipient", "Jiro")]),
    ).toBeNull();
    expect(careRecipientName([member("care_recipient", "(Mom)")])).toBeNull();
  });
});
