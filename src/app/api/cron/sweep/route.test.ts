import { beforeEach, describe, expect, it, vi } from "vitest";

const sweep = vi.fn();
const env = vi.fn();
vi.mock("@/lib/family/sweep", () => ({ runAllHouseholdsSweep: () => sweep() }));
vi.mock("@/lib/env/server", () => ({ getServerEnv: () => env() }));
vi.mock("@/lib/log", () => ({ log: vi.fn(), errorCode: () => "boom" }));

import { GET, tokensMatch } from "./route";

const SECRET = "0123456789abcdef-secret";
const req = (auth?: string) =>
  new Request("http://localhost/api/cron/sweep", { headers: auth ? { authorization: auth } : {} });

const okResult = {
  swept: true,
  escalation: { escalated: 2, expiredRequests: 1 },
  recognition: { restarted: 3, failed: 0, errors: 0 },
  failedSteps: [],
};

beforeEach(() => {
  sweep.mockReset();
  env.mockReset();
  env.mockReturnValue({ CRON_SECRET: SECRET });
});

describe("GET /api/cron/sweep", () => {
  it("refuses and does nothing when no secret is configured", async () => {
    env.mockReturnValue({});
    const res = await GET(req("Bearer anything-at-all-here"));
    expect([401, 503]).toContain(res.status);
    expect(sweep).not.toHaveBeenCalled();
  });

  it("refuses when the environment is invalid", async () => {
    env.mockImplementation(() => {
      throw new Error("bad env");
    });
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(sweep).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer wrong-token-value-xx", `Bearer ${SECRET}x`, "Bearer short", SECRET])(
    "returns 401 for %s",
    async (auth) => {
      const res = await GET(req(auth));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false });
      expect(sweep).not.toHaveBeenCalled();
    },
  );

  it("runs the sweep once and returns counts only", async () => {
    sweep.mockResolvedValue(okResult);
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, escalated: 2, expiredRequests: 1, resumed: 3 });
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 500 when the sweep fails", async () => {
    sweep.mockResolvedValue({ ...okResult, failedSteps: ["escalation"], escalation: null });
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false });
  });

  it("returns a generic 500 with no internal text when the sweep throws", async () => {
    sweep.mockRejectedValue(new Error("secret db detail"));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret db detail");
    expect(JSON.parse(text)).toEqual({ ok: false });
  });
});

describe("tokensMatch", () => {
  it("handles tokens of different lengths without throwing", () => {
    expect(tokensMatch("a", SECRET)).toBe(false);
    expect(tokensMatch(SECRET + SECRET, SECRET)).toBe(false);
    expect(tokensMatch(SECRET, SECRET)).toBe(true);
  });
});
