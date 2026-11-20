import { describe, expect, it } from "vitest";
import { MAX_SANDBOX_LENGTH, NEXT_STEP_TEXT, checkNote } from "@/lib/demo/check-note";

const ok = (text: string) => {
  const r = checkNote(text);
  if (r.empty) throw new Error("expected a result");
  return r;
};

describe("checkNote (landing sandbox)", () => {
  it("returns an empty state for blank input", () => {
    expect(checkNote("")).toEqual({ empty: true });
    expect(checkNote("   \n ")).toEqual({ empty: true });
  });

  it("masks a card number before showing it", () => {
    const r = ok("カード番号 4242 4242 4242 4242 で払う");
    expect(r.masked).toContain("[MASKED]");
    expect(r.masked).not.toMatch(/4242/);
    expect(r.maskedKinds).toEqual(["card_number"]);
    expect(r.risk).toBe("high");
  });

  it("flags a fake-police scam as high risk", () => {
    const r = ok("警察の人から電話。キャッシュカードを封筒に入れて渡す。今日中。");
    expect(r).toMatchObject({ risk: "high", possibleFraud: true, nextStep: "approval" });
    expect(ok("今日中にカードを封筒に入れて渡す").possibleFraud).toBe(true);
  });

  it("lets a caregiver confirm shopping directly", () => {
    const r = ok("買い物 たまご・牛乳");
    expect(r).toMatchObject({
      category: "reminder",
      risk: "low",
      possibleFraud: false,
      nextStep: "confirm",
    });
    expect(NEXT_STEP_TEXT[r.nextStep]).toMatch(/confirm it directly/);
  });

  it("makes medicine wait for approval", () => {
    const r = ok("夜 血圧の薬をのむ");
    expect(r).toMatchObject({ category: "medication", risk: "high", nextStep: "approval" });
    expect(NEXT_STEP_TEXT[r.nextStep]).toMatch(/approve/);
  });

  it("treats unknown notes as medium", () => {
    expect(ok("Call Aunt Keiko")).toMatchObject({
      category: "other",
      risk: "medium",
      nextStep: "look",
    });
  });

  it("ignores text beyond the limit", () => {
    const r = ok("買い物 " + "あ".repeat(MAX_SANDBOX_LENGTH * 2));
    expect(r.masked.length).toBeLessThanOrEqual(MAX_SANDBOX_LENGTH);
  });
});
