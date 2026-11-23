import { describe, expect, it, vi } from "vitest";

import type { LogFields, LogLevel } from "@/lib/log";

import {
  MAX_EVIDENCE_BYTES,
  createEvidenceUploadService,
  type EvidenceUploadStore,
} from "./evidence-upload";
import type { PartActionResult } from "./part-actions";

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const OTHER_HOUSEHOLD = "e0000000-0000-4000-8000-000000000001";
const STEP = "d3000000-0000-4000-8000-000000000001";
const OTHER_STEP = "e3000000-0000-4000-8000-000000000001";
const USER = { id: "d1000000-0000-4000-8000-000000000002" };
const NOW = new Date("2026-12-10T09:00:00Z");
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9]{13}-evidence\.(jpg|png|webp|pdf)$/;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0, 0, 0, 0]);
const PDF = new TextEncoder().encode("%PDF-1.7 hello");

class FakeStore implements EvidenceUploadStore {
  steps = new Map<string, string>([[STEP, HOUSEHOLD]]);
  objects = new Map<string, { bytes: Uint8Array; size: number; contentType: string }>();
  removed: string[] = [];
  tokens: string[] = [];

  async findStepHousehold(stepId: string) {
    return this.steps.get(stepId) ?? null;
  }
  async createUploadToken(objectPath: string) {
    this.tokens.push(objectPath);
    return "token-1";
  }
  async statObject(objectPath: string) {
    const o = this.objects.get(objectPath);
    return o ? { sizeBytes: o.size, contentType: o.contentType } : ("missing" as const);
  }
  async readObjectHead(objectPath: string, bytes: number) {
    return this.objects.get(objectPath)?.bytes.subarray(0, bytes) ?? null;
  }
  async removeObject(objectPath: string) {
    this.removed.push(objectPath);
    return this.objects.delete(objectPath) ? ("removed" as const) : ("absent" as const);
  }
}

function setup(recordResult?: PartActionResult) {
  const store = new FakeStore();
  const logs: { level: LogLevel; event: string; fields?: LogFields }[] = [];
  const recordEvidence = vi.fn(async () =>
    recordResult ?? ({ ok: true, outcome: "recorded", careChainId: "c", noteId: "n", approvalReset: false } as PartActionResult),
  );
  const service = createEvidenceUploadService({
    store,
    partActions: { recordEvidence },
    log: (level, event, fields) => logs.push({ level, event, fields }),
    now: () => NOW,
  });
  return { store, logs, recordEvidence, service };
}

describe("prepare", () => {
  it("builds {household}/{step}/{13-digit epoch}-evidence.ext and returns a token", async () => {
    const { service, store } = setup();
    const result = await service.prepare(USER, {
      stepId: STEP,
      kind: "file",
      contentType: "application/pdf",
      sizeBytes: 1000,
    });
    expect(result).toEqual({
      ok: true,
      objectPath: `${HOUSEHOLD}/${STEP}/${NOW.getTime()}-evidence.pdf`,
      token: "token-1",
    });
    expect(store.tokens[0]).toMatch(PATH_RE);
  });

  it("refuses unsupported types, PDFs as photos, empty and oversized files", async () => {
    const { service, store } = setup();
    const base = { stepId: STEP, kind: "photo", contentType: "image/png", sizeBytes: 10 };
    expect(await service.prepare(USER, { ...base, contentType: "image/gif" })).toMatchObject({
      ok: false,
      messageKey: "evidence.unsupportedType",
    });
    expect(
      await service.prepare(USER, { ...base, contentType: "application/pdf" }),
    ).toMatchObject({ ok: false, messageKey: "evidence.unsupportedType" });
    expect(await service.prepare(USER, { ...base, sizeBytes: 0 })).toMatchObject({
      messageKey: "evidence.empty",
    });
    expect(
      await service.prepare(USER, { ...base, sizeBytes: MAX_EVIDENCE_BYTES + 1 }),
    ).toMatchObject({ messageKey: "evidence.tooLarge" });
    expect(store.tokens).toHaveLength(0);
  });

  it("treats a Part of another household like a missing Part", async () => {
    const { service, store } = setup();
    store.steps.set(OTHER_STEP, OTHER_HOUSEHOLD);
    // The person's RLS client cannot see it, so the store returns null.
    store.steps.delete(OTHER_STEP);
    const result = await service.prepare(USER, {
      stepId: OTHER_STEP,
      kind: "photo",
      contentType: "image/png",
      sizeBytes: 10,
    });
    expect(result).toMatchObject({ ok: false, messageKey: "refusal.notFoundOrNoAccess" });
    expect(store.tokens).toHaveLength(0);
  });

  it("refuses a signed-out person", async () => {
    const { service } = setup();
    expect(await service.prepare(null, {})).toMatchObject({
      ok: false,
      messageKey: "refusal.signedOut",
    });
  });
});

describe("complete", () => {
  const goodPath = `${HOUSEHOLD}/${STEP}/${NOW.getTime()}-evidence.png`;

  it("records a photo after the object is verified", async () => {
    const { service, store, recordEvidence } = setup();
    store.objects.set(goodPath, { bytes: PNG, size: PNG.length, contentType: "image/png" });
    const result = await service.complete(USER, { stepId: STEP, label: "Receipt", objectPath: goodPath });
    expect(result.ok).toBe(true);
    expect(recordEvidence).toHaveBeenCalledWith(USER, {
      stepId: STEP,
      kind: "photo",
      label: "Receipt",
      storagePath: goodPath,
    });
  });

  it("records a PDF as kind file", async () => {
    const { service, store, recordEvidence } = setup();
    const path = `${HOUSEHOLD}/${STEP}/${NOW.getTime()}-evidence.pdf`;
    store.objects.set(path, { bytes: PDF, size: PDF.length, contentType: "application/pdf" });
    await service.complete(USER, { stepId: STEP, label: "Letter", objectPath: path });
    expect(recordEvidence).toHaveBeenCalledWith(USER, expect.objectContaining({ kind: "file" }));
  });

  it("refuses when the object is not in storage", async () => {
    const { service, recordEvidence } = setup();
    const result = await service.complete(USER, { stepId: STEP, label: "x", objectPath: goodPath });
    expect(result).toMatchObject({ ok: false, messageKey: "evidence.notUploaded" });
    expect(recordEvidence).not.toHaveBeenCalled();
  });

  it("refuses a path for another household or step", async () => {
    const { service, store, recordEvidence } = setup();
    for (const objectPath of [
      `${OTHER_HOUSEHOLD}/${STEP}/${NOW.getTime()}-evidence.png`,
      `${HOUSEHOLD}/${OTHER_STEP}/${NOW.getTime()}-evidence.png`,
      `${HOUSEHOLD}/${STEP}/123-evidence.png`,
      `${HOUSEHOLD}/${STEP}/${NOW.getTime()}-note.png`,
    ]) {
      store.objects.set(objectPath, { bytes: PNG, size: PNG.length, contentType: "image/png" });
      expect(await service.complete(USER, { stepId: STEP, label: "x", objectPath })).toMatchObject({
        ok: false,
        messageKey: "refusal.invalidInput",
      });
    }
    expect(recordEvidence).not.toHaveBeenCalled();
  });

  it("refuses and removes an object whose bytes do not match its type", async () => {
    const { service, store, recordEvidence } = setup();
    store.objects.set(goodPath, { bytes: PDF, size: PDF.length, contentType: "image/png" });
    const result = await service.complete(USER, { stepId: STEP, label: "x", objectPath: goodPath });
    expect(result).toMatchObject({ ok: false, messageKey: "evidence.contentMismatch" });
    expect(store.removed).toEqual([goodPath]);
    expect(recordEvidence).not.toHaveBeenCalled();
  });

  it("removes the object when the service refuses to record it", async () => {
    const refused: PartActionResult = {
      ok: false,
      code: "not_holder",
      messageKey: "refusal.notHolder",
      params: {},
    };
    const { service, store } = setup(refused);
    store.objects.set(goodPath, { bytes: PNG, size: PNG.length, contentType: "image/png" });
    const result = await service.complete(USER, { stepId: STEP, label: "x", objectPath: goodPath });
    expect(result).toMatchObject({ ok: false, messageKey: "refusal.notHolder" });
    expect(store.removed).toEqual([goodPath]);
  });

  it("never logs paths, labels, or tokens", async () => {
    const { service, store, logs } = setup();
    store.objects.set(goodPath, { bytes: PNG, size: PNG.length, contentType: "image/png" });
    await service.prepare(USER, { stepId: STEP, kind: "photo", contentType: "image/png", sizeBytes: 5 });
    await service.complete(USER, { stepId: STEP, label: "Secret insulin receipt", objectPath: goodPath });
    await service.complete(USER, { stepId: STEP, label: "Secret insulin receipt", objectPath: `${goodPath}x` });
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of ["insulin", "evidence.png", HOUSEHOLD, "token-1"]) {
      expect(text).not.toContain(secret);
    }
  });
});
