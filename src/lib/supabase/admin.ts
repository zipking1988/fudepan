import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env/server";

import type { Database } from "./database.types";

/**
 * Supabase client with the service role key. It BYPASSES row-level security.
 *
 * Use it only in server code that has already verified the caller belongs to
 * the household being changed, and that writes an audit event for the change.
 * Never pass this client, or data it returns unfiltered, to the browser.
 */
export function createAdminClient() {
  const env = getServerEnv();
  return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
