import { describe, expect, it } from "vitest";
import { MAX_PORTRAIT_BYTES, buildPortraitPath, checkPortrait, isPortraitPathFor, mayWritePortrait } from "./rules";
const H = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
describe("portrait rules", () => {
  it("decides the type by content and enforces size", () => {
    expect(checkPortrait(png)).toEqual({ ok: true, contentType: "image/png" });
    expect(checkPortrait(new Uint8Array([1, 2, 3, 4]))).toEqual({ ok: false, code: "unsupported_type" });
    expect(checkPortrait(new Uint8Array(0))).toEqual({ ok: false, code: "empty" });
    expect(checkPortrait(null)).toEqual({ ok: false, code: "no_file" });
    expect(checkPortrait(new Uint8Array(MAX_PORTRAIT_BYTES + 1))).toEqual({ ok: false, code: "too_large" });
  });
  it("builds household-scoped private paths", () => {
    const path = buildPortraitPath(H, M, 1760000000000, "image/png");
    expect(path).toBe(`${H}/${M}/1760000000000-portrait.png`);
    expect(isPortraitPathFor(path, H, M)).toBe(true);
    expect(isPortraitPathFor(path, M, H)).toBe(false);
    expect(isPortraitPathFor(`${H}/${M}/../x.png`, H, M)).toBe(false);
  });
  it("lets only an active primary caregiver write, and only for a care recipient", () => {
    const t = { role: "care_recipient", isActive: true };
    expect(mayWritePortrait({ role: "primary_caregiver", isActive: true }, t)).toBe(true);
    for (const role of ["family_member", "professional_caregiver", "care_recipient"]) expect(mayWritePortrait({ role, isActive: true }, t)).toBe(false);
    expect(mayWritePortrait({ role: "primary_caregiver", isActive: false }, t)).toBe(false);
    expect(mayWritePortrait({ role: "primary_caregiver", isActive: true }, { role: "family_member", isActive: true })).toBe(false);
    expect(mayWritePortrait({ id: "m1", role: "family_member", isActive: true }, { id: "m1", role: "family_member", isActive: true })).toBe(true);
    expect(mayWritePortrait({ id: "m1", role: "family_member", isActive: true }, { id: "m2", role: "family_member", isActive: true })).toBe(false);
    expect(mayWritePortrait({ id: "m1", role: "family_member", isActive: false }, { id: "m1", role: "family_member", isActive: false })).toBe(false);
  });
});
