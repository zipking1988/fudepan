import { NextResponse } from "next/server";
import { isSameOrigin } from "@/server/api/http";
import { createClient } from "@/lib/supabase/server";
import { HOUSEHOLD_COOKIE } from "@/server/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return NextResponse.json({ error: { code: "forbidden" } }, { status: 403 });
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Nothing to sign out of.
  }
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  response.cookies.delete(HOUSEHOLD_COOKIE);
  return response;
}
