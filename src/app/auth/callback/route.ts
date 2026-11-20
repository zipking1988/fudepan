import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Completes a magic-link sign-in (PKCE `code`, or `token_hash` with `type`). */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const fail = NextResponse.redirect(new URL("/login?error=1", request.url));

  try {
    const supabase = await createClient();
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;

    let error: unknown = new Error("missing");
    if (code) ({ error } = await supabase.auth.exchangeCodeForSession(code));
    else if (tokenHash && type)
      ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type }));
    if (error) return fail;
  } catch {
    return fail;
  }
  return NextResponse.redirect(new URL(next, request.url));
}
