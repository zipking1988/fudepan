import { createHash } from "node:crypto";

export const INVITE_TOKEN_BYTES = 32;
import { INVITE_TOKEN_PATTERN, tokenFromFragment } from "./invite-fragment";

export { INVITE_TOKEN_PATTERN };
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_INVITE_CAP = 20;

function toBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** `random(n)` must return n cryptographically secure bytes (for example `crypto.randomBytes`). */
export function generateInviteToken(random: (n: number) => Uint8Array): string {
  const bytes = random(INVITE_TOKEN_BYTES);
  if (bytes.length !== INVITE_TOKEN_BYTES) throw new Error("invite_token_entropy");
  return toBase64Url(bytes);
}

/** SHA-256 of the token text. Only this hash is stored. */
export function hashInviteToken(token: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(token, "utf8").digest());
}

/** The token goes in the fragment, which browsers never send to servers. */
export function buildInviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/join#${token}`;
}

export { tokenFromFragment };
