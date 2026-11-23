import { describe, expect, it, vi } from "vitest";
import type { CareChainDraft } from "@/lib/ai/schema";
import type { ExtractionResult } from "@/lib/ai/client";
import { maskLogFields, type LogFields, type LogLevel } from "@/lib/log";
import {
  FAILURE_CODES,
  createRecognizer,
  type RecognitionDeps,
  type RecognitionStore,
  type StartedRun,
  type StaleRunRow,
} from "./recognition";

/** All data is fake. Sentinels stand in for note text and titles. */
const NOTE = "a1000000-0000-4000-8000-000000000001";
const NOTE_2 = "a1000000-0000-4000-8000-000000000002";
const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const RUN = "e1000000-0000-4000-8000-000000000001";
const CHAIN = "a2000000-0000-4000-8000-000000000001";
const USER = "d1000000-0000-4000-8000-000000000002";
const SENTINEL_TITLE = "SENTINEL-Metformin-title";
const SENTINEL_QUOTE = "SENTINEL-4-Chome-quote";

const draft = (): CareChainDraft => ({
  chain_title: SENTINEL_TITLE,
  overall_risk: "low",
  steps: [
    {
      title: "Buy rice",
      description: "",
      care_category: "household",
      risk_level: "low",
      suggested_owner_role: "",
      person_to_ask: null,
      due_at: null,
      escalation_at: null,
      evidence_required: [],
      approval_required: false,
      source_quote: SENTINEL_QUOTE,
      confidence: 0.9,
    },
  ],
  ambiguities: [],
  ai_boundary: { medical_advice_requested: false, blocked_actions: [], explanation: "" },
});

const started = (outcome: StartedRun["outcome"], extra: Partial<StartedRun> = {}): StartedRun => ({
  outcome,
  runId: RUN,
  attempt: 1,
  noteId: NOTE,
  householdId: HOUSEHOLD,
  careChainId: null,
  ...extra,
});

function setup(
  options: {
    start?: StartedRun | { code: string };
    image?: Awaited<ReturnType<RecognitionDeps["readNoteImage"]>>;
    extraction?: ExtractionResult | Error;
    saveError?: string;
    stale?: StaleRunRow[];
  } = {},
) {
  const logs: { level: LogLevel; event: string; fields?: LogFields }[] = [];
  const start = options.start ?? started("started");
  const store = {
    start: vi.fn(async () =>
      "code" in start ? { ok: false as const, code: start.code } : { ok: true as const, value: start },
    ),
    save: vi.fn(async () =>
      options.saveError
        ? { ok: false as const, code: options.saveError }
        : { ok: true as const, value: { careChainId: CHAIN } },
    ),
    fail: vi.fn(async () => ({ ok: true as const, value: null })),
    resumeStale: vi.fn(async () => ({ ok: true as const, value: options.stale ?? [] })),
  } satisfies RecognitionStore;
  const readNoteImage = vi.fn(async () =>
    options.image === undefined ? { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" } : options.image,
  );
  const extract = vi.fn(async (): Promise<ExtractionResult> => {
    const e = options.extraction ?? { ok: true, draft: draft() };
    if (e instanceof Error) throw e;
    return e;
  });
  const recognizer = createRecognizer({
    store,
    readNoteImage,
    extract,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    now: () => new Date("2026-12-10T00:00:00Z"),
  });
  return { recognizer, store, readNoteImage, extract, logs };
}

describe("recognize", () => {
  it("calls ai& once and saves once on the happy path", async () => {
    const t = setup();
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result).toEqual({ state: "ready", runId: RUN, careChainId: CHAIN });
    expect(t.extract).toHaveBeenCalledTimes(1);
    expect(t.store.save).toHaveBeenCalledTimes(1);
    expect(t.store.fail).not.toHaveBeenCalled();
    const [runId, payload] = t.store.save.mock.calls[0] as unknown as [string, { steps: unknown[] }];
    expect(runId).toBe(RUN);
    expect(payload.steps).toHaveLength(1);
  });

  it.each(["already_running", "done"] as const)("does not call ai& when the run is %s", async (outcome) => {
    const t = setup({ start: started(outcome, { careChainId: outcome === "done" ? CHAIN : null }) });
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result.state).toBe(outcome);
    expect(t.readNoteImage).not.toHaveBeenCalled();
    expect(t.extract).not.toHaveBeenCalled();
    expect(t.store.save).not.toHaveBeenCalled();
    expect(t.store.fail).not.toHaveBeenCalled();
  });

  it("returns not_started when the start is refused", async () => {
    const t = setup({ start: { code: "part_not_found" } });
    expect(await t.recognizer.recognize(NOTE, USER)).toEqual({ state: "not_started", code: "part_not_found" });
    expect(t.extract).not.toHaveBeenCalled();
  });

  it.each([
    ["upload_failed", true],
    ["completion_failed", true],
    ["invalid_json", true],
    ["schema_invalid", true],
    ["safety_violation", true],
    ["model_unavailable", false],
  ] as const)("fails the run with %s when ai& reports it", async (reason, retryable) => {
    const t = setup({ extraction: { ok: false, reason, detail: `SENTINEL detail ${SENTINEL_QUOTE}` } });
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result).toMatchObject({ state: "failed", code: reason, retryable });
    expect(t.store.fail).toHaveBeenCalledWith(RUN, reason, retryable);
    expect(t.store.save).not.toHaveBeenCalled();
    expect(JSON.stringify(t.store.fail.mock.calls)).not.toContain("SENTINEL");
  });

  it("fails with image_not_found when the photo cannot be read", async () => {
    const t = setup({ image: null });
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result).toMatchObject({ state: "failed", code: "image_not_found", retryable: false });
    expect(t.extract).not.toHaveBeenCalled();
    expect(t.store.fail).toHaveBeenCalledWith(RUN, "image_not_found", false);
  });

  it("fails with payload_invalid when the mapped rows break a rule", async () => {
    const bad = draft();
    bad.chain_title = "   ";
    const t = setup({ extraction: { ok: true, draft: bad } });
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result).toMatchObject({ state: "failed", code: "payload_invalid" });
    expect(t.store.save).not.toHaveBeenCalled();
    expect(t.store.fail).toHaveBeenCalledWith(RUN, "payload_invalid", true);
  });

  it("fails the run when the save is refused, with a plain code", async () => {
    const t = setup({ saveError: "invalid_input" });
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result).toMatchObject({ state: "failed", code: "db_error", retryable: true });
    expect(t.store.save).toHaveBeenCalledTimes(1);
    expect(t.store.fail).toHaveBeenCalledWith(RUN, "db_error", true);
  });

  it("never throws when ai&, the store, or fail itself throw", async () => {
    const t = setup({ extraction: new Error(`boom ${SENTINEL_QUOTE}`) });
    t.store.fail.mockRejectedValueOnce(new Error("down"));
    const result = await t.recognizer.recognize(NOTE, USER);
    expect(result).toMatchObject({ state: "failed", code: "completion_failed" });
    t.store.start.mockRejectedValueOnce(new Error("down"));
    expect(await t.recognizer.recognize(NOTE, USER)).toEqual({ state: "not_started", code: "error" });
  });

  it("only uses reason codes from the fixed list", async () => {
    const t = setup({ extraction: { ok: false, reason: "invalid_json", detail: "x" } });
    const result = await t.recognizer.recognize(NOTE, null);
    expect(result.state === "failed" && FAILURE_CODES.includes(result.code as never)).toBe(true);
  });

  it("writes no note content to the log", async () => {
    const ok = setup();
    await ok.recognizer.recognize(NOTE, USER);
    const bad = setup({
      extraction: { ok: false, reason: "schema_invalid", detail: `${SENTINEL_TITLE} ${SENTINEL_QUOTE}` },
    });
    await bad.recognizer.recognize(NOTE, USER);
    const throwing = setup({ extraction: new Error(`${SENTINEL_TITLE}`) });
    await throwing.recognizer.recognize(NOTE, USER);
    for (const t of [ok, bad, throwing]) {
      const text = JSON.stringify(t.logs.map((l) => ({ ...l, fields: maskLogFields(l.fields) })));
      expect(text).not.toContain("SENTINEL");
    }
  });
});

describe("resumeStaleRuns", () => {
  const row = (action: StaleRunRow["action"], noteId: string): StaleRunRow => ({
    runId: RUN,
    noteId,
    householdId: HOUSEHOLD,
    attempt: 2,
    action,
  });

  it("restarts only restart rows, with no user", async () => {
    const t = setup({ stale: [row("restart", NOTE), row("failed", NOTE_2)] });
    const summary = await t.recognizer.resumeStaleRuns(5);
    expect(summary).toEqual({ restarted: 1, failed: 1, errors: 0 });
    expect(t.store.resumeStale).toHaveBeenCalledWith(5);
    expect(t.store.start).toHaveBeenCalledTimes(1);
    expect(t.store.start).toHaveBeenCalledWith(NOTE, null);
    expect(t.extract).toHaveBeenCalledTimes(1);
  });
});
