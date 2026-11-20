import { describe, expect, it } from "vitest";
import {
  MEDICINE_TEXT,
  SCAM_LINES,
  SCAM_SIGNALS,
  SCAM_TEXT,
  STATS,
  assess,
} from "@/lib/demo/landing";
import { detectCautions } from "@/lib/risk-rules";
import { maskSensitive } from "@/lib/safety/mask-sensitive";

describe("landing page example notes", () => {
  it("the medicine note is rated by the real rules as medication, high risk", () => {
    expect(assess(MEDICINE_TEXT)).toEqual({
      category: "medication",
      risk: "high",
      possibleFraud: false,
    });
  });

  it("the scam note is rated high risk and flagged as a possible scam", () => {
    const a = assess(SCAM_TEXT);
    expect(a.risk).toBe("high");
    expect(a.possibleFraud).toBe(true);
    expect(SCAM_TEXT).toBe(SCAM_LINES.join("\n"));
  });

  it("every marked warning sign appears in the scam note", () => {
    for (const s of SCAM_SIGNALS) expect(SCAM_TEXT).toContain(s.text);
  });

  it("the marked signs match what the scam rule actually reacts to", () => {
    const by = (kind: string) => SCAM_SIGNALS.find((s) => s.kind === kind)!.text;
    expect(detectCautions(by("secrecy")).possibleFraud).toBe(true);
    expect(detectCautions(`${by("urgency")} ${by("money")}`).possibleFraud).toBe(true);
    expect(detectCautions(by("urgency")).possibleFraud).toBe(false);
    expect(detectCautions(by("money")).possibleFraud).toBe(false);
  });

  it("the example notes contain nothing that needs masking", () => {
    for (const text of [MEDICINE_TEXT, SCAM_TEXT]) {
      expect(maskSensitive(text).kinds).toEqual([]);
    }
  });
});

describe("landing page statistics", () => {
  it("every figure links to an https source", () => {
    for (const s of Object.values(STATS)) {
      expect(s.href).toMatch(/^https:\/\//);
      expect(s.source.length).toBeGreaterThan(5);
      expect(s.figure.length).toBeGreaterThan(0);
    }
  });

  it("only the sourced 51% figure uses a percentage", () => {
    const withPercent = Object.values(STATS).filter((s) => /\d\s?%/.test(s.figure + s.text));
    expect(withPercent.map((s) => s.figure)).toEqual(["51%"]);
  });

  it("statistics text contains nothing that needs masking", () => {
    for (const s of Object.values(STATS)) {
      expect(maskSensitive(`${s.figure} ${s.text} ${s.source}`).kinds).toEqual([]);
    }
  });
});
