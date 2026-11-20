import { defineConfig, devices } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * E2E tests run against a local Supabase stack (`supabase start`). Keys are read from
 * `supabase status` at runtime and kept in memory; nothing is written to disk. Third-party
 * provider keys are blanked so tests never call ai& or Google Vision.
 */
function localSupabaseEnv(): Record<string, string> {
  try {
    const out = execSync("supabase status -o env", {
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
    const env: Record<string, string> = {};
    for (const line of out.split("\n")) {
      const m = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
      if (m) env[m[1]!] = m[2]!;
    }
    return env;
  } catch {
    return {};
  }
}

const sb = localSupabaseEnv();
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

if (sb.API_URL) {
  process.env.E2E_SUPABASE_URL = sb.API_URL;
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY = sb.SERVICE_ROLE_KEY;
  process.env.E2E_SUPABASE_ANON_KEY = sb.ANON_KEY;
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_SUPABASE_URL: sb.API_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: sb.ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: sb.SERVICE_ROLE_KEY ?? "",
      AIAND_API_KEY: "",
      AIAND_MODEL: "",
      GOOGLE_CLOUD_VISION_API_KEY: "",
      DEFAULT_TIMEZONE: "Asia/Tokyo",
    },
  },
});
