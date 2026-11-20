import "server-only";
import { NextResponse } from "next/server";
import { getSessionContext, type SessionContext } from "@/server/session";

export function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

type Ready = Extract<SessionContext, { status: "ready" }>;

/** Returns the ready session, or an error response when the user is not signed in or has no household. */
export async function requireReadySession(): Promise<
  { session: Ready } | { response: NextResponse }
> {
  const session = await getSessionContext();
  if (session.status === "unconfigured")
    return { response: jsonError(503, "unconfigured", "The app is not set up yet.") };
  if (session.status === "signed_out")
    return { response: jsonError(401, "signed_out", "Please sign in first.") };
  if (session.status === "no_household")
    return { response: jsonError(403, "no_household", "You are not part of a household yet.") };
  return { session };
}

/** Rejects cross-site form posts. Session cookies are SameSite=Lax; this is a second check. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}
