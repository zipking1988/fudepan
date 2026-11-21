import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

/**
 * Integration tests against a local Supabase stack (Auth, Storage, Postgres).
 *
 *   supabase start
 *   INTEGRATION_SUPABASE_URL=http://127.0.0.1:54321 \
 *   INTEGRATION_SUPABASE_ANON_KEY=<publishable key> \
 *   INTEGRATION_SUPABASE_SERVICE_ROLE_KEY=<secret key> \
 *   pnpm test:integration
 *
 * The tests create their own users and households and refuse to run against
 * anything other than localhost.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
