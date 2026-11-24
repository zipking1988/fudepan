import "server-only";
import { cookies } from "next/headers";
import { INVITE_TOKEN_PATTERN } from "./invite-token";

/** httpOnly cookie that keeps the Invite_Token between opening the link and accepting it (design K2). */
export const INVITE_COOKIE = "fudepan_invite";

/** Cookie max age in seconds: the time left before expiry, at least 1. */
export function inviteCookieMaxAge(expiresAt: Date, now: Date): number {
  return Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));
}

export async function setInviteCookie(token: string, expiresAt: Date, now: Date = new Date()): Promise<void> {
  if (!INVITE_TOKEN_PATTERN.test(token)) return;
  (await cookies()).set(INVITE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: inviteCookieMaxAge(expiresAt, now),
  });
}

/** The stored token, or null when absent or malformed. */
export async function readInviteCookie(): Promise<string | null> {
  const value = (await cookies()).get(INVITE_COOKIE)?.value;
  return value && INVITE_TOKEN_PATTERN.test(value) ? value : null;
}

export async function hasInviteCookie(): Promise<boolean> {
  return (await readInviteCookie()) !== null;
}

export async function clearInviteCookie(): Promise<void> {
  (await cookies()).set(INVITE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
