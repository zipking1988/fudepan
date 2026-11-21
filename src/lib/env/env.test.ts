import { describe, expect, it } from "vitest";

import { EnvValidationError } from "./format";
import { isServiceRoleKey, parsePublicEnv } from "./public";
import { parseServerEnv } from "./server";

/** Builds an unsigned JWT-shaped string with the given payload. Test fixture only. */
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.signature`;
}

const ANON_KEY = fakeJwt({ role: "anon", iss: "supabase-demo" });
const SERVICE_ROLE_KEY = fakeJwt({ role: "service_role", iss: "supabase-demo" });

const validServerSource = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  APP_BASE_URL: "http://localhost:3000",
};

function problemsOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.problems;
    throw error;
  }
  throw new Error("Expected EnvValidationError");
}

describe("parsePublicEnv", () => {
  it("accepts a valid Supabase URL and anon key", () => {
    expect(
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
      }),
    ).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_example",
    });
  });

  it("treats empty values as missing and names every missing variable", () => {
    expect(
      problemsOf(() =>
        parsePublicEnv({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "  " }),
      ),
    ).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL: is required",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY: is required",
    ]);
  });

  it("rejects a URL that is not http(s)", () => {
    expect(
      problemsOf(() =>
        parsePublicEnv({
          NEXT_PUBLIC_SUPABASE_URL: "ftp://abc.supabase.co",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
        }),
      ),
    ).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL: must be an http(s) URL, e.g. https://<project>.supabase.co",
    ]);
  });

  it.each([
    ["legacy service_role JWT", SERVICE_ROLE_KEY],
    ["new-style secret key", "sb_secret_example"],
  ])("rejects a %s in the browser-visible anon key slot", (_label, key) => {
    const problems = problemsOf(() =>
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: key,
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^NEXT_PUBLIC_SUPABASE_ANON_KEY: looks like a service role/);
  });

  it("never includes variable values in the error message", () => {
    try {
      parsePublicEnv({
        NEXT_PUBLIC_SUPABASE_URL: "not a url",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE_ROLE_KEY,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as Error).message;
      expect(message).not.toContain("not a url");
      expect(message).not.toContain(SERVICE_ROLE_KEY);
    }
  });
});

describe("isServiceRoleKey", () => {
  it("does not flag anon or publishable keys", () => {
    expect(isServiceRoleKey(ANON_KEY)).toBe(false);
    expect(isServiceRoleKey("sb_publishable_example")).toBe(false);
    expect(isServiceRoleKey("a.b.c")).toBe(false);
  });
});

describe("parseServerEnv", () => {
  it("returns public and server values when everything is valid", () => {
    expect(parseServerEnv(validServerSource)).toEqual(validServerSource);
  });

  it("reports missing server variables", () => {
    const problems = problemsOf(() =>
      parseServerEnv({
        ...validServerSource,
        SUPABASE_SERVICE_ROLE_KEY: "",
        APP_BASE_URL: undefined,
      }),
    );
    expect(problems).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY: is required",
      "APP_BASE_URL: is required",
    ]);
  });

  it("reports public and server problems together", () => {
    const problems = problemsOf(() => parseServerEnv({ APP_BASE_URL: "http://localhost:3000" }));
    expect(problems).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL: is required",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY: is required",
      "SUPABASE_SERVICE_ROLE_KEY: is required",
    ]);
  });

  it.each([
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_AIAND_API_KEY",
    "NEXT_PUBLIC_SOME_SECRET",
  ])("refuses to start when a secret is exposed as %s", (name) => {
    const problems = problemsOf(() => parseServerEnv({ ...validServerSource, [name]: "value" }));
    expect(problems).toEqual([
      `${name}: secrets must not use the NEXT_PUBLIC_ prefix, which exposes them to the browser. Remove this variable`,
    ]);
  });

  it("rejects using the anon key as the service role key", () => {
    const problems = problemsOf(() =>
      parseServerEnv({ ...validServerSource, SUPABASE_SERVICE_ROLE_KEY: ANON_KEY }),
    );
    expect(problems).toEqual([
      "SUPABASE_SERVICE_ROLE_KEY: must differ from NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]);
  });
});
