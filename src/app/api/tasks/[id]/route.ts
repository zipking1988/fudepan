import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { editTaskBodySchema } from "@/lib/schemas/workflow";
import { isSameOrigin, jsonError } from "@/server/api/http";
import { editTask } from "@/server/api/tasks/edit";
import { taskErrorResponse } from "@/server/api/tasks/respond";
import { createAdminClient } from "@/server/supabase-admin";
import { getAuthContext } from "@/server/session";

export const runtime = "nodejs";

/** Edits a draft or awaiting-approval task. Body: { changes: taskUpdateSchema, timeDefaulted? }. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return jsonError(404, "task_not_found", "We could not find that task.");

  const auth = await getAuthContext();
  if (auth.status === "unconfigured")
    return jsonError(503, "unconfigured", "The app is not set up yet.");
  if (auth.status === "signed_out") return jsonError(401, "signed_out", "Please sign in first.");

  const body = editTaskBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return jsonError(400, "invalid_task", "Please check the task details and try again.");

  try {
    const result = await editTask({
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
