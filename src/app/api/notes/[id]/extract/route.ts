import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getLlmAdapter } from "@/lib/ai";
import { resolveTimeZone } from "@/lib/datetime";
import { TaskServiceError } from "@/server/api/tasks/errors";
import { extractTaskForNote } from "@/server/api/tasks/extract";
import { getSessionContext } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({ timeZone: z.string().max(64).optional() }).strict();

function fail(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success)
    return fail(404, "not_found", "We could not find that note.");

  const session = await getSessionContext();
  if (session.status === "unconfigured")
    return fail(503, "unconfigured", "The app is not set up yet.");
  if (session.status === "signed_out") return fail(401, "signed_out", "Please sign in first.");
  if (session.status === "no_household")
    return fail(403, "no_household", "You are not part of a household yet.");

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return fail(400, "bad_request", "We could not read that. Please try again.");

  try {
    const response = await extractTaskForNote({
      supabase: session.supabase,
      userId: session.userId,
      householdId: session.householdId,
      noteId: id,
      timeZone: resolveTimeZone(body.data.timeZone, process.env.DEFAULT_TIMEZONE),
      llm: getLlmAdapter(),
      requestId,
      // Metadata only. Never log note text, model output, or images.
      log: (entry) => console.info("[extract]", JSON.stringify(entry)),
    });
    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof TaskServiceError && error.code === "note_not_found") {
      return fail(404, "not_found", "We could not find that note.");
    }
    console.error(
      "[extract]",
      JSON.stringify({
        requestId,
        code: error instanceof TaskServiceError ? error.code : "unexpected",
      }),
    );
    return fail(
      500,
      "unexpected",
      "We could not read this note. You can fill in the task yourself.",
    );
  }
}
