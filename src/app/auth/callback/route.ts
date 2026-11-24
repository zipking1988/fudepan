import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/next-path";
import { errorCode, log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/**
 * Email-confirmation landing. Exchanges the one-time code for a session, then goes to an allowed
 * page. A missing or bad code sends the person to sign-in, where the invite cookie (if any) still
 * leads them back to /join.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
    log("warn", "membership.sign_up_failed", { code: errorCode(error), reason: "callback_exchange" });
  }
  const login = new URL("/login", request.url);
  login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}
