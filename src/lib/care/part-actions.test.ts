import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

import { createPartActionService, createSupabasePartActionStore } from "./part-actions";
import { REFUSAL_MESSAGE_KEYS, type RefusalCode } from "./rules/refusals";

/**
 * Tests the service and the Supabase store together against an in-memory
 * stand-in for the service-role client. Each SQL function is scripted with a
 * reply; the fake records the name and arguments of every call. All data is fake.
 */

const USER = { id: "d1000000-0000-4000-8000-000000000002" };
const STEP = "a3000000-0000-4000-8000-000000000001";
const OTHER = "d2000000-0000-4000-8000-000000000003";
const CHAIN = "a2000000-0000-4000-8000-000000000001";
const NOTE = "a1000000-0000-4000-8000-000000000001";
const REQUEST = "a4000000-0000-4000-8000-000000000001";
const EVIDENCE = "a5000000-0000-4000-8000-000000000001";
const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const SENTINEL = "SENTINEL-Metformin-4-Chome-Hospital";

type Reply = { data?: unknown; error?: { message: string; code?: string } | null };

function fakeAdmin(reply: Reply | ((fn: string) => Reply) = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const admin = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const r = typeof reply === "function" ? reply(fn) : reply;
      return { data: r.data ?? null, error: r.error ?? null };
    }),
  };
  return { admin: admin as unknown as SupabaseClient<Database>, calls };
}

const row = (outcome: string, extra: Record<string, unknown> = {}) => ({
  audit_event_id: EVIDENCE,
  care_chain_id: CHAIN,
  note_id: NOTE,
  outcome,
  approval_reset: false,
  ...extra,
});

function setup(reply?: Reply | ((fn: string) => Reply)) {
  const fake = fakeAdmin(reply);
  const service = createPartActionService({
    store: createSupabasePartActionStore(fake.admin, log),
    log,
  });
  return { ...fake, service };
}

let out: string[];
beforeEach(() => {
  out = [];
  for (const level of ["info", "warn", "error"] as const) {
    vi.spyOn(console, level).mockImplementation((line: unknown) => void out.push(String(line)));
  }
});
afterEach(() => vi.restoreAllMocks());

describe("each action passes the right arguments to its SQL function", () => {
  const cases: {
    name: string;
    run: (s: ReturnType<typeof setup>["service"]) => Promise<unknown>;
    fn: string;
    args: Record<string, unknown>;
    data: unknown;
  }[] = [
    {
      name: "claim",
      run: (s) => s.claim(USER, { stepId: STEP, role: "driver" }),
      fn: "claim_part",
      args: { p_step_id: STEP, p_user_id: USER.id, p_role: "driver" },
      data: row("claimed"),
    },
    {
      name: "release",
      run: (s) => s.release(USER, { stepId: STEP, role: "owner" }),
      fn: "release_part",
      args: { p_step_id: STEP, p_user_id: USER.id, p_role: "owner" },
      data: row("released"),
    },
    {
      name: "requestAssignment",
      run: (s) => s.requestAssignment(USER, { stepId: STEP, toMemberId: OTHER }),
      fn: "request_assignment",
      args: { p_step_id: STEP, p_user_id: USER.id, p_to_member_id: OTHER },
      data: row("requested", { request_id: REQUEST }),
    },
    {
      name: "requestHandover",
      run: (s) => s.requestHandover(USER, { stepId: STEP, role: "companion", toMemberId: OTHER }),
      fn: "request_handover",
      args: { p_step_id: STEP, p_user_id: USER.id, p_role: "companion", p_to_member_id: OTHER },
      data: row("requested", { request_id: REQUEST }),
    },
    {
      name: "requestBackup",
      run: (s) => s.requestBackup(USER, { stepId: STEP, toMemberId: OTHER }),
      fn: "request_backup",
      args: { p_step_id: STEP, p_user_id: USER.id, p_to_member_id: OTHER },
      data: row("requested", { request_id: REQUEST }),
    },
    {
      name: "volunteerBackup",
      run: (s) => s.volunteerBackup(USER, { stepId: STEP }),
      fn: "volunteer_backup",
      args: { p_step_id: STEP, p_user_id: USER.id },
      data: row("volunteered"),
    },
    {
      name: "respond",
      run: (s) => s.respond(USER, { requestId: REQUEST, accept: true }),
      fn: "respond_to_request",
      args: { p_request_id: REQUEST, p_user_id: USER.id, p_accept: true },
      data: row("accepted", { request_id: REQUEST }),
    },
    {
      name: "decideApproval",
      run: (s) => s.decideApproval(USER, { stepId: STEP, decision: "reject" }),
      fn: "decide_approval",
      args: { p_step_id: STEP, p_user_id: USER.id, p_decision: "reject" },
      data: row("rejected", { approval_state: "rejected", self_approval: false }),
    },
    {
      name: "resubmit",
      run: (s) =>
        s.resubmit(USER, {
          stepId: STEP,
          explanation: "  Added the photo  ",
          evidenceIds: [EVIDENCE],
        }),
      fn: "resubmit_part",
      args: {
        p_step_id: STEP,
        p_user_id: USER.id,
        p_evidence_ids: [EVIDENCE],
        p_explanation: "Added the photo",
      },
      data: row("resubmitted", { approval_state: "pending" }),
    },
    {
      name: "complete",
      run: (s) => s.complete(USER, { stepId: STEP }),
      fn: "complete_part",
      args: { p_step_id: STEP, p_user_id: USER.id },
      data: row("completed"),
    },
    {
      name: "fail",
      run: (s) => s.fail(USER, { stepId: STEP, reasonCode: "could_not_reach" }),
      fn: "report_part_failed",
      args: { p_step_id: STEP, p_user_id: USER.id, p_reason_code: "could_not_reach" },
      data: row("failed"),
    },
    {
      name: "reopen",
      run: (s) => s.reopen(USER, { stepId: STEP }),
      fn: "reopen_part",
      args: { p_step_id: STEP, p_user_id: USER.id },
      data: row("reopened"),
    },
    {
      name: "recordEvidence (text)",
      run: (s) =>
        s.recordEvidence(USER, {
          stepId: STEP,
          kind: "text",
          label: "Receipt",
          text: "Paid at desk",
        }),
      fn: "record_evidence",
      args: {
        p_step_id: STEP,
        p_user_id: USER.id,
        p_kind: "text",
        p_label: "Receipt",
        p_text: "Paid at desk",
      },
      data: row("recorded", { evidence_id: EVIDENCE }),
    },
    {
      name: "confirmTime",
      run: (s) =>
        s.confirmTime(USER, {
          stepId: STEP,
          kind: "respond_by",
          at: "2027-01-05T09:30:00+09:00",
          timeZone: "Asia/Tokyo",
        }),
      fn: "confirm_part_time",
      args: {
        p_step_id: STEP,
        p_user_id: USER.id,
        p_kind: "respond_by",
        p_at: "2027-01-05T00:30:00.000Z",
        p_timezone: "Asia/Tokyo",
      },
      data: row("confirmed"),
    },
    {
      name: "saveAmount",
      run: (s) => s.saveAmount(USER, { stepId: STEP, amountMinor: 3500, currency: "JPY" }),
      fn: "save_part_amount",
      args: { p_step_id: STEP, p_user_id: USER.id, p_amount_minor: 3500, p_currency: "JPY" },
      data: row("saved"),
    },
    {
      name: "resolveMissingDetail",
      run: (s) => s.resolveMissingDetail(USER, { detailId: EVIDENCE, answer: " Room 3 " }),
      fn: "resolve_missing_detail",
      args: { p_detail_id: EVIDENCE, p_user_id: USER.id, p_answer: "Room 3" },
      data: row("resolved"),
    },
  ];

  it.each(cases)("$name", async ({ run, fn, args, data }) => {
    const { service, calls } = setup({ data });
    const result = (await run(service)) as { ok: boolean; outcome?: string };
    expect(calls).toEqual([{ fn, args }]);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe((data as { outcome: string }).outcome);
  });

  it("expireRequests passes the household and returns the count", async () => {
    const { service, calls } = setup({ data: 3 });
    expect(await service.expireRequests(USER, { householdId: HOUSEHOLD })).toEqual({
      ok: true,
      count: 3,
    });
    expect(calls).toEqual([{ fn: "expire_care_requests", args: { p_household_id: HOUSEHOLD } }]);
  });

  it("markFeedSeen and setLanguage return a plain ok", async () => {
    const { service, calls } = setup({ data: null });
    expect(await service.markFeedSeen(USER, { householdId: HOUSEHOLD })).toEqual({ ok: true });
    expect(await service.setLanguage(USER, { householdId: HOUSEHOLD, language: "ja" })).toEqual({
      ok: true,
    });
    expect(calls).toEqual([
      { fn: "mark_feed_seen", args: { p_household_id: HOUSEHOLD, p_user_id: USER.id } },
      {
        fn: "set_member_language",
        args: { p_household_id: HOUSEHOLD, p_user_id: USER.id, p_language: "ja" },
      },
    ]);
  });
});

describe("refusals", () => {
  it.each(Object.keys(REFUSAL_MESSAGE_KEYS) as RefusalCode[])(
    "maps %s to its message key",
    async (code) => {
      const { service } = setup({ error: { message: code, code: "P0001" } });
      const result = await service.claim(USER, { stepId: STEP, role: "owner" });
      expect(result).toEqual({
        ok: false,
        code,
        messageKey: REFUSAL_MESSAGE_KEYS[code],
        params: {},
      });
    },
  );

  it("returns committed 'expired' and 'evidence_required' results as ok: true", async () => {
    const expired = setup({ data: row("expired", { request_id: REQUEST }) });
    expect(await expired.service.respond(USER, { requestId: REQUEST, accept: true })).toMatchObject(
      {
        ok: true,
        outcome: "expired",
        requestId: REQUEST,
      },
    );

    const missing = setup({ data: row("evidence_required", { missing: ["Receipt", "Photo"] }) });
    expect(await missing.service.complete(USER, { stepId: STEP })).toMatchObject({
      ok: true,
      outcome: "evidence_required",
      missing: ["Receipt", "Photo"],
    });
  });

  it("returns a signed-out refusal without calling the database", async () => {
    const { service, calls } = setup();
    expect(await service.claim(null, { stepId: STEP, role: "owner" })).toEqual({
      ok: false,
      code: "signed_out",
      messageKey: "refusal.signedOut",
      params: {},
    });
    expect(calls).toEqual([]);
  });

  it("names the failing field for invalid input and does not call the database", async () => {
    const { service, calls } = setup();
    expect(await service.claim(USER, { stepId: "nope", role: "owner" })).toMatchObject({
      ok: false,
      code: "invalid_input",
      messageKey: "refusal.invalidInput",
      params: { field: "stepId" },
    });
    expect(
      await service.recordEvidence(USER, { stepId: STEP, kind: "text", label: "x" }),
    ).toMatchObject({
      params: { field: "text" },
    });
    expect(
      await service.confirmTime(USER, {
        stepId: STEP,
        kind: "task_due",
        at: "2027-01-05T09:30:00",
        timeZone: "Asia/Tokyo",
      }),
    ).toMatchObject({
      params: { field: "at" },
    });
    expect(calls).toEqual([]);
  });
});

describe("unknown failures", () => {
  const unknownErrors: Reply[] = [
    { error: { message: `relation "${SENTINEL}" does not exist`, code: "42P01" } },
    { error: { message: SENTINEL } },
    { data: { outcome: SENTINEL } },
  ];

  it.each(unknownErrors)(
    "gives the generic retry message and logs nothing sensitive",
    async (reply) => {
      const { service } = setup(reply);
      const result = await service.complete(USER, { stepId: STEP });
      expect(result).toEqual({ ok: false, code: "error", messageKey: "refusal.error", params: {} });
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(out.length).toBeGreaterThan(0);
      expect(out.join("\n")).not.toContain(SENTINEL);
    },
  );

  it("handles a thrown store error the same way", async () => {
    const admin = {
      rpc: vi.fn().mockRejectedValue(new Error(SENTINEL)),
    } as unknown as SupabaseClient<Database>;
    const service = createPartActionService({
      store: createSupabasePartActionStore(admin, log),
      log,
    });
    const result = await service.complete(USER, { stepId: STEP });
    expect(result).toMatchObject({ ok: false, code: "error", messageKey: "refusal.error" });
    expect(out.join("\n")).not.toContain(SENTINEL);
  });

  it("logs refusals and successes with allow-listed fields only", async () => {
    const refused = setup({ error: { message: "not_owner" } });
    await refused.service.complete(USER, { stepId: STEP });
    const done = setup({ data: row("completed") });
    await done.service.complete(USER, { stepId: STEP, extra: SENTINEL });
    const lines = out.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines[0]).toMatchObject({
      event: "care.part_action_refused",
      code: "not_owner",
      stage: "complete",
      step_id: STEP,
    });
    expect(lines[1]).toMatchObject({
      event: "care.part_action_done",
      stage: "complete",
      user_id: USER.id,
    });
    expect(out.join("\n")).not.toContain(SENTINEL);
  });
});
