import { NextResponse } from "next/server";
import { selectHouseholdSchema } from "@/lib/schemas/workflow";
import { isSameOrigin, jsonError } from "@/server/api/http";
import { setHouseholdCookie } from "@/server/api/households/cookie";
import { getAuthContext } from "@/server/session";

export const runtime = "nodejs";

/** Switches the active household. Accepts a plain HTML form post or JSON. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return jsonError(403, "forbidden", "Not allowed.");
  const auth = await getAuthContext();
  if (auth.status !== "signed_in") return jsonError(401, "signed_out", "Please sign in first.");

  const isForm = (request.headers.get("content-type") ?? "").includes("form");
  const raw = isForm
    ? Object.fromEntries(await request.formData())
    : await request.json().catch(() => null);
  const body = selectHouseholdSchema.safeParse(raw);
  if (!body.success) return jsonError(400, "invalid", "Please choose a household.");
  if (!auth.memberships.some((m) => m.householdId === body.data.householdId)) {
    return jsonError(403, "forbidden", "You are not a member of that household.");
  }

  const response = isForm
    ? NextResponse.redirect(new URL("/", request.url), 303)
    : NextResponse.json({ householdId: body.data.householdId });
  setHouseholdCookie(response, body.data.householdId);
  return response;
}
