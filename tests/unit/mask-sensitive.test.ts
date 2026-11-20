import { describe, expect, it } from "vitest";
import { MASK, maskSensitive } from "@/lib/safety/mask-sensitive";

describe("maskSensitive", () => {
  it("masks Luhn-valid card numbers, with or without separators", () => {
    const a = maskSensitive("Pay with 4242 4242 4242 4242 today");
    expect(a.text).toBe(`Pay with ${MASK} today`);
    expect(a.kinds).toEqual(["card_number"]);
    expect(maskSensitive("card 4242-4242-4242-4242").text).not.toMatch(/4242/);
  });
  it("masks 12-digit ID numbers but leaves phone numbers and dates alone", () => {
    expect(maskSensitive("ID 1234 5678 9012").kinds).toContain("id_number");
    const safe = "Call 0312345678 on 2030-01-01 at 10:30";
    expect(maskSensitive(safe).text).toBe(safe);
  });
  it("masks labeled bank account numbers in English and Japanese", () => {
    const en = maskSensitive("Account number: 12345678");
    expect(en.text).toBe(`Account number: ${MASK}`);
    expect(en.kinds).toEqual(["bank_account"]);
    expect(maskSensitive("口座番号：１２３４５６７").text).toBe(`口座番号:${MASK}`);
  });
  it("masks insurance numbers, passwords and one-time codes", () => {
    expect(maskSensitive("Insurance no: AB-123456").text).toBe(`Insurance no: ${MASK}`);
    expect(maskSensitive("password: hunter22").text).toBe(`password: ${MASK}`);
    expect(maskSensitive("パスワード: abc12345").kinds).toEqual(["password"]);
    expect(maskSensitive("Your verification code is 482913").text).toBe(
      `Your verification code is ${MASK}`,
    );
  });
  it("leaves ordinary notes unchanged", () => {
    const note = "Take pills at 8am. Pick up Mia at 3:30pm from school.";
    expect(maskSensitive(note)).toEqual({ text: note, kinds: [] });
  });
  it("matches PIN and OTP labels only as whole words", () => {
    for (const ok of [
      "Buy spinach and eggs",
      "Shopping: eggs, milk",
      "Make hotpot 1234 style",
      "Pinpoint the date",
    ]) {
      expect(maskSensitive(ok)).toEqual({ text: ok, kinds: [] });
    }
    expect(maskSensitive("PIN: 4821").text).toBe(`PIN: ${MASK}`);
    expect(maskSensitive("my pin is 4821").kinds).toEqual(["password"]);
    expect(maskSensitive("OTP 482913").text).toBe(`OTP ${MASK}`);
  });
});
