import { describe, expect, it } from "vitest";
import { isProtectedPagePath, safeNextPath } from "./next-path";

const ID = "28a154ff-0000-4000-8000-000000000001";

describe("safeNextPath", () => {
  it("keeps note and family pages", () => {
    for (const p of ["/notes", `/notes/${ID}`, "/family", "/family/capture", "/family/settings/language", `/family/events/${ID}`, `/family/events/${ID}/timeline`, `/family/me/${ID}`]) {
      expect(safeNextPath(p)).toBe(p);
    }
  });
  it("falls back to /notes for anything else", () => {
    for (const p of ["//evil.com", "/family/../x", "/family/events/abc", "https://x.com", null]) {
      expect(safeNextPath(p)).toBe("/notes");
    }
  });
});

describe("isProtectedPagePath", () => {
  it("protects /notes and /family pages but not the image route or the landing page", () => {
    expect(isProtectedPagePath("/family")).toBe(true);
    expect(isProtectedPagePath("/family/capture")).toBe(true);
    expect(isProtectedPagePath("/notes")).toBe(true);
    expect(isProtectedPagePath(`/notes/${ID}/image`)).toBe(false);
    expect(isProtectedPagePath("/familyx")).toBe(false);
    expect(isProtectedPagePath("/")).toBe(false);
  });
});
