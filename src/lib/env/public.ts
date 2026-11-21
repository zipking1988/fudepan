import { z } from "zod";

import { EnvValidationError, describeIssues, emptyToUndefined } from "./format";

/**
 * Environment variables that are safe to ship to the browser.
 * Only the Supabase URL and anon (publishable) key belong here; RLS protects the data.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    protocol: /^https?$/,
    error: (issue) =>
      issue.input === undefined
        ? "is required"
        : "must be an http(s) URL, e.g. https://<project>.supabase.co",
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string({ error: "is required" })
    .min(1, "is required")
    .refine((key) => !isServiceRoleKey(key), {
      message:
        "looks like a service role or secret key. Use the anon (publishable) key; secret keys must never reach the browser",
    }),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const result = publicEnvSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: emptyToUndefined(source.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: emptyToUndefined(source.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  });
  if (!result.success) {
    throw new EnvValidationError(describeIssues(result.error));
  }
  return result.data;
}

/**
 * Reads the public environment. Each variable is referenced literally so Next.js
 * can inline it into client bundles.
 */
export function getPublicEnv(): PublicEnv {
  return parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Detects Supabase keys that bypass RLS: new-style `sb_secret_` keys and legacy
 * JWT keys whose payload has `role: "service_role"`.
 */
export function isServiceRoleKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) {
    return true;
  }
  const parts = key.split(".");
  if (parts.length !== 3) {
    return false;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return (
      typeof payload === "object" &&
      payload !== null &&
      (payload as Record<string, unknown>).role === "service_role"
    );
  } catch {
    return false;
  }
}
