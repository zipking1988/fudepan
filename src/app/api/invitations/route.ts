import { NextResponse } from "next/server";
import { hasPermission } from "@/lib/permissions";
import { createInvitationSchema } from "@/lib/schemas/workflow";
import { isSameOrigin, jsonError, requireReadySession } from "@/server/api/http";
import {
  HOUSEHOLD_ERROR_MESSAGES,
  HouseholdServiceError,
  createInvitation,
} from "@/server/api/households/service";
import { createAdminClient } from "@/server/supabase-admin";

export const runtime = "nodejs";

/** Coordinator only. Returns a one-time link to share by hand. Fudepan sends no email. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const guard = await requireReadySession();
  if ("response" in guard) return guard.response;
  const { session } = guard;
  if (!hasPermission(session.role, "member.invite"))
    return jsonError(403, "forbidden", "Only a coordinator can invite people.");

  const body = createInvitationSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid", "Please check the role and email address.");

  try {
    const result = await createInvitation({
      admin: createAdminClient(),
      actorId: session.userId,
      householdId: session.householdId,
      role: body.data.role,
      email: body.data.email ?? null,
      origin: new URL(request.url).origin,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const code = error instanceof HouseholdServiceError ? error.code : "database_failed";
    return jsonError(code === "forbidden" ? 403 : 500, code, HOUSEHOLD_ERROR_MESSAGES[code]);
  }
}
