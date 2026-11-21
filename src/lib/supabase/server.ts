import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env/public";

import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions, and Route Handlers.
 * Acts as the signed-in user, so row-level security applies.
 * Create a new client per request; it is cheap.
 */
export async function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();
  const cookieStore = await cookies();

  return createServerClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. The proxy refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
