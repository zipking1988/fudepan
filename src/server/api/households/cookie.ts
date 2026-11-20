import "server-only";
import type { NextResponse } from "next/server";
import { HOUSEHOLD_COOKIE } from "@/server/session";

/** Remembers the active household. It is only a hint; membership is checked on every request. */
export function setHouseholdCookie(response: NextResponse, householdId: string) {
  response.cookies.set(HOUSEHOLD_COOKIE, householdId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
