import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizePayload, toAuditRow } from "@/lib/audit";
import type { LlmAdapter } from "@/lib/ai";
import { createDraftTask } from "@/server/api/tasks/create-draft";
import { buildExtractionAuditPayload, extractTaskForNote } from "@/server/api/tasks/extract";
import { TaskServiceError } from "@/server/api/tasks/errors";

const ids = {
  userId: "11111111-1111-4111-8111-111111111111",
  householdId: "22222222-2222-4222-8222-222222222222",
  noteId: "33333333-3333-4333-8333-333333333333",
  extractionId: "44444444-4444-4444-8444-444444444444",
  memberId: "55555555-5555-4555-8555-555555555555",
};

interface Fake {
  note?: Record<string, unknown> | null;
  extraction?: Record<string, unknown> | null;
  members?: Record<string, unknown>[];
  rpcError?: { code: string } | null;
  auditError?: boolean;
}

function fake(f: Fake = {}) {
  const inserts: Record<string, unknown>[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => ((filters[k] = v), q),
      order: () => q,
      maybeSingle: async () => ({
        data:
          table === "notes"
            ? f.note === undefined
              ? defaultNote
              : f.note
            : table === "audit_events"
              ? (f.extraction ?? null)
              : null,
      }),
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: f.auditError ? { message: "x" } : null };
      },
      then: (resolve: (v: unknown) => void) =>
        resolve({ data: table === "members" ? (f.members ?? []) : [] }),
    };
    return q;
  };
  const client = {
    from: query,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return f.rpcError
        ? { data: null, error: f.rpcError }
        : { data: "66666666-6666-4666-8666-666666666666", error: null };
    },
    storage: {
      from: () => ({
        download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null }),
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, inserts, rpcs };
}

const defaultNote = {
  id: ids.noteId,
  source_type: "text",
  text_content: "Buy milk",
  image_path: null,
  ocr_text: null,
  ocr_confidence: null,
};

const llm = (content: string): LlmAdapter => ({
  provider: "aiand",
  modelId: "vendor/test-model",
  supportsVision: async () => true,
  supportsImageType: () => true,
  completeJson: async () => ({
    content,
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3, reasoningTokens: null },
    responseMode: "json_schema",
    imageSent: false,
  }),
});
const good = JSON.stringify({
  title: "Buy milk",
  category: "reminder",
  dueDate: "2030-01-02",
  dueTime: "10:00",
  location: null,
  assigneeSuggestion: "hanako",
  notes: null,
  confidence: 0.95,
  uncertainFields: [],
});

describe("extractTaskForNote", () => {
  const base = {
    userId: ids.userId,
    householdId: ids.householdId,
    noteId: ids.noteId,
    timeZone: "Asia/Tokyo",
    requestId: "r1",
    now: new Date("2030-01-01T03:00:00Z"),
  };

  it("writes a task_extracted audit event with model, prompt version, confidence and usage, and no raw text", async () => {
    const { client, inserts } = fake({ members: [{ id: ids.memberId, display_name: "Hanako" }] });
    const logs: Record<string, unknown>[] = [];
    const res = await extractTaskForNote({
      ...base,
      supabase: client,
      llm: llm(good),
      log: (e) => logs.push(e),
    });

    expect(res.task).toMatchObject({
      title: "Buy milk",
      assigneeId: ids.memberId,
      riskLevel: "low",
    });
    const audit = inserts[0]!;
    expect(audit).toMatchObject({
      id: res.extractionId,
      event_type: "task_extracted",
      note_id: ids.noteId,
      task_id: null,
      actor_id: ids.userId,
      household_id: ids.householdId,
    });
    const payload = audit.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      model: "vendor/test-model",
      prompt_version: "task-extraction/v1",
      confidence: 0.95,
      status: "ok",
      usage: { total_tokens: 3 },
    });
    expect(JSON.stringify(audit)).not.toContain('"text_content"');
    expect(JSON.stringify(logs)).not.toContain("Buy milk");
    expect(logs[0]).toMatchObject({
      provider: "aiand",
      model: "vendor/test-model",
      totalTokens: 3,
    });
  });

  it("audits failures and still returns no task, so the user reviews manually", async () => {
    const { client, inserts } = fake();
    const res = await extractTaskForNote({ ...base, supabase: client, llm: llm("not json") });
    expect(res.task).toBeNull();
    expect(res.status).toBe("failed");
    expect((inserts[0]!.payload as Record<string, unknown>).failure_code).toBe("invalid_json");
  });

  it("audits an unavailable provider", async () => {
    const { client, inserts } = fake();
    const res = await extractTaskForNote({ ...base, supabase: client, llm: null });
    expect(res.status).toBe("unavailable");
    expect(inserts).toHaveLength(1);
  });

  it("fails when the audit event cannot be written, and when the note is not visible", async () => {
    await expect(
      extractTaskForNote({ ...base, supabase: fake({ auditError: true }).client, llm: llm(good) }),
    ).rejects.toMatchObject({ code: "database_failed" });
    await expect(
      extractTaskForNote({ ...base, supabase: fake({ note: null }).client, llm: llm(good) }),
    ).rejects.toBeInstanceOf(TaskServiceError);
  });

  it("builds a payload without images or raw text", () => {
    const p = buildExtractionAuditPayload({
      status: "failed",
      task: null,
      warnings: ["extraction_failed"],
      meta: {
        provider: "aiand",
        modelId: "m",
        promptVersion: "v",
        confidence: null,
        usage: null,
        responseMode: null,
        imageAttached: false,
        failureCode: "timeout",
        latencyMs: 5,
      },
    });
    expect(p).toMatchObject({ model: "m", failure_code: "timeout", parsed: null, usage: null });
  });
});

describe("createDraftTask", () => {
  const input = {
    noteId: ids.noteId,
    extractionId: null,
    title: "Buy milk",
    category: "reminder" as const,
    dueDate: null,
    dueTime: null,
    location: null,
    assigneeId: null,
    notes: null,
  };
  const args = (client: SupabaseClient, over = {}) => ({
    supabase: client,
    admin: client,
    role: "caregiver" as const,
    userId: ids.userId,
    householdId: ids.householdId,
    input: { ...input, ...over },
    now: new Date("2030-01-01T03:00:00Z"),
  });
  const extraction = (over: Record<string, unknown> = {}) => ({
    payload: {
      status: "needs_review",
      confidence: 0.6,
      model: "vendor/test-model",
      prompt_version: "task-extraction/v1",
      parsed: {
        title: "Buy mik",
        category: "reminder",
        due_date: null,
        due_time: null,
        location: null,
        notes: null,
      },
      ...over,
    },
  });

  it("creates only a draft through one atomic RPC, with no status parameter", async () => {
    const { client, rpcs } = fake();
    const r = await createDraftTask(args(client));
    expect(r).toMatchObject({ status: "draft", riskLevel: "low", needsReview: false });
    expect(rpcs).toHaveLength(1);
    expect(rpcs[0]!.fn).toBe("create_draft_task");
    const keys = Object.keys(rpcs[0]!.args);
    expect(keys.some((k) => /status|approved/.test(k))).toBe(false);
    expect(rpcs[0]!.args.p_audit_payload).toMatchObject({ source: "manual", risk_level: "low" });
  });

  it("computes risk on the server: high for medication and for risky keywords under a low-risk category", async () => {
    expect(
      (await createDraftTask(args(fake().client, { title: "Take pills", category: "medication" })))
        .riskLevel,
    ).toBe("high");
    expect(
      (
        await createDraftTask(
          args(fake().client, { title: "Pay the electricity bill", category: "reminder" }),
        )
      ).riskLevel,
    ).toBe("high");
  });

  it("keeps medium risk and needs_review for a low-confidence extraction, and records edits", async () => {
    const { client, rpcs } = fake({ extraction: extraction() });
    const r = await createDraftTask(
      args(client, { extractionId: ids.extractionId, title: "Buy milk" }),
    );
    expect(r).toMatchObject({ riskLevel: "medium", needsReview: true });
    const payload = rpcs[0]!.args.p_audit_payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      extraction_id: ids.extractionId,
      model: "vendor/test-model",
      prompt_version: "task-extraction/v1",
      extraction_confidence: 0.6,
      source: "ai_extraction_reviewed",
      edited_fields: ["title"],
    });
  });

  it("normalizes dates to ISO 8601, defaults a missing time to 09:00 and marks the task for review", async () => {
    const { client, rpcs } = fake();
    const r = await createDraftTask({
      ...args(client, { dueDate: "2030-01-05", timeZone: "Asia/Tokyo" }),
    });
    expect(rpcs[0]!.args.p_due_at).toBe("2030-01-05T09:00:00+09:00");
    expect(r.needsReview).toBe(true);
    const full = await createDraftTask(
      args(fake().client, { dueDate: "2030-01-05", dueTime: "15:30", timeZone: "Asia/Tokyo" }),
    );
    expect(full.needsReview).toBe(false);
  });

  it("masks sensitive values before persistence, including in the audit payload", async () => {
    const { client, rpcs } = fake();
    await createDraftTask(
      args(client, {
        title: "Pay rent card 4242 4242 4242 4242",
        notes: "password: hunter22",
        location: "Account number: 12345678",
      }),
    );
    const sent = JSON.stringify(rpcs[0]!.args);
    expect(sent).not.toMatch(/4242 4242|hunter22|12345678/);
    expect(sent).toContain("[MASKED]");
  });

  it("rejects an extraction that does not belong to the note, and a missing note", async () => {
    await expect(
      createDraftTask(args(fake({ extraction: null }).client, { extractionId: ids.extractionId })),
    ).rejects.toMatchObject({ code: "invalid_extraction" });
    await expect(createDraftTask(args(fake({ note: null }).client))).rejects.toMatchObject({
      code: "note_not_found",
    });
  });

  it("maps database errors without leaking details", async () => {
    await expect(
      createDraftTask(args(fake({ rpcError: { code: "23503" } }).client)),
    ).rejects.toMatchObject({ code: "invalid_assignee" });
    await expect(
      createDraftTask(args(fake({ rpcError: { code: "42501" } }).client)),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      createDraftTask(args(fake({ rpcError: { code: "XX000" } }).client)),
    ).rejects.toMatchObject({ code: "database_failed" });
  });
});

describe("audit helpers", () => {
  it("masks nested strings in payloads", () => {
    expect(
      sanitizePayload({ a: ["Card 4242 4242 4242 4242"], b: { c: "otp is 123456", n: 5 } }),
    ).toEqual({ a: ["Card [MASKED]"], b: { c: "otp is [MASKED]", n: 5 } });
  });
  it("builds validated audit rows and requires a task or note", () => {
    const row = toAuditRow({
      householdId: ids.householdId,
      taskId: null,
      noteId: ids.noteId,
      actorId: ids.userId,
      eventType: "task_extracted",
      payload: { x: 1 },
    });
    expect(row).toMatchObject({
      household_id: ids.householdId,
      note_id: ids.noteId,
      event_type: "task_extracted",
      payload: { x: 1 },
    });
    expect(() =>
      toAuditRow({
        householdId: ids.householdId,
        taskId: null,
        noteId: null,
        actorId: ids.userId,
        eventType: "task_updated",
        payload: {},
      }),
    ).toThrow();
    expect(() =>
      toAuditRow({
        householdId: ids.householdId,
        taskId: ids.noteId,
        noteId: null,
        actorId: ids.userId,
        eventType: "task_deleted" as never,
        payload: {},
      }),
    ).toThrow();
  });
});
