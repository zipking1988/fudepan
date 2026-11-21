import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env/public";

import type { Database } from "./database.types";

/**
 * Supabase client for Client Components. Uses only the public anon key, so every
 * query is subject to row-level security. `createBrowserClient` returns a singleton.
 */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getPublicEnv();
  return createBrowserClient<Database>(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
