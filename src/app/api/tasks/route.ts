import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { draftTaskInputSchema } from "@/lib/task-schema";
import { TaskServiceError } from "@/server/api/tasks/errors";
import { createDraftTask } from "@/server/api/tasks/create-draft";
import { createAdminClient } from "@/server/supabase-admin";
import { getSessionContext } from "@/server/session";

export const runtime = "nodejs";

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Creates a DRAFT task. There is no way to create a confirmed task through this route. */
export async function POST(request: Request) {
  const requestId = randomUUID();

  const session = await getSessionContext();
  if (session.status === "unconfigured")
    return fail(503, "unconfigured", "The app is not set up yet.");
  if (session.status === "signed_out") return fail(401, "signed_out", "Please sign in first.");
  if (session.status === "no_household")
    return fail(403, "no_household", "You are not part of a household yet.");

  const body = draftTaskInputSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    const first = body.error.issues[0];
    return fail(
      400,
      "invalid_task",
      first?.message && first.path[0] === "title"
        ? first.message
        : "Please check the fields and try again.",
    );
  }

  try {
    const result = await createDraftTask({
      supabase: session.supabase,
      admin: createAdminClient(),
      role: session.role,
      userId: session.userId,
      householdId: session.householdId,
      input: body.data,
      envTimeZone: process.env.DEFAULT_TIMEZONE,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof TaskServiceError) {
      if (error.code === "note_not_found")
        return fail(404, "not_found", "We could not find that note.");
      if (error.code === "invalid_assignee")
        return fail(400, "invalid_assignee", "Please choose someone from your household.");
      if (error.code === "invalid_extraction")
        return fail(400, "invalid_extraction", "Please read the note again and try again.");
      if (error.code === "forbidden")
        return fail(403, "forbidden", "You cannot add tasks to this household.");
    }
    console.error(
      "[tasks]",
      JSON.stringify({
        requestId,
        code: error instanceof TaskServiceError ? error.code : "unexpected",
      }),
    );
    return fail(500, "unexpected", "We could not save the task. Please try again.");
  }
}
