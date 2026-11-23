import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * completeNoteUpload and retryRecognition schedule recognition with after().
 * Only the edges are replaced: next/server `after`, the session, the upload
 * service/store, and the recognizer. All data is fake.
 */
const scheduled: (() => Promise<void>)[] = [];
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void scheduled.push(fn) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(() => ({})) }));
vi.mock("@/lib/notes/upload-store", () => ({ createSupabaseNoteUploadStore: vi.fn(() => ({})) }));
const completeMock = vi.fn();
vi.mock("@/lib/notes/upload-service", () => ({
  createNoteUploadService: () => ({ complete: completeMock, prepare: vi.fn(), reportFailure: vi.fn() }),
}));
const recognize = vi.fn(async () => ({ state: "ready" }));
vi.mock("@/lib/care/recognition", () => ({ createDefaultRecognizer: () => ({ recognize }) }));

import { getSession } from "@/lib/auth/session";
import { completeNoteUpload, retryRecognition } from "./actions";

const NOTE = "a1000000-0000-4000-8000-000000000001";
const USER = { id: "d1000000-0000-4000-8000-000000000002" };

function sessionWithNote(visible: boolean) {
  vi.mocked(getSession).mockResolvedValue({
    user: USER,
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: NOTE } : null }) }),
        }),
      }),
    },
  } as never);
}

async function drain() {
  for (const fn of scheduled.splice(0)) await fn();
}

beforeEach(() => {
  scheduled.length = 0;
  recognize.mockClear();
  completeMock.mockReset();
  sessionWithNote(true);
});

describe("completeNoteUpload", () => {
  it("schedules recognition exactly once with after()", async () => {
    completeMock.mockResolvedValue({ ok: true, noteId: NOTE });
    await completeNoteUpload({ noteId: NOTE });
    expect(scheduled).toHaveLength(1);
    expect(recognize).not.toHaveBeenCalled(); // runs after the response
    await drain();
    expect(recognize).toHaveBeenCalledExactlyOnceWith(NOTE, USER.id);
  });

  it("does not schedule again when the upload was already completed", async () => {
    completeMock.mockResolvedValue({ ok: true, noteId: NOTE, alreadyCompleted: true });
    await completeNoteUpload({ noteId: NOTE });
    await completeNoteUpload({ noteId: NOTE });
    expect(scheduled).toHaveLength(0);
  });

  it("does not schedule when completion fails", async () => {
    completeMock.mockResolvedValue({ ok: false, error: { code: "expired", message: "x" } });
    await completeNoteUpload({ noteId: NOTE });
    expect(scheduled).toHaveLength(0);
  });
});

describe("retryRecognition", () => {
  it("starts a retry for the same note as the signed-in person", async () => {
    expect(await retryRecognition(NOTE)).toEqual({ ok: true });
    await drain();
    expect(recognize).toHaveBeenCalledExactlyOnceWith(NOTE, USER.id);
  });

  it("is safe to call twice: each call only asks the idempotent start", async () => {
    await retryRecognition(NOTE);
    await retryRecognition(NOTE);
    await drain();
    expect(recognize.mock.calls).toEqual([
      [NOTE, USER.id],
      [NOTE, USER.id],
    ]);
  });

  it("refuses an invalid id and a note the person cannot see", async () => {
    expect(await retryRecognition("nope")).toMatchObject({ ok: false });
    sessionWithNote(false);
    expect(await retryRecognition(NOTE)).toMatchObject({ ok: false });
    expect(scheduled).toHaveLength(0);
  });

  it("refuses when signed out", async () => {
    vi.mocked(getSession).mockResolvedValue({ user: null, supabase: {} } as never);
    expect(await retryRecognition(NOTE)).toMatchObject({ ok: false });
    expect(scheduled).toHaveLength(0);
  });
});
