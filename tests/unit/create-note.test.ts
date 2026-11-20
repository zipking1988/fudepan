import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createImageNote, createTextNote, NoteServiceError } from "@/server/notes/create-note";
import { OcrError, type OcrAdapter } from "@/lib/ocr";

const ids = {
  userId: "11111111-1111-4111-8111-111111111111",
  householdId: "22222222-2222-4222-8222-222222222222",
  requestId: "req-1",
};
const image = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff]),
  mimeType: "image/jpeg" as const,
  sizeBytes: 3,
};

function fakeSupabase(
  opts: { uploadError?: boolean; insertError?: "notes" | "audit_events" } = {},
) {
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  const uploads: { path: string; contentType?: string }[] = [];
  const client = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return Promise.resolve({ error: opts.insertError === table ? { message: "x" } : null });
      },
    }),
    storage: {
      from: () => ({
        upload: (path: string, _b: unknown, o: { contentType?: string }) => {
          uploads.push({ path, contentType: o.contentType });
          return Promise.resolve({ error: opts.uploadError ? { message: "x" } : null });
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, inserts, uploads };
}

function ocr(impl: OcrAdapter["recognize"], supports = true): OcrAdapter {
  return { name: "fake", supports: () => supports, recognize: impl };
}

describe("createImageNote", () => {
  it("stores the image under the household folder, masks OCR text, and writes an audit event", async () => {
    const { client, inserts, uploads } = fakeSupabase();
    const adapter = ocr(async () => ({
      text: "Pay 4242 4242 4242 4242",
      confidence: 0.95,
      provider: "fake",
    }));
    const result = await createImageNote({ supabase: client, ...ids, image, ocr: adapter });

    expect(uploads[0]?.path).toMatch(new RegExp(`^${ids.householdId}/[0-9a-f-]{36}\\.jpg$`));
    const note = inserts.find((i) => i.table === "notes")!.row;
    expect(note.ocr_text).toBe("Pay [MASKED]");
    expect(note.image_path).toBe(uploads[0]?.path);
    expect(result).toMatchObject({
      ocrStatus: "done",
      lowConfidence: false,
      maskedKinds: ["card_number"],
    });

    const audit = inserts.find((i) => i.table === "audit_events")!.row;
    expect(audit).toMatchObject({
      event_type: "note_created",
      actor_id: ids.userId,
      note_id: note.id,
    });
    expect(JSON.stringify(audit.payload)).not.toContain("Pay");
  });

  it("flags low confidence", async () => {
    const { client } = fakeSupabase();
    const adapter = ocr(async () => ({ text: "milk", confidence: 0.5, provider: "fake" }));
    const result = await createImageNote({ supabase: client, ...ids, image, ocr: adapter });
    expect(result.lowConfidence).toBe(true);
  });

  it("still saves the note when OCR fails, with a friendly message", async () => {
    const { client, inserts } = fakeSupabase();
    const adapter = ocr(async () => {
      throw new OcrError("rate_limited", "internal detail");
    });
    const log = vi.fn();
    const result = await createImageNote({ supabase: client, ...ids, image, ocr: adapter, log });
    expect(result.ocrStatus).toBe("failed");
    expect(result.ocrMessage).toMatch(/busy/);
    expect(result.ocrMessage).not.toContain("internal detail");
    expect(inserts.find((i) => i.table === "notes")!.row.ocr_text).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error:rate_limited" }));
  });

  it("skips OCR for unsupported types and when no provider is configured", async () => {
    const recognize = vi.fn();
    const a = await createImageNote({
      supabase: fakeSupabase().client,
      ...ids,
      image,
      ocr: ocr(recognize, false),
    });
    expect(a.ocrStatus).toBe("skipped");
    expect(recognize).not.toHaveBeenCalled();
    const b = await createImageNote({ supabase: fakeSupabase().client, ...ids, image, ocr: null });
    expect(b.ocrMessage).toMatch(/not turned on/);
  });

  it("reports an empty OCR result as no_text", async () => {
    const adapter = ocr(async () => ({ text: "", confidence: null, provider: "fake" }));
    const result = await createImageNote({
      supabase: fakeSupabase().client,
      ...ids,
      image,
      ocr: adapter,
    });
    expect(result.ocrStatus).toBe("no_text");
    expect(result.lowConfidence).toBe(false);
  });

  it("throws storage_failed without saving a note when upload fails", async () => {
    const { client, inserts } = fakeSupabase({ uploadError: true });
    await expect(
      createImageNote({ supabase: client, ...ids, image, ocr: null }),
    ).rejects.toMatchObject({
      code: "storage_failed",
    });
    expect(inserts).toHaveLength(0);
  });

  it("throws database_failed when the note or audit insert fails", async () => {
    for (const table of ["notes", "audit_events"] as const) {
      const { client } = fakeSupabase({ insertError: table });
      await expect(
        createImageNote({ supabase: client, ...ids, image, ocr: null }),
      ).rejects.toBeInstanceOf(NoteServiceError);
    }
  });
});

describe("createTextNote", () => {
  it("masks sensitive values before saving and audits without the text", async () => {
    const { client, inserts } = fakeSupabase();
    const result = await createTextNote({
      supabase: client,
      ...ids,
      text: "Bank account number: 12345678, buy rice",
    });
    const note = inserts.find((i) => i.table === "notes")!.row;
    expect(note.text_content).toBe("Bank account number: [MASKED], buy rice");
    expect(note.source_type).toBe("text");
    expect(result.maskedKinds).toEqual(["bank_account"]);
    const audit = inserts.find((i) => i.table === "audit_events")!.row;
    expect(audit.event_type).toBe("note_created");
    expect(JSON.stringify(audit.payload)).not.toContain("12345678");
  });

  it("throws database_failed when saving fails", async () => {
    const { client } = fakeSupabase({ insertError: "notes" });
    await expect(createTextNote({ supabase: client, ...ids, text: "hi" })).rejects.toMatchObject({
      code: "database_failed",
    });
  });
});
