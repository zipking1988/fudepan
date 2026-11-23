import { beforeEach, describe, expect, it } from "vitest";

import type { HouseholdRole } from "@/lib/households/membership";
import type { LogFields, LogLevel } from "@/lib/log";

import { MAX_NOTE_BYTES, type NoteContentType } from "./rules";
import {
  createNoteUploadService,
  type NoteUploadStore,
  type RemoveResult,
  type Reservation,
} from "./upload-service";

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const OTHER_HOUSEHOLD = "e0000000-0000-4000-8000-000000000001";
const MISA = { id: "d1000000-0000-4000-8000-000000000002" };
const MOM = { id: "d1000000-0000-4000-8000-000000000001" };
const OUTSIDER = { id: "e1000000-0000-4000-8000-000000000001" };

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const PDF = new TextEncoder().encode("%PDF-1.7 not an image");

type Audit = {
  householdId: string;
  actorId: string | null;
  event: string;
  payload: Record<string, unknown>;
};

/**
 * In-memory store that mirrors the SQL functions' rules (status transitions,
 * membership checks, one note + one audit event per completion).
 */
class FakeStore implements NoteUploadStore {
  members = new Map<string, { role: HouseholdRole; active: boolean }>();
  reservations = new Map<string, Reservation & { sizeBytes: number }>();
  objects = new Map<string, { bytes: Uint8Array; size: number; contentType: string }>();
  notes = new Map<string, { householdId: string; imagePath: string; status: string }>();
  audits: Audit[] = [];
  breaks = new Set<"complete" | "remove" | "token" | "stat">();
  clock = new Date("2026-11-21T09:00:00Z");

  addMember(householdId: string, userId: string, role: HouseholdRole) {
    this.members.set(`${householdId}:${userId}`, { role, active: true });
  }
  private canUpload(householdId: string, userId: string) {
    const m = this.members.get(`${householdId}:${userId}`);
    return Boolean(m?.active);
  }

  async findMembership(userId: string, householdId: string) {
    const m = this.members.get(`${householdId}:${userId}`);
    return m?.active ? { role: m.role } : null;
  }
  async recordRejection(i: { householdId: string; userId: string; stage: string; reason: string }) {
    if (!this.members.get(`${i.householdId}:${i.userId}`)?.active) throw new Error("not_member");
    this.audits.push({
      householdId: i.householdId,
      actorId: i.userId,
      event: "note.upload_failed",
      payload: { stage: i.stage, reason: i.reason },
    });
  }
  async reserve(i: {
    noteId: string;
    householdId: string;
    userId: string;
    objectPath: string;
    contentType: NoteContentType;
    sizeBytes: number;
  }) {
    if (!this.canUpload(i.householdId, i.userId)) return "not_allowed" as const;
    const pending = [...this.reservations.values()].filter(
      (r) => r.uploadedBy === i.userId && r.status === "pending" && r.expiresAt > this.clock,
    );
    if (pending.length >= 5) return "too_many_pending" as const;
    this.reservations.set(i.noteId, {
      noteId: i.noteId,
      householdId: i.householdId,
      uploadedBy: i.userId,
      objectPath: i.objectPath,
      contentType: i.contentType,
      status: "pending",
      expiresAt: new Date(this.clock.getTime() + 3 * 3600_000),
      sizeBytes: i.sizeBytes,
    });
    return "ok" as const;
  }
  async createUploadToken(path: string) {
    return this.breaks.has("token") ? null : `token-for:${path}`;
  }
  async findReservation(noteId: string, userId: string) {
    const r = this.reservations.get(noteId);
    return r && r.uploadedBy === userId ? { ...r } : null;
  }
  async statObject(path: string) {
    if (this.breaks.has("stat")) return "error" as const;
    const o = this.objects.get(path);
    return o ? { sizeBytes: o.size, contentType: o.contentType } : ("missing" as const);
  }
  async readObjectHead(path: string, bytes: number) {
    return this.objects.get(path)?.bytes.slice(0, bytes) ?? null;
  }
  async complete(i: {
    noteId: string;
    userId: string;
    sizeBytes: number;
    contentType: NoteContentType;
  }) {
    const r = this.reservations.get(i.noteId);
    if (!r || r.uploadedBy !== i.userId) return "error" as const;
    if (r.status !== "pending") return "not_pending" as const;
    if (r.expiresAt <= this.clock) return "expired" as const;
    if (!this.canUpload(r.householdId, i.userId)) return "not_allowed" as const;
    if (this.breaks.has("complete")) return "error" as const;
    this.notes.set(r.noteId, {
      householdId: r.householdId,
      imagePath: r.objectPath,
      status: "uploaded",
    });
    this.audits.push({
      householdId: r.householdId,
      actorId: i.userId,
      event: "note.uploaded",
      payload: {
        note_id: r.noteId,
        content_type: r.contentType,
        size_bytes: i.sizeBytes,
        status: "uploaded",
      },
    });
    r.status = "completed";
    return "ok" as const;
  }
  async claimFailure(noteId: string, userId: string) {
    const r = this.reservations.get(noteId);
    if (!r || r.uploadedBy !== userId || r.status !== "pending") return false;
    r.status = "failing";
    return true;
  }
  async removeObject(path: string): Promise<RemoveResult> {
    if (this.breaks.has("remove")) return "error";
    return this.objects.delete(path) ? "removed" : "absent";
  }
  async recordFailure(i: {
    noteId: string;
    userId: string;
    stage: string;
    reason: string;
    objectRemoved: boolean;
  }) {
    const r = this.reservations.get(i.noteId);
    if (!r || r.status !== "failing") throw new Error("upload_not_failing");
    r.status = "failed";
    this.audits.push({
      householdId: r.householdId,
      actorId: i.userId,
      event: "note.upload_failed",
      payload: {
        note_id: r.noteId,
        stage: i.stage,
        reason: i.reason,
        object_removed: i.objectRemoved,
      },
    });
  }
  async listExpiredReservations(householdId: string, limit: number) {
    return [...this.reservations.values()]
      .filter(
        (r) =>
          r.householdId === householdId &&
          ["pending", "failing", "failed"].includes(r.status) &&
          r.expiresAt < this.clock,
      )
      .slice(0, limit)
      .map((r) => ({ noteId: r.noteId, objectPath: r.objectPath }));
  }
  async expireReservation(noteId: string, objectRemoved: boolean) {
    const r = this.reservations.get(noteId);
    if (!r) return;
    const previous = r.status;
    r.status = "expired";
    if (previous !== "failed" || objectRemoved) {
      this.audits.push({
        householdId: r.householdId,
        actorId: null,
        event: "note.upload_abandoned",
        payload: { note_id: noteId, previous_status: previous, object_removed: objectRemoved },
      });
    }
  }

  /** What the browser does with the token: put bytes at the reserved path. */
  upload(path: string, bytes: Uint8Array, contentType = "image/png", size = bytes.length) {
    this.objects.set(path, { bytes, size, contentType });
  }
}

let store: FakeStore;
let logs: { level: LogLevel; event: string; fields?: LogFields }[];
let ids: number;

function service() {
  return createNoteUploadService({
    store,
    log: (level, event, fields) => logs.push({ level, event, fields }),
    now: () => store.clock,
    newId: () => `a0000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
  });
}

const pngInput = (size = 2048) => ({
  householdId: HOUSEHOLD,
  contentType: "image/png",
  sizeBytes: size,
});

async function prepared(user = MISA, size = 2048) {
  const result = await service().prepare(user, pngInput(size));
  if (!result.ok) throw new Error(`prepare failed: ${result.error.code}`);
  return result;
}

beforeEach(() => {
  store = new FakeStore();
  store.addMember(HOUSEHOLD, MISA.id, "primary_caregiver");
  store.addMember(HOUSEHOLD, MOM.id, "care_recipient");
  store.addMember(OTHER_HOUSEHOLD, OUTSIDER.id, "primary_caregiver");
  logs = [];
  ids = 0;
});

describe("prepare", () => {
  it("rejects a signed-out request without touching any household", async () => {
    const result = await service().prepare(null, pngInput());
    expect(result).toMatchObject({ ok: false, error: { code: "signed_out" } });
    expect(store.reservations.size).toBe(0);
    expect(store.audits).toEqual([]);
    expect(logs).toContainEqual({
      level: "warn",
      event: "note_upload.signed_out",
      fields: { stage: "prepare" },
    });
  });

  it("rejects malformed input", async () => {
    for (const bad of [
      null,
      {},
      { ...pngInput(), householdId: "../x" },
      { ...pngInput(), sizeBytes: 1.5 },
    ]) {
      expect(await service().prepare(MISA, bad)).toMatchObject({
        ok: false,
        error: { code: "invalid_request" },
      });
    }
  });

  it("refuses another household and does not write into its audit trail", async () => {
    const result = await service().prepare(OUTSIDER, pngInput());
    expect(result).toMatchObject({ ok: false, error: { code: "not_member" } });
    expect(store.reservations.size).toBe(0);
    expect(store.audits).toEqual([]);
  });

  it("lets the care recipient prepare an upload", async () => {
    const result = await service().prepare(MOM, pngInput());
    expect(result.ok).toBe(true);
    expect(store.reservations.size).toBe(1);
    expect(store.audits.some((a) => a.event === "note.upload_failed")).toBe(false);
  });
  it("re-checks size and type on the server, and audits the rejection", async () => {
    const tooBig = await service().prepare(MISA, pngInput(MAX_NOTE_BYTES + 1));
    expect(tooBig).toMatchObject({ ok: false, error: { code: "too_large" } });
    if (!tooBig.ok) expect(tooBig.error.message).toContain("The limit is 10 MB");

    const pdf = await service().prepare(MISA, { ...pngInput(), contentType: "application/pdf" });
    expect(pdf).toMatchObject({ ok: false, error: { code: "unsupported_type" } });

    expect(store.audits.map((a) => a.payload)).toEqual([
      { stage: "validate", reason: "too_large" },
      { stage: "validate", reason: "unsupported_type" },
    ]);
    expect(store.reservations.size).toBe(0);
  });

  it("accepts exactly 10 MB", async () => {
    expect((await service().prepare(MISA, pngInput(MAX_NOTE_BYTES))).ok).toBe(true);
  });

  it("reserves a household-scoped path with a server-chosen file name", async () => {
    const result = await prepared();
    expect(result.objectPath).toBe(
      `${HOUSEHOLD}/${result.noteId}/${store.clock.getTime()}-note.png`,
    );
    expect(result.token).toBe(`token-for:${result.objectPath}`);
    expect(store.reservations.get(result.noteId)?.status).toBe("pending");
    expect(store.audits).toEqual([]);
  });

  it("limits unfinished uploads per person", async () => {
    for (let i = 0; i < 5; i++) await prepared();
    const sixth = await service().prepare(MISA, pngInput());
    expect(sixth).toMatchObject({ ok: false, error: { code: "too_many_pending" } });
    expect(store.audits.at(-1)?.payload).toEqual({ stage: "prepare", reason: "too_many_pending" });
  });

  it("releases the reservation if no upload token can be made", async () => {
    store.breaks.add("token");
    const result = await service().prepare(MISA, pngInput());
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
    const [reservation] = store.reservations.values();
    expect(reservation.status).toBe("failed");
    expect(store.audits.at(-1)).toMatchObject({
      event: "note.upload_failed",
      payload: { stage: "prepare", reason: "signed_url_failed", object_removed: false },
    });
  });
});

describe("complete", () => {
  it("saves the note as `uploaded` with one audit event", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG, "image/png", 2048);

    const result = await service().complete(MISA, { noteId });
    expect(result).toEqual({ ok: true, noteId });
    expect(store.notes.get(noteId)).toEqual({
      householdId: HOUSEHOLD,
      imagePath: objectPath,
      status: "uploaded",
    });
    expect(store.audits).toEqual([
      {
        householdId: HOUSEHOLD,
        actorId: MISA.id,
        event: "note.uploaded",
        payload: {
          note_id: noteId,
          content_type: "image/png",
          size_bytes: 2048,
          status: "uploaded",
        },
      },
    ]);
  });

  it("is safe to retry after success", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    await service().complete(MISA, { noteId });
    expect(await service().complete(MISA, { noteId })).toEqual({
      ok: true,
      noteId,
      alreadyCompleted: true,
    });
    expect(store.audits.filter((a) => a.event === "note.uploaded")).toHaveLength(1);
    expect(store.objects.has(objectPath)).toBe(true);
  });

  it("cannot complete someone else's upload", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    expect(await service().complete(OUTSIDER, { noteId })).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(store.reservations.get(noteId)?.status).toBe("pending");
    expect(store.objects.has(objectPath)).toBe(true);
  });

  it("rejects a signed-out request", async () => {
    const { noteId } = await prepared();
    expect(await service().complete(null, { noteId })).toMatchObject({
      ok: false,
      error: { code: "signed_out" },
    });
  });

  it("records a failure when nothing was uploaded", async () => {
    const { noteId } = await prepared();
    expect(await service().complete(MISA, { noteId })).toMatchObject({
      ok: false,
      error: { code: "upload_failed" },
    });
    expect(store.audits.at(-1)?.payload).toMatchObject({
      stage: "verify",
      reason: "object_missing",
      object_removed: false,
    });
  });

  it("removes a file whose bytes are not the declared image type", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PDF, "image/png");

    expect(await service().complete(MISA, { noteId })).toMatchObject({
      ok: false,
      error: { code: "verify_failed" },
    });
    expect(store.objects.has(objectPath)).toBe(false);
    expect(store.notes.size).toBe(0);
    expect(store.audits.at(-1)?.payload).toEqual({
      note_id: noteId,
      stage: "verify",
      reason: "content_mismatch",
      object_removed: true,
    });
  });

  it("removes a stored object that is too large or of another type", async () => {
    const big = await prepared();
    store.upload(big.objectPath, PNG, "image/png", MAX_NOTE_BYTES + 1);
    expect(await service().complete(MISA, { noteId: big.noteId })).toMatchObject({
      ok: false,
      error: { code: "verify_failed" },
    });
    expect(store.objects.has(big.objectPath)).toBe(false);

    const gif = await prepared();
    store.upload(gif.objectPath, PNG, "image/gif");
    expect((await service().complete(MISA, { noteId: gif.noteId })).ok).toBe(false);
    expect(store.objects.has(gif.objectPath)).toBe(false);
  });

  it("removes the stored image when saving the note fails (no orphaned files)", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    store.breaks.add("complete");

    expect(await service().complete(MISA, { noteId })).toMatchObject({
      ok: false,
      error: { code: "save_failed" },
    });
    expect(store.objects.has(objectPath)).toBe(false);
    expect(store.notes.size).toBe(0);
    expect(store.reservations.get(noteId)?.status).toBe("failed");
    expect(store.audits.at(-1)?.payload).toEqual({
      note_id: noteId,
      stage: "save",
      reason: "db_insert_failed",
      object_removed: true,
    });
  });

  it("defers cleanup to the expiry sweep when removal itself fails", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    store.breaks.add("complete");
    store.breaks.add("remove");

    await service().complete(MISA, { noteId });
    expect(store.objects.has(objectPath)).toBe(true);
    expect(store.audits.at(-1)?.payload).toMatchObject({
      reason: "db_insert_failed",
      object_removed: false,
    });
    expect(logs.some((l) => l.event === "note_upload.cleanup_deferred")).toBe(true);

    store.breaks.clear();
    store.clock = new Date(store.clock.getTime() + 4 * 3600_000);
    await service().sweepExpired(HOUSEHOLD);
    expect(store.objects.has(objectPath)).toBe(false);
    expect(store.reservations.get(noteId)?.status).toBe("expired");
    expect(store.audits.at(-1)).toMatchObject({
      actorId: null,
      event: "note.upload_abandoned",
      payload: { note_id: noteId, previous_status: "failed", object_removed: true },
    });
  });

  it("removes the image if the person lost upload rights before saving", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    store.members.set(`${HOUSEHOLD}:${MISA.id}`, { role: "primary_caregiver", active: false });

    expect(await service().complete(MISA, { noteId })).toMatchObject({
      ok: false,
      error: { code: "not_allowed" },
    });
    expect(store.objects.has(objectPath)).toBe(false);
    expect(store.notes.size).toBe(0);
  });

  it("refuses an expired reservation and cleans it up", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    store.clock = new Date(store.clock.getTime() + 4 * 3600_000);

    expect(await service().complete(MISA, { noteId })).toMatchObject({
      ok: false,
      error: { code: "expired" },
    });
    expect(store.objects.has(objectPath)).toBe(false);
    expect(store.notes.size).toBe(0);
  });

  it("does not fail the reservation for a temporary Storage error", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    store.breaks.add("stat");
    expect(await service().complete(MISA, { noteId })).toMatchObject({
      ok: false,
      error: { code: "unavailable" },
    });
    expect(store.reservations.get(noteId)?.status).toBe("pending");
  });
});

describe("reportFailure", () => {
  it("records a browser-side upload failure and removes any partial object", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    expect(await service().reportFailure(MISA, { noteId, reason: "network_error" })).toEqual({
      ok: true,
    });
    expect(store.objects.has(objectPath)).toBe(false);
    expect(store.audits.at(-1)?.payload).toEqual({
      note_id: noteId,
      stage: "upload",
      reason: "network_error",
      object_removed: true,
    });
  });

  it("never removes the image of a note that was already saved", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PNG);
    await service().complete(MISA, { noteId });
    expect(await service().reportFailure(MISA, { noteId, reason: "storage_rejected" })).toEqual({
      ok: true,
    });
    expect(store.objects.has(objectPath)).toBe(true);
    expect(store.reservations.get(noteId)?.status).toBe("completed");
  });

  it("only accepts known reasons, and only from the uploader", async () => {
    const { noteId } = await prepared();
    expect(await service().reportFailure(MISA, { noteId, reason: "Mom's insulin" })).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(
      await service().reportFailure(OUTSIDER, { noteId, reason: "network_error" }),
    ).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(store.reservations.get(noteId)?.status).toBe("pending");
  });
});

describe("abandoned uploads", () => {
  it("are removed and audited the next time someone in the household uploads", async () => {
    const abandoned = await prepared();
    store.upload(abandoned.objectPath, PNG);
    store.clock = new Date(store.clock.getTime() + 4 * 3600_000);

    await prepared();
    expect(store.objects.has(abandoned.objectPath)).toBe(false);
    expect(store.reservations.get(abandoned.noteId)?.status).toBe("expired");
    expect(store.audits).toContainEqual({
      householdId: HOUSEHOLD,
      actorId: null,
      event: "note.upload_abandoned",
      payload: { note_id: abandoned.noteId, previous_status: "pending", object_removed: true },
    });
  });

  it("are not touched before they expire", async () => {
    const recent = await prepared();
    store.upload(recent.objectPath, PNG);
    await prepared();
    expect(store.objects.has(recent.objectPath)).toBe(true);
    expect(store.reservations.get(recent.noteId)?.status).toBe("pending");
  });
});

describe("logging", () => {
  it("never logs paths, tokens, or file names", async () => {
    const { noteId, objectPath } = await prepared();
    store.upload(objectPath, PDF, "image/png");
    await service().complete(MISA, { noteId });
    await service().prepare(OUTSIDER, pngInput());

    const values = logs.flatMap((l) => Object.values(l.fields ?? {})).map(String);
    expect(values.length).toBeGreaterThan(0);
    for (const value of values) {
      expect(value).not.toContain("/");
      expect(value).not.toContain("note.png");
      expect(value).not.toContain("token");
    }
  });
});
