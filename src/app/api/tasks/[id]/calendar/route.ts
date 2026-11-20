import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ICS_CONTENT_TYPE } from "@/lib/calendar/ics";
import { isSameOrigin, jsonError } from "@/server/api/http";
import { CalendarExportError, exportTaskToCalendar } from "@/server/api/tasks/calendar";
import { taskErrorResponse } from "@/server/api/tasks/respond";
import { createAdminClient } from "@/server/supabase-admin";
import { getAuthContext } from "@/server/session";

export const runtime = "nodejs";

/**
 * Downloads a confirmed task as an .ics file. POST (not GET) so another site cannot trigger an
 * export or an audit event through a link or image.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return jsonError(404, "task_not_found", "We could not find that task.");
  }

  const auth = await getAuthContext();
  if (auth.status === "unconfigured")
    return jsonError(503, "unconfigured", "The app is not set up yet.");
  if (auth.status === "signed_out") return jsonError(401, "signed_out", "Please sign in first.");

  try {
    const file = await exportTaskToCalendar({
      supabase: auth.supabase,
      admin: createAdminClient(),
      userId: auth.userId,
      memberships: auth.memberships,
      taskId: id,
      origin: new URL(request.url).origin,
    });
    return new Response(file.body, {
      status: 200,
      headers: {
        "content-type": ICS_CONTENT_TYPE,
        "content-disposition": `attachment; filename="${file.fileName}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CalendarExportError) {
      return jsonError(
        409,
        error.code,
        error.code === "not_confirmed"
          ? "Only approved tasks can be added to a calendar."
          : "This task has no due date, so it cannot be added to a calendar.",
      );
    }
    return taskErrorResponse(error, requestId);
  }
}
