import { NextResponse } from "next/server";
import { createHouseholdSchema } from "@/lib/schemas/workflow";
import { jsonError, isSameOrigin } from "@/server/api/http";
import { setHouseholdCookie } from "@/server/api/households/cookie";
import {
  HOUSEHOLD_ERROR_MESSAGES,
  HouseholdServiceError,
  createHousehold,
} from "@/server/api/households/service";
import { createAdminClient } from "@/server/supabase-admin";
import { getAuthContext } from "@/server/session";

export const runtime = "nodejs";

/** Creates a household. The creator becomes its coordinator. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const auth = await getAuthContext();
  if (auth.status === "unconfigured")
    return jsonError(503, "unconfigured", "The app is not set up yet.");
  if (auth.status === "signed_out") return jsonError(401, "signed_out", "Please sign in first.");

  const body = createHouseholdSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return jsonError(400, "invalid", body.error.issues[0]?.message ?? "Please check the fields.");

  try {
    const householdId = await createHousehold({
      admin: createAdminClient(),
      userId: auth.userId,
      name: body.data.name,
      displayName: body.data.displayName,
    });
    const response = NextResponse.json({ householdId }, { status: 201 });
    setHouseholdCookie(response, householdId);
    return response;
  } catch (error) {
    const code = error instanceof HouseholdServiceError ? error.code : "database_failed";
    return jsonError(
      code === "too_many_households" ? 403 : 500,
      code,
      HOUSEHOLD_ERROR_MESSAGES[code],
    );
  }
}
