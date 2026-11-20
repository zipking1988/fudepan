import { NextResponse } from "next/server";
import { z } from "zod";
import { hasPermission } from "@/lib/permissions";
import { setRoleSchema } from "@/lib/schemas/workflow";
import { isSameOrigin, jsonError, requireReadySession } from "@/server/api/http";
import {
  HOUSEHOLD_ERROR_MESSAGES,
  HouseholdServiceError,
  setMemberRole,
} from "@/server/api/households/service";
import { createAdminClient } from "@/server/supabase-admin";

export const runtime = "nodejs";

/** Coordinator only. The database refuses to demote the last coordinator. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(404, "member_not_found", HOUSEHOLD_ERROR_MESSAGES.member_not_found);
  const guard = await requireReadySession();
  if ("response" in guard) return guard.response;
  if (!hasPermission(guard.session.role, "member.manage_roles"))
    return jsonError(403, "forbidden", HOUSEHOLD_ERROR_MESSAGES.forbidden);

  const body = setRoleSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "invalid_role", HOUSEHOLD_ERROR_MESSAGES.invalid_role);

  try {
    await setMemberRole({
      admin: createAdminClient(),
      actorId: guard.session.userId,
      memberId: id,
      role: body.data.role,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof HouseholdServiceError ? error.code : "database_failed";
    const status =
      code === "forbidden"
        ? 403
        : code === "member_not_found"
          ? 404
          : code === "last_coordinator"
            ? 409
            : 500;
    return jsonError(status, code, HOUSEHOLD_ERROR_MESSAGES[code]);
  }
}
