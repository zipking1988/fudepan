import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { taskActionBodySchema } from "@/lib/schemas/workflow";
import { isSameOrigin, jsonError } from "@/server/api/http";
import { getAuthContext } from "@/server/session";
import { performTaskAction } from "@/server/api/tasks/actions";
import { taskErrorResponse } from "@/server/api/tasks/respond";
import { createAdminClient } from "@/server/supabase-admin";

export const runtime = "nodejs";

/**
 * Claim, assign, submit, approve, reject, complete, cancel. The body cannot carry a status, a risk
 * level, or an approver: those come from the database function. Approval needs `acknowledged: true`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(404, "task_not_found", "We could not find that task.");

  const auth = await getAuthContext();
  if (auth.status === "unconfigured")
    return jsonError(503, "unconfigured", "The app is not set up yet.");
  if (auth.status === "signed_out") return jsonError(401, "signed_out", "Please sign in first.");

  const body = taskActionBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const approveWithoutAck = body.error.issues.some((i) => i.path.includes("acknowledged"));
    return jsonError(
      400,
      "invalid_action",
      approveWithoutAck
        ? "Please confirm you checked the original note."
        : "Please check what you are trying to do.",
    );
  }

  try {
    const result = await performTaskAction({
      supabase: auth.supabase,
      admin: createAdminClient(),
      userId: auth.userId,
      memberships: auth.memberships,
      taskId: id,
      body: body.data,
    });
    return NextResponse.json(result);
  } catch (error) {
    return taskErrorResponse(error, requestId);
  }
}
