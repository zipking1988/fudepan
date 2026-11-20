import { NextResponse } from "next/server";
import { acceptInvitationSchema } from "@/lib/schemas/workflow";
import { isSameOrigin, jsonError } from "@/server/api/http";
import { setHouseholdCookie } from "@/server/api/households/cookie";
import {
  HOUSEHOLD_ERROR_MESSAGES,
  HouseholdServiceError,
  acceptInvitation,
} from "@/server/api/households/service";
import { createAdminClient } from "@/server/supabase-admin";
import { getAuthContext } from "@/server/session";

export const runtime = "nodejs";

/** A signed-in user joins a household with a one-time token. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const auth = await getAuthContext();
  if (auth.status === "unconfigured")
    return jsonError(503, "unconfigured", "The app is not set up yet.");
  if (auth.status === "signed_out") return jsonError(401, "signed_out", "Please sign in first.");

  const body = acceptInvitationSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return jsonError(400, "invalid", body.error.issues[0]?.message ?? "Please enter your name.");

  try {
    const householdId = await acceptInvitation({
      admin: createAdminClient(),
      userId: auth.userId,
      email: auth.email,
      token: body.data.token,
      displayName: body.data.displayName,
    });
    const response = NextResponse.json({ householdId });
    setHouseholdCookie(response, householdId);
    return response;
  } catch (error) {
    const code = error instanceof HouseholdServiceError ? error.code : "database_failed";
    // Same message for expired, used, revoked and unknown tokens, so nothing is revealed.
    return jsonError(code === "database_failed" ? 500 : 400, code, HOUSEHOLD_ERROR_MESSAGES[code]);
  }
}
