import { describe, expect, it } from "vitest";

import { toMinorUnits } from "./amount";

describe("toMinorUnits", () => {
  it("converts major units to minor units exactly", () => {
    expect(toMinorUnits("3500", "JPY")).toBe(3500);
    expect(toMinorUnits("12.5", "USD")).toBe(1250);
    expect(toMinorUnits(" 0.07 ", "EUR")).toBe(7);
    expect(toMinorUnits("1.10", "USD")).toBe(110);
  });
  it("refuses anything that is not a plain amount for that currency", () => {
    for (const bad of ["", "abc", "-5", "1,000", "12.345", "1e3", ".5"]) {
      expect(toMinorUnits(bad, "USD")).toBeNull();
    }
    expect(toMinorUnits("12.5", "JPY")).toBeNull();
  });
});
