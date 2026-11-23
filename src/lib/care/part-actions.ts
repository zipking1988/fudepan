import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { SessionUser } from "@/lib/auth/session";
import { errorCode, type Logger } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

import { isValidTimeZone } from "./appointment";
import {
  REFUSAL_MESSAGE_KEYS,
  refusalMessageKey,
  type RefusalCode,
  type RefusalMessageKey,
} from "./rules/refusals";

type Client = SupabaseClient<Database>;

/**
 * Service layer for Part actions (family-shared-care design, "Services and
 * Server Actions").
 *
 * The service validates input with Zod, requires a signed-in user, asks the
 * store to run the SQL function, and returns either a committed outcome or a
 * plain-language message key. Raw refusal codes, SQL text, and error messages
 * never reach the caller's UI. The Supabase store calls the service-role SQL
 * functions; the Action_Guard rules live in SQL, so a refusal there is final.
 *
 * Revalidating paths is the Server Action's job, not this module's.
 */

export type PartActionMessageKey = RefusalMessageKey | "refusal.signedOut";
export type PartActionCode = RefusalCode | "signed_out";

export type PartActionFailure = {
  ok: false;
  code: PartActionCode;
  messageKey: PartActionMessageKey;
  /** For invalid input: the name of the first field that failed, so the form can point at it. */
  params: { field?: string };
};

/** A committed result. 'expired' and 'evidence_required' are ok: true; the UI must show them. */
export type PartOutcome = {
  outcome: string;
  careChainId: string;
  noteId: string;
  approvalReset: boolean;
  requestId?: string;
  evidenceId?: string;
  /** Labels of required evidence still missing (outcome 'evidence_required'). */
  missing?: string[];
  approvalState?: "approved" | "rejected" | "pending";
  selfApproval?: boolean;
  reason?: string;
};

export type PartActionResult = ({ ok: true } & PartOutcome) | PartActionFailure;
export type PartActionDoneResult = { ok: true } | PartActionFailure;
export type PartActionCountResult = { ok: true; count: number } | PartActionFailure;

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const ID = z.uuid();
const ROLE = z.enum(["owner", "driver", "companion"]);
const REASON_CODE = /^[a-z][a-z0-9_]{0,59}$/;

export const partActionInputs = {
  claim: z.object({ stepId: ID, role: ROLE }),
  release: z.object({ stepId: ID, role: ROLE }),
  requestAssignment: z.object({ stepId: ID, toMemberId: ID }),
  requestHandover: z.object({ stepId: ID, role: ROLE, toMemberId: ID }),
  requestBackup: z.object({ stepId: ID, toMemberId: ID }),
  volunteerBackup: z.object({ stepId: ID }),
  respond: z.object({ requestId: ID, accept: z.boolean() }),
  expireRequests: z.object({ householdId: ID.optional() }),
  decideApproval: z.object({ stepId: ID, decision: z.enum(["approve", "reject"]) }),
  resubmit: z.object({
    stepId: ID,
    explanation: z.string().trim().max(1000).optional(),
    evidenceIds: z.array(ID).max(10).default([]),
  }),
  complete: z.object({ stepId: ID }),
  fail: z.object({ stepId: ID, reasonCode: z.string().regex(REASON_CODE).default("unspecified") }),
  reopen: z.object({ stepId: ID }),
  recordEvidence: z
    .object({
      stepId: ID,
      kind: z.enum(["photo", "file", "text"]),
      label: z.string().trim().min(1).max(200),
      storagePath: z.string().max(300).optional(),
      text: z.string().trim().min(1).max(2000).optional(),
    })
    .superRefine((value, ctx) => {
      if (value.kind === "text") {
        if (value.text === undefined)
          ctx.addIssue({ code: "custom", path: ["text"], message: "text required" });
        if (value.storagePath !== undefined) {
          ctx.addIssue({ code: "custom", path: ["storagePath"], message: "no file for text" });
        }
      } else {
        if (value.storagePath === undefined) {
          ctx.addIssue({ code: "custom", path: ["storagePath"], message: "file required" });
        }
        if (value.text !== undefined)
          ctx.addIssue({ code: "custom", path: ["text"], message: "no text for file" });
      }
    }),
  confirmTime: z.object({
    stepId: ID,
    kind: z.enum(["appointment", "respond_by", "task_due"]),
    at: z.iso.datetime({ offset: true }),
    timeZone: z.string().min(1).max(64).refine(isValidTimeZone, "unknown time zone"),
  }),
  saveAmount: z.object({
    stepId: ID,
    amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    currency: z.string().regex(/^[A-Z]{3}$/),
  }),
  resolveMissingDetail: z.object({ detailId: ID, answer: z.string().trim().min(1).max(500) }),
  markFeedSeen: z.object({ householdId: ID, seenAt: z.iso.datetime({ offset: true }).optional() }),
  setLanguage: z.object({ householdId: ID, language: z.enum(["en", "ja"]) }),
} as const;

type Input<K extends keyof typeof partActionInputs> = z.output<(typeof partActionInputs)[K]>;
type WithUser<T> = T & { userId: string };

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export type StoreResult<T> = { ok: true; value: T } | { ok: false; code: RefusalCode };

export interface PartActionStore {
  claim(input: WithUser<Input<"claim">>): Promise<StoreResult<PartOutcome>>;
  release(input: WithUser<Input<"release">>): Promise<StoreResult<PartOutcome>>;
  requestAssignment(input: WithUser<Input<"requestAssignment">>): Promise<StoreResult<PartOutcome>>;
  requestHandover(input: WithUser<Input<"requestHandover">>): Promise<StoreResult<PartOutcome>>;
  requestBackup(input: WithUser<Input<"requestBackup">>): Promise<StoreResult<PartOutcome>>;
  volunteerBackup(input: WithUser<Input<"volunteerBackup">>): Promise<StoreResult<PartOutcome>>;
  respond(input: WithUser<Input<"respond">>): Promise<StoreResult<PartOutcome>>;
  expireRequests(input: WithUser<Input<"expireRequests">>): Promise<StoreResult<number>>;
  decideApproval(input: WithUser<Input<"decideApproval">>): Promise<StoreResult<PartOutcome>>;
  resubmit(input: WithUser<Input<"resubmit">>): Promise<StoreResult<PartOutcome>>;
  complete(input: WithUser<Input<"complete">>): Promise<StoreResult<PartOutcome>>;
  fail(input: WithUser<Input<"fail">>): Promise<StoreResult<PartOutcome>>;
  reopen(input: WithUser<Input<"reopen">>): Promise<StoreResult<PartOutcome>>;
  recordEvidence(input: WithUser<Input<"recordEvidence">>): Promise<StoreResult<PartOutcome>>;
  confirmTime(input: WithUser<Input<"confirmTime">>): Promise<StoreResult<PartOutcome>>;
  saveAmount(input: WithUser<Input<"saveAmount">>): Promise<StoreResult<PartOutcome>>;
  resolveMissingDetail(
    input: WithUser<Input<"resolveMissingDetail">>,
  ): Promise<StoreResult<PartOutcome>>;
  markFeedSeen(input: WithUser<Input<"markFeedSeen">>): Promise<StoreResult<null>>;
  setLanguage(input: WithUser<Input<"setLanguage">>): Promise<StoreResult<null>>;
}

type PartActionName = keyof PartActionStore;

function failure(code: PartActionCode, field?: string): PartActionFailure {
  const messageKey: PartActionMessageKey =
    code === "signed_out" ? "refusal.signedOut" : refusalMessageKey(code);
  return { ok: false, code, messageKey, params: field === undefined ? {} : { field } };
}

function toResult(value: PartOutcome): PartActionResult {
  return { ok: true, ...value };
}

export function createPartActionService(deps: { store: PartActionStore; log: Logger }) {
  const { store, log } = deps;

  function safeLog(...args: Parameters<Logger>): void {
    try {
      log(...args);
    } catch {
      // Logging must never change the result of an action.
    }
  }

  async function run<S extends z.ZodType, T>(
    action: PartActionName,
    schema: S,
    user: SessionUser | null,
    input: unknown,
    call: (parsed: WithUser<z.output<S>>) => Promise<StoreResult<T>>,
  ): Promise<{ ok: true; value: T } | PartActionFailure> {
    if (!user) return failure("signed_out");

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const field = parsed.error.issues[0]?.path[0];
      safeLog("warn", "care.part_action_refused", {
        stage: action,
        code: "invalid_input",
        user_id: user.id,
      });
      return failure("invalid_input", typeof field === "string" ? field : undefined);
    }
    const data = parsed.data as Record<string, unknown>;

    let result: StoreResult<T>;
    try {
      result = await call({ ...(parsed.data as object), userId: user.id } as WithUser<z.output<S>>);
    } catch (error) {
      safeLog("error", "care.part_action_failed", {
        stage: action,
        code: errorCode(error),
        user_id: user.id,
      });
      return failure("error");
    }

    const ids = {
      step_id: typeof data.stepId === "string" ? data.stepId : undefined,
      request_id: typeof data.requestId === "string" ? data.requestId : undefined,
    };
    if (!result.ok) {
      safeLog(result.code === "error" ? "error" : "warn", "care.part_action_refused", {
        stage: action,
        code: result.code,
        user_id: user.id,
        ...ids,
      });
      return failure(result.code);
    }
    safeLog("info", "care.part_action_done", { stage: action, user_id: user.id, ...ids });
    return result;
  }

  async function outcome<S extends z.ZodType>(
    action: PartActionName,
    schema: S,
    user: SessionUser | null,
    input: unknown,
    call: (parsed: WithUser<z.output<S>>) => Promise<StoreResult<PartOutcome>>,
  ): Promise<PartActionResult> {
    const result = await run(action, schema, user, input, call);
    return result.ok ? toResult(result.value) : result;
  }

  async function done<S extends z.ZodType>(
    action: PartActionName,
    schema: S,
    user: SessionUser | null,
    input: unknown,
    call: (parsed: WithUser<z.output<S>>) => Promise<StoreResult<null>>,
  ): Promise<PartActionDoneResult> {
    const result = await run(action, schema, user, input, call);
    return result.ok ? { ok: true } : result;
  }

  const i = partActionInputs;

  return {
    claim: (user: SessionUser | null, input: unknown) =>
      outcome("claim", i.claim, user, input, (p) => store.claim(p)),
    release: (user: SessionUser | null, input: unknown) =>
      outcome("release", i.release, user, input, (p) => store.release(p)),
    requestAssignment: (user: SessionUser | null, input: unknown) =>
      outcome("requestAssignment", i.requestAssignment, user, input, (p) =>
        store.requestAssignment(p),
      ),
    requestHandover: (user: SessionUser | null, input: unknown) =>
      outcome("requestHandover", i.requestHandover, user, input, (p) => store.requestHandover(p)),
    requestBackup: (user: SessionUser | null, input: unknown) =>
      outcome("requestBackup", i.requestBackup, user, input, (p) => store.requestBackup(p)),
    volunteerBackup: (user: SessionUser | null, input: unknown) =>
      outcome("volunteerBackup", i.volunteerBackup, user, input, (p) => store.volunteerBackup(p)),
    respond: (user: SessionUser | null, input: unknown) =>
      outcome("respond", i.respond, user, input, (p) => store.respond(p)),
    async expireRequests(
      user: SessionUser | null,
      input: unknown = {},
    ): Promise<PartActionCountResult> {
      const result = await run("expireRequests", i.expireRequests, user, input, (p) =>
        store.expireRequests(p),
      );
      return result.ok ? { ok: true, count: result.value } : result;
    },
    decideApproval: (user: SessionUser | null, input: unknown) =>
      outcome("decideApproval", i.decideApproval, user, input, (p) => store.decideApproval(p)),
    resubmit: (user: SessionUser | null, input: unknown) =>
      outcome("resubmit", i.resubmit, user, input, (p) => store.resubmit(p)),
    complete: (user: SessionUser | null, input: unknown) =>
      outcome("complete", i.complete, user, input, (p) => store.complete(p)),
    fail: (user: SessionUser | null, input: unknown) =>
      outcome("fail", i.fail, user, input, (p) => store.fail(p)),
    reopen: (user: SessionUser | null, input: unknown) =>
      outcome("reopen", i.reopen, user, input, (p) => store.reopen(p)),
    recordEvidence: (user: SessionUser | null, input: unknown) =>
      outcome("recordEvidence", i.recordEvidence, user, input, (p) => store.recordEvidence(p)),
    confirmTime: (user: SessionUser | null, input: unknown) =>
      outcome("confirmTime", i.confirmTime, user, input, (p) => store.confirmTime(p)),
    saveAmount: (user: SessionUser | null, input: unknown) =>
      outcome("saveAmount", i.saveAmount, user, input, (p) => store.saveAmount(p)),
    resolveMissingDetail: (user: SessionUser | null, input: unknown) =>
      outcome("resolveMissingDetail", i.resolveMissingDetail, user, input, (p) =>
        store.resolveMissingDetail(p),
      ),
    markFeedSeen: (user: SessionUser | null, input: unknown) =>
      done("markFeedSeen", i.markFeedSeen, user, input, (p) => store.markFeedSeen(p)),
    setLanguage: (user: SessionUser | null, input: unknown) =>
      done("setLanguage", i.setLanguage, user, input, (p) => store.setLanguage(p)),
  };
}

export type PartActionService = ReturnType<typeof createPartActionService>;

// ---------------------------------------------------------------------------
// Supabase store
// ---------------------------------------------------------------------------

const outcomeRow = z.object({
  care_chain_id: z.uuid(),
  note_id: z.uuid(),
  outcome: z.string().min(1).max(40),
  approval_reset: z.boolean().optional(),
  request_id: z.uuid().optional(),
  evidence_id: z.uuid().optional(),
  missing: z.array(z.string()).optional(),
  approval_state: z.enum(["approved", "rejected", "pending"]).optional(),
  self_approval: z.boolean().optional(),
  reason: z.string().max(60).optional(),
});

function toOutcome(row: z.output<typeof outcomeRow>): PartOutcome {
  return {
    outcome: row.outcome,
    careChainId: row.care_chain_id,
    noteId: row.note_id,
    approvalReset: row.approval_reset ?? false,
    ...(row.request_id !== undefined && { requestId: row.request_id }),
    ...(row.evidence_id !== undefined && { evidenceId: row.evidence_id }),
    ...(row.missing !== undefined && { missing: row.missing }),
    ...(row.approval_state !== undefined && { approvalState: row.approval_state }),
    ...(row.self_approval !== undefined && { selfApproval: row.self_approval }),
    ...(row.reason !== undefined && { reason: row.reason }),
  };
}

type RpcResponse = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

function isRefusalCode(message: string): message is RefusalCode {
  return Object.hasOwn(REFUSAL_MESSAGE_KEYS, message);
}

/** `admin` must be the service-role client; the SQL functions are not callable by browser roles. */
export function createSupabasePartActionStore(admin: Client, log: Logger): PartActionStore {
  async function execute<T>(
    action: PartActionName,
    call: () => RpcResponse,
    parse: (data: unknown) => T | undefined,
  ): Promise<StoreResult<T>> {
    const { data, error } = await call();
    if (error) {
      if (isRefusalCode(error.message)) return { ok: false, code: error.message };
      log("error", "care.part_action_rpc_failed", { stage: action, code: errorCode(error) });
      return { ok: false, code: "error" };
    }
    const value = parse(data);
    if (value === undefined) {
      log("error", "care.part_action_rpc_failed", { stage: action, code: "unexpected_result" });
      return { ok: false, code: "error" };
    }
    return { ok: true, value };
  }

  const parseOutcome = (data: unknown) => {
    const parsed = outcomeRow.safeParse(data);
    return parsed.success ? toOutcome(parsed.data) : undefined;
  };
  const parseCount = (data: unknown) => {
    const parsed = z.number().int().nonnegative().safeParse(data);
    return parsed.success ? parsed.data : undefined;
  };
  // Functions returning void send null.
  const parseVoid = (data: unknown) => (data === null || data === undefined ? null : undefined);

  const outcomeOf = (action: PartActionName, call: () => RpcResponse) =>
    execute(action, call, parseOutcome);

  return {
    claim: ({ stepId, role, userId }) =>
      outcomeOf("claim", () =>
        admin.rpc("claim_part", { p_step_id: stepId, p_user_id: userId, p_role: role }),
      ),
    release: ({ stepId, role, userId }) =>
      outcomeOf("release", () =>
        admin.rpc("release_part", { p_step_id: stepId, p_user_id: userId, p_role: role }),
      ),
    requestAssignment: ({ stepId, toMemberId, userId }) =>
      outcomeOf("requestAssignment", () =>
        admin.rpc("request_assignment", {
          p_step_id: stepId,
          p_user_id: userId,
          p_to_member_id: toMemberId,
        }),
      ),
    requestHandover: ({ stepId, role, toMemberId, userId }) =>
      outcomeOf("requestHandover", () =>
        admin.rpc("request_handover", {
          p_step_id: stepId,
          p_user_id: userId,
          p_role: role,
          p_to_member_id: toMemberId,
        }),
      ),
    requestBackup: ({ stepId, toMemberId, userId }) =>
      outcomeOf("requestBackup", () =>
        admin.rpc("request_backup", {
          p_step_id: stepId,
          p_user_id: userId,
          p_to_member_id: toMemberId,
        }),
      ),
    volunteerBackup: ({ stepId, userId }) =>
      outcomeOf("volunteerBackup", () =>
        admin.rpc("volunteer_backup", { p_step_id: stepId, p_user_id: userId }),
      ),
    respond: ({ requestId, accept, userId }) =>
      outcomeOf("respond", () =>
        admin.rpc("respond_to_request", {
          p_request_id: requestId,
          p_user_id: userId,
          p_accept: accept,
        }),
      ),
    expireRequests: ({ householdId }) =>
      execute(
        "expireRequests",
        () =>
          admin.rpc(
            "expire_care_requests",
            householdId === undefined ? {} : { p_household_id: householdId },
          ),
        parseCount,
      ),
    decideApproval: ({ stepId, decision, userId }) =>
      outcomeOf("decideApproval", () =>
        admin.rpc("decide_approval", {
          p_step_id: stepId,
          p_user_id: userId,
          p_decision: decision,
        }),
      ),
    resubmit: ({ stepId, explanation, evidenceIds, userId }) =>
      outcomeOf("resubmit", () =>
        admin.rpc("resubmit_part", {
          p_step_id: stepId,
          p_user_id: userId,
          p_evidence_ids: evidenceIds,
          ...(explanation !== undefined && { p_explanation: explanation }),
        }),
      ),
    complete: ({ stepId, userId }) =>
      outcomeOf("complete", () =>
        admin.rpc("complete_part", { p_step_id: stepId, p_user_id: userId }),
      ),
    fail: ({ stepId, reasonCode, userId }) =>
      outcomeOf("fail", () =>
        admin.rpc("report_part_failed", {
          p_step_id: stepId,
          p_user_id: userId,
          p_reason_code: reasonCode,
        }),
      ),
    reopen: ({ stepId, userId }) =>
      outcomeOf("reopen", () => admin.rpc("reopen_part", { p_step_id: stepId, p_user_id: userId })),
    recordEvidence: ({ stepId, kind, label, storagePath, text, userId }) =>
      outcomeOf("recordEvidence", () =>
        admin.rpc("record_evidence", {
          p_step_id: stepId,
          p_user_id: userId,
          p_kind: kind,
          p_label: label,
          ...(storagePath !== undefined && { p_storage_path: storagePath }),
          ...(text !== undefined && { p_text: text }),
        }),
      ),
    confirmTime: ({ stepId, kind, at, timeZone, userId }) =>
      outcomeOf("confirmTime", () =>
        admin.rpc("confirm_part_time", {
          p_step_id: stepId,
          p_user_id: userId,
          p_kind: kind,
          p_at: new Date(at).toISOString(),
          p_timezone: timeZone,
        }),
      ),
    saveAmount: ({ stepId, amountMinor, currency, userId }) =>
      outcomeOf("saveAmount", () =>
        admin.rpc("save_part_amount", {
          p_step_id: stepId,
          p_user_id: userId,
          p_amount_minor: amountMinor,
          p_currency: currency,
        }),
      ),
    resolveMissingDetail: ({ detailId, answer, userId }) =>
      outcomeOf("resolveMissingDetail", () =>
        admin.rpc("resolve_missing_detail", {
          p_detail_id: detailId,
          p_user_id: userId,
          p_answer: answer,
        }),
      ),
    markFeedSeen: ({ householdId, seenAt, userId }) =>
      execute(
        "markFeedSeen",
        () =>
          admin.rpc("mark_feed_seen", {
            p_household_id: householdId,
            p_user_id: userId,
            ...(seenAt !== undefined && { p_seen_at: new Date(seenAt).toISOString() }),
          }),
        parseVoid,
      ),
    setLanguage: ({ householdId, language, userId }) =>
      execute(
        "setLanguage",
        () =>
          admin.rpc("set_member_language", {
            p_household_id: householdId,
            p_user_id: userId,
            p_language: language,
          }),
        parseVoid,
      ),
  };
}
