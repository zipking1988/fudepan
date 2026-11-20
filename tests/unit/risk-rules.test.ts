import { describe, expect, it } from "vitest";
import { classifyRisk, detectCautions, hasHighRiskKeyword, mapCategory } from "@/lib/risk-rules";

describe("mapCategory", () => {
  it.each([
    ["Take the blood pressure pills at 8am", "other", "medication"],
    ["処方箋の薬をもらう", "other", "medication"],
    ["Pay the electricity bill", "other", "payment"],
    ["家賃を振込", "reminder", "payment"],
    ["Dentist appointment Friday", "other", "appointment"],
    ["市役所で手続き", "other", "appointment"],
    ["Pick up Mia from school", "other", "pickup"],
    ["駅まで迎えに行く", "other", "pickup"],
    ["Buy groceries", "other", "reminder"],
    ["洗濯をする", "other", "reminder"],
  ] as const)("%s -> %s model says %s", (text, modelCategory, expected) => {
    expect(mapCategory(text, modelCategory).category).toBe(expected);
  });

  it("flags when keyword rules override the model", () => {
    expect(mapCategory("Pay the bill", "reminder")).toEqual({
      category: "payment",
      adjusted: true,
    });
    expect(mapCategory("Pay the bill", "payment")).toEqual({
      category: "payment",
      adjusted: false,
    });
  });
  it("uses precedence medication > payment > appointment > pickup", () => {
    expect(mapCategory("Pick up the prescription", "pickup").category).toBe("medication");
    expect(mapCategory("Pay the hospital bill", "other").category).toBe("payment");
    expect(mapCategory("Drive grandma to the clinic", "other").category).toBe("appointment");
  });
  it("keeps the model category when no keyword matches", () => {
    expect(mapCategory("Call Aunt Keiko", "other")).toEqual({ category: "other", adjusted: false });
    expect(mapCategory("Call Aunt Keiko", "reminder").category).toBe("reminder");
  });
  it("does not match keywords inside other words", () => {
    expect(mapCategory("Rebuild the shelf", "other").category).toBe("other");
    expect(hasHighRiskKeyword("The bus is fine")).toBe(true);
    expect(hasHighRiskKeyword("A busy day")).toBe(false);
  });
});

describe("classifyRisk", () => {
  it.each(["medication", "payment", "appointment", "pickup"] as const)(
    "%s is always high",
    (category) => {
      expect(classifyRisk({ category, text: "x", confidence: 1 }).level).toBe("high");
      expect(classifyRisk({ category, text: "x", confidence: 0.1 }).level).toBe("high");
      expect(classifyRisk({ category, text: "x", confidence: "manual" }).level).toBe("high");
    },
  );
  it("is high for each design-table keyword even under a low-risk category", () => {
    for (const word of [
      "prescription",
      "hospital",
      "clinic",
      "bank transfer",
      "invoice",
      "bill",
      "credit card",
      "reservation",
      "pickup",
      "travel",
      "transportation",
      "病院",
      "振込",
    ]) {
      expect(
        classifyRisk({ category: "reminder", text: `note about ${word}`, confidence: 1 }).level,
      ).toBe("high");
    }
  });
  it("is low for confident reminders such as shopping", () => {
    expect(classifyRisk({ category: "reminder", text: "Buy milk", confidence: 0.95 })).toEqual({
      level: "low",
      reasons: ["routine_task"],
    });
  });
  it("is medium for unknown categories and for low or missing confidence", () => {
    expect(classifyRisk({ category: "other", text: "Call Keiko", confidence: 0.95 }).level).toBe(
      "medium",
    );
    expect(classifyRisk({ category: "reminder", text: "Buy milk", confidence: 0.5 })).toEqual({
      level: "medium",
      reasons: ["low_confidence"],
    });
    expect(classifyRisk({ category: "reminder", text: "Buy milk", confidence: null }).level).toBe(
      "medium",
    );
  });
  it("treats a typed-in task without AI as not low-confidence", () => {
    expect(
      classifyRisk({ category: "reminder", text: "Buy milk", confidence: "manual" }).level,
    ).toBe("low");
  });
});

describe("detectCautions", () => {
  it("flags urgent payment requests and gift cards", () => {
    expect(detectCautions("Pay the man at the door immediately").possibleFraud).toBe(true);
    expect(detectCautions("Buy gift cards and read the numbers").possibleFraud).toBe(true);
    expect(detectCautions("至急、振込してください").possibleFraud).toBe(true);
  });
  it("does not flag ordinary notes", () => {
    expect(detectCautions("Pay the electricity bill on Friday").possibleFraud).toBe(false);
    expect(detectCautions("Urgent: buy milk").possibleFraud).toBe(false);
  });
});
