import type { z } from "zod";

/**
 * Error thrown when required environment variables are missing or invalid.
 * The message names the variables and the problem, never their values.
 */
export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
        "See .env.example for the required variables.",
    );
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.join(".") || "environment";
    return `${name}: ${issue.message}`;
  });
}

/** Treats empty strings as missing, so `KEY=` in a .env file counts as unset. */
export function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}
