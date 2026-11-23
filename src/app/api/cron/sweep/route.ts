import { createHash, timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env/server";
import { errorCode, log } from "@/lib/log";
import { runAllHouseholdsSweep } from "@/lib/family/sweep";

/**
 * Vercel Cron entry point (Design K5). Only `Authorization: Bearer ${CRON_SECRET}`
 * grants access. With no secret configured the route refuses everything.
 * The response carries counts only, never household data.
 * (Reading request headers already makes this handler dynamic under cacheComponents.)
 */
export const maxDuration = 120;

const HEADERS = { "Cache-Control": "no-store" } as const;

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: HEADERS });
}

/** Constant-time compare. Hashing first gives equal-length buffers for any input. */
export function tokensMatch(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  let secret: string | undefined;
  try {
    secret = getServerEnv().CRON_SECRET;
  } catch (error) {
    log("error", "cron.sweep.config", { stage: "config", code: errorCode(error) });
    return json(503, { ok: false });
  }
  if (!secret) {
    log("warn", "cron.sweep.refused", { stage: "auth", code: "not_configured" });
    return json(503, { ok: false });
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || !tokensMatch(match[1], secret)) {
    return json(401, { ok: false });
  }

  try {
    const result = await runAllHouseholdsSweep();
    if (!result.swept || result.failedSteps.length > 0) {
      log("error", "cron.sweep.failed", { stage: "sweep", code: result.failedSteps.join("+") || "not_swept" });
      return json(500, { ok: false });
    }
    const counts = {
      escalated: result.escalation?.escalated ?? 0,
      expiredRequests: result.escalation?.expiredRequests ?? 0,
      resumed: result.recognition?.restarted ?? 0,
    };
    log("info", "cron.sweep.done", { stage: "sweep", count: counts.escalated });
    return json(200, { ok: true, ...counts });
  } catch (error) {
    log("error", "cron.sweep.failed", { stage: "sweep", code: errorCode(error) });
    return json(500, { ok: false });
  }
}
