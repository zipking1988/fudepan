/** Browser-safe part of the invite token rules (no `node:crypto`), shared with `invite-token.ts`. */

/** 32 bytes in base64url without padding is 43 characters. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** "#<token>" gives the token. Anything that is not a well-formed token gives null. */
export function tokenFromFragment(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return INVITE_TOKEN_PATTERN.test(raw) ? raw : null;
}
