import "server-only";

import { z } from "zod";

import { EnvValidationError, describeIssues, emptyToUndefined } from "./format";
import { parsePublicEnv, type PublicEnv } from "./public";

/**
 * Server-only environment variables. Importing this module from a Client
 * Component fails the build (via `server-only`), so these values cannot be
 * bundled for the browser.
 */
const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string({ error: "is required" }).min(1, "is required"),
  APP_BASE_URL: z.url({
    protocol: /^https?$/,
    error: (issue) =>
      issue.input === undefined
        ? "is required"
        : "must be an http(s) URL, e.g. http://localhost:3000",
  }),
  // AI extraction vars. Optional so the rest of the app stays up if they are not set.
  AIAND_API_KEY: z.string().min(1).optional(),
  AIAND_BASE_URL: z
    .url({ protocol: /^https?$/, error: "must be an http(s) URL" })
    .optional(),
  AIAND_MODEL: z.string().min(1).optional(),
  // Bearer secret for the Vercel Cron route. When unset, the cron route refuses every request.
  CRON_SECRET: z.string().min(16, "must be at least 16 characters when set").optional(),
});

export type ServerEnv = PublicEnv & z.infer<typeof serverEnvSchema>;

/**
 * Names that must never carry the NEXT_PUBLIC_ prefix, because Next.js would
 * inline their values into browser bundles.
 */
const SECRET_NAME_PATTERN = /SERVICE_ROLE|SECRET|AIAND/;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const problems: string[] = [];

  for (const name of Object.keys(source)) {
    if (name.startsWith("NEXT_PUBLIC_") && SECRET_NAME_PATTERN.test(name)) {
      problems.push(
        `${name}: secrets must not use the NEXT_PUBLIC_ prefix, which exposes them to the browser. Remove this variable`,
      );
    }
  }

  let publicEnv: PublicEnv | undefined;
  try {
    publicEnv = parsePublicEnv(source);
  } catch (error) {
    if (!(error instanceof EnvValidationError)) throw error;
    problems.push(...error.problems);
  }

  const result = serverEnvSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: emptyToUndefined(source.SUPABASE_SERVICE_ROLE_KEY),
    APP_BASE_URL: emptyToUndefined(source.APP_BASE_URL),
    AIAND_API_KEY: emptyToUndefined(source.AIAND_API_KEY),
    AIAND_BASE_URL: emptyToUndefined(source.AIAND_BASE_URL),
    AIAND_MODEL: emptyToUndefined(source.AIAND_MODEL),
    CRON_SECRET: emptyToUndefined(source.CRON_SECRET),
  });
  if (!result.success) {
    problems.push(...describeIssues(result.error));
  }

  if (
    result.success &&
    publicEnv &&
    result.data.SUPABASE_SERVICE_ROLE_KEY === publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY: must differ from NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  if (problems.length > 0 || !publicEnv || !result.success) {
    throw new EnvValidationError(problems);
  }

  return { ...publicEnv, ...result.data };
}

let cached: ServerEnv | undefined;

/** Validates and returns the server environment. Throws EnvValidationError on first use if invalid. */
export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
