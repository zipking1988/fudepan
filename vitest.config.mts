import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside a React Server Components bundle. Tests run in plain Node.
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // Needs a running local Supabase stack; run with `pnpm test:integration`.
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
