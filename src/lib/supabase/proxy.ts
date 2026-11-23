import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isProtectedPagePath, safeNextPath } from "@/lib/auth/next-path";
import { getPublicEnv } from "@/lib/env/public";

import type { Database } from "./database.types";

/**
 * Refreshes the Supabase auth session on each request and forwards the
 * refreshed cookies to both Server Components and the browser.
 * Always return the response this function builds, or the refreshed cookies are lost.
 *
 * Also redirects signed-out visitors away from note and family pages. That is a
 * convenience only: every page, action, and route checks the session itself.
 */
export async function updateSession(request: NextRequest) {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // Cache headers stop CDNs from serving one user's session to another.
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims().
  // getClaims() verifies the token signature; never trust getSession() on the server.
  const { data, error } = await supabase.auth.getClaims();
  const signedIn = !error && data?.claims?.role === "authenticated" && Boolean(data.claims.sub);

  const { pathname } = request.nextUrl;
  // The image route answers 404 itself; a redirect to an HTML page would break <img>.
  if (!signedIn && isProtectedPagePath(pathname)) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", safeNextPath(pathname));
    return redirectKeepingSession(url, response);
  }
  if (signedIn && pathname === "/login") {
    const next = safeNextPath(request.nextUrl.searchParams.get("next"));
    return redirectKeepingSession(new URL(next, request.url), response);
  }

  return response;
}

/** A redirect that still carries any refreshed session cookies and cache headers. */
function redirectKeepingSession(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}
