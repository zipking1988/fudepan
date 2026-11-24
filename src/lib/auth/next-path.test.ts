import { describe, expect, it } from "vitest";
import { DEFAULT_SIGNED_IN_PATH, isProtectedPagePath, safeNextPath } from "./next-path";

const ID = "28a154ff-0000-4000-8000-000000000001";

describe("safeNextPath", () => {
  it("keeps note and family pages", () => {
    for (const p of ["/notes", `/notes/${ID}`, "/family", "/family/capture", "/family/settings/language", `/family/events/${ID}`, `/family/events/${ID}/timeline`, `/family/me/${ID}`, "/join", "/welcome", "/family/members", "/family/invites"]) {
      expect(safeNextPath(p)).toBe(p);
    }
  });
  it("falls back to the family home for anything else", () => {
    expect(DEFAULT_SIGNED_IN_PATH).toBe("/family");
    for (const p of ["//evil.com", "/family/../x", "/family/events/abc", "/join/x", "/join#abc", "/welcome/x", "/family/members/x", "/signup", "https://x.com", "", null, undefined]) {
      expect(safeNextPath(p)).toBe("/family");
    }
  });
  it("keeps an old notes page that was asked for on purpose", () => {
    expect(safeNextPath("/notes")).toBe("/notes");
    expect(safeNextPath(`/notes/${ID}`)).toBe(`/notes/${ID}`);
  });
});

describe("isProtectedPagePath", () => {
  it("protects /notes and /family pages but not the image route or the landing page", () => {
    expect(isProtectedPagePath("/family")).toBe(true);
    expect(isProtectedPagePath("/family/capture")).toBe(true);
    expect(isProtectedPagePath("/notes")).toBe(true);
    expect(isProtectedPagePath("/welcome")).toBe(true);
    expect(isProtectedPagePath("/family/members")).toBe(true);
    expect(isProtectedPagePath("/join")).toBe(false);
    expect(isProtectedPagePath("/signup")).toBe(false);
    expect(isProtectedPagePath("/auth/callback")).toBe(false);
    expect(isProtectedPagePath(`/notes/${ID}/image`)).toBe(false);
    expect(isProtectedPagePath("/familyx")).toBe(false);
    expect(isProtectedPagePath("/")).toBe(false);
  });
});
