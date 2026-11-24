import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildInviteLink, generateInviteToken, hashInviteToken, INVITE_TOKEN_PATTERN, tokenFromFragment } from "./invite-token";
import { effectiveInviteState } from "./invite-state";

const bytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 });
const gen = (b: Uint8Array) => generateInviteToken(() => b);

describe("Feature: family-app-demo-parity, Property 9: Invite tokens are strong, round-trip through the fragment, and stay out of logged URL parts", () => {
  it("makes a 43-character base64url token that maps one-to-one from the bytes", () => {
    fc.assert(
      fc.property(bytes32, bytes32, (a, b) => {
        const ta = gen(a);
        expect(ta).toMatch(INVITE_TOKEN_PATTERN);
        expect(ta).toHaveLength(43);
        expect(Buffer.from(ta, "base64url")).toEqual(Buffer.from(a));
        if (Buffer.compare(Buffer.from(a), Buffer.from(b)) !== 0) expect(gen(b)).not.toBe(ta);
      }),
      { numRuns: 200 },
    );
  });

  it("hashes to 32 bytes, deterministically, and the hash differs from the token", () => {
    fc.assert(
      fc.property(bytes32, (b) => {
        const t = gen(b);
        const h = hashInviteToken(t);
        expect(h).toHaveLength(32);
        expect(Buffer.from(h)).toEqual(Buffer.from(hashInviteToken(t)));
        expect(Buffer.from(h).toString("base64url")).not.toBe(t);
      }),
      { numRuns: 200 },
    );
  });

  it("round-trips through the link fragment and keeps the token out of every logged URL part", () => {
    fc.assert(
      fc.property(bytes32, fc.webUrl({ withFragments: false, withQueryParameters: false }), (b, webUrl) => {
        const origin = new URL(webUrl).origin;
        const t = gen(b);
        const link = buildInviteLink(origin, t);
        const url = new URL(link);
        expect(url.hash).toBe(`#${t}`);
        expect(tokenFromFragment(url.hash)).toBe(t);
        expect(url.pathname).toBe("/join");
        expect(url.search).toBe("");
        expect(`${url.origin}${url.pathname}${url.search}`).not.toContain(t);
      }),
      { numRuns: 200 },
    );
  });

  it("rejects fragments that are not well-formed tokens", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 80 }), (s) => {
        const out = tokenFromFragment(`#${s}`);
        expect(out === null || INVITE_TOKEN_PATTERN.test(out)).toBe(true);
        if (!INVITE_TOKEN_PATTERN.test(s)) expect(out).toBeNull();
      }),
      { numRuns: 200 },
    );
  });
});

describe("effectiveInviteState", () => {
  it("expires a pending invite exactly at expiresAt", () => {
    const at = new Date("2026-12-20T00:00:00Z");
    expect(effectiveInviteState("pending", at, new Date(at.getTime() - 1))).toBe("pending");
    expect(effectiveInviteState("pending", at, at)).toBe("expired");
    expect(effectiveInviteState("accepted", at, new Date(at.getTime() + 1))).toBe("accepted");
  });
});
