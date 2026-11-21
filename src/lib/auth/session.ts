import "server-only";

import { connection } from "next/server";

import { isUuid } from "@/lib/ids";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string };

/**
 * The signed-in person, verified with getClaims() (which checks the token
 * signature). Never trust getSession() on the server.
 *
 * Returns the request's row-level-security client too, so callers query as
 * this person rather than with elevated rights.
 */
export async function getSession() {
  // Session reads always happen at request time. Without this, Next.js may
  // start rendering during a prefetch and reject the auth client's Date.now().
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = error ? null : data?.claims;
  const user: SessionUser | null =
    claims && claims.role === "authenticated" && isUuid(claims.sub) ? { id: claims.sub } : null;
  return { supabase, user };
}
