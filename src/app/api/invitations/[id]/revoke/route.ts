import { NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/permissions";
import { isSameOrigin, jsonError, requireReadySession } from "@/server/api/http";
import {
  HOUSEHOLD_ERROR_MESSAGES,
  HouseholdServiceError,
  revokeInvitation,
} from "@/server/api/households/service";
import { createAdminClient } from "@/server/supabase-admin";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(404, "invalid_invitation", HOUSEHOLD_ERROR_MESSAGES.invalid_invitation);
  const guard = await requireReadySession();
  if ("response" in guard) return guard.response;
  if (!hasPermission(guard.session.role, "member.invite"))
    return jsonError(403, "forbidden", HOUSEHOLD_ERROR_MESSAGES.forbidden);

  try {
    await revokeInvitation({
      admin: createAdminClient(),
      actorId: guard.session.userId,
      invitationId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof HouseholdServiceError ? error.code : "database_failed";
    return jsonError(
      code === "forbidden" ? 403 : code === "invalid_invitation" ? 404 : 500,
      code,
      HOUSEHOLD_ERROR_MESSAGES[code],
    );
  }
}
