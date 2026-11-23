import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { LogFields } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

import { getNoteDetail, listHouseholdNotes, openNoteImage } from "./queries";
import { MAX_NOTE_BYTES, NOTES_BUCKET } from "./rules";
import { createNoteUploadService } from "./upload-service";
import { createSupabaseNoteUploadStore } from "./upload-store";

/**
 * End-to-end upload checks against real local Supabase services. Every
 * browser-side step uses a client signed in as that person with the public
 * key, exactly like the upload form; server steps use the real store.
 */

type Client = SupabaseClient<Database>;

const url = process.env.INTEGRATION_SUPABASE_URL ?? "";
const anonKey = process.env.INTEGRATION_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.INTEGRATION_SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !anonKey || !serviceKey) {
  throw new Error(
    "Set INTEGRATION_SUPABASE_URL, INTEGRATION_SUPABASE_ANON_KEY, and INTEGRATION_SUPABASE_SERVICE_ROLE_KEY (see vitest.integration.config.mts).",
  );
}
if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
  throw new Error(
    "Integration tests create users and households; they only run against a local stack.",
  );
}

const OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin: Client = createClient<Database>(url, serviceKey, OPTIONS);
const anon: Client = createClient<Database>(url, anonKey, OPTIONS);

const run = crypto.randomUUID().slice(0, 8);
const HOUSEHOLD_A = crypto.randomUUID();
const HOUSEHOLD_B = crypto.randomUUID();

// 1×1 PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n");

type Person = { id: string; client: Client; logs: { event: string; fields?: LogFields }[] };
const people: Record<"misa" | "mom" | "kenta" | "outsider", Person> = {} as never;

async function createPerson(name: string): Promise<Person> {
  const email = `p2-${run}-${name}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const client = createClient<Database>(url, anonKey, OPTIONS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, client, logs: [] };
}

function serviceFor(person: Person) {
  return createNoteUploadService({
    store: createSupabaseNoteUploadStore({ userClient: person.client, admin }),
    log: (_level, event, fields) => person.logs.push({ event, fields }),
  });
}

async function auditsFor(householdId: string) {
  const { data, error } = await admin
    .from("audit_events")
    .select("event_type, actor_type, actor_id, payload, created_at")
    .eq("household_id", householdId)
    .order("created_at");
  if (error) throw error;
  return data;
}

/** `exists()` throws for missing objects in this client version, so read metadata instead. */
async function objectExists(path: string): Promise<boolean> {
  const { data, error } = await admin.storage.from(NOTES_BUCKET).info(path);
  if (error && (error as { statusCode?: string }).statusCode === "404") return false;
  if (error) throw error;
  return Boolean(data);
}

/** Storage paths, generated file names, URLs, or tokens. (Content types like image/png are fine.) */
const UNSAFE_IN_PAYLOAD = /[0-9a-f-]{36}\/|-note\.|https?:|token/;

/** prepare → browser upload → complete, as the upload form does it. */
async function uploadAs(person: Person, bytes: Uint8Array, contentType = "image/png") {
  const prepared = await serviceFor(person).prepare(person, {
    householdId: HOUSEHOLD_A,
    contentType,
    sizeBytes: bytes.length,
  });
  if (!prepared.ok) throw new Error(`prepare failed: ${prepared.error.code}`);
  const { error } = await person.client.storage
    .from(NOTES_BUCKET)
    .uploadToSignedUrl(
      prepared.objectPath,
      prepared.token,
      new Blob([bytes as BlobPart], { type: contentType }),
      {
        contentType,
      },
    );
  if (error) throw new Error(`browser upload failed: ${error.message}`);
  return prepared;
}

beforeAll(async () => {
  people.misa = await createPerson("misa");
  people.mom = await createPerson("mom");
  people.kenta = await createPerson("kenta");
  people.outsider = await createPerson("outsider");

  const { error: hError } = await admin.from("households").insert([
    { id: HOUSEHOLD_A, name: `Test household A ${run}` },
    { id: HOUSEHOLD_B, name: `Test household B ${run}` },
  ]);
  if (hError) throw hError;
  const { error: mError } = await admin.from("household_members").insert([
    {
      household_id: HOUSEHOLD_A,
      user_id: people.misa.id,
      display_name: "Misa",
      role: "primary_caregiver",
    },
    {
      household_id: HOUSEHOLD_A,
      user_id: people.mom.id,
      display_name: "Mom",
      role: "care_recipient",
    },
    {
      household_id: HOUSEHOLD_A,
      user_id: people.kenta.id,
      display_name: "Kenta",
      role: "finance_coordinator",
    },
    {
      household_id: HOUSEHOLD_B,
      user_id: people.outsider.id,
      display_name: "Outsider",
      role: "primary_caregiver",
    },
  ]);
  if (mError) throw mError;
});

afterAll(async () => {
  for (const person of Object.values(people)) await person?.client.auth.signOut();
});

describe("successful upload", () => {
  let noteId = "";
  let objectPath = "";

  it("stores the image privately and saves the note as `uploaded`", async () => {
    const prepared = await uploadAs(people.misa, PNG);
    ({ noteId, objectPath } = prepared);
    expect(objectPath).toMatch(new RegExp(`^${HOUSEHOLD_A}/${noteId}/\\d{13}-note\\.png$`));

    const completed = await serviceFor(people.misa).complete(people.misa, { noteId });
    expect(completed).toEqual({ ok: true, noteId });

    const { data: note } = await people.misa.client
      .from("notes")
      .select("id, household_id, uploaded_by, image_path, status, original_text")
      .eq("id", noteId)
      .single();
    expect(note).toEqual({
      id: noteId,
      household_id: HOUSEHOLD_A,
      uploaded_by: people.misa.id,
      image_path: objectPath,
      status: "uploaded",
      original_text: null,
    });
    expect(await objectExists(objectPath)).toBe(true);
  });

  it("creates exactly one `note.uploaded` audit event with a safe payload", async () => {
    const events = (await auditsFor(HOUSEHOLD_A)).filter((e) => e.event_type === "note.uploaded");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actor_type: "human", actor_id: people.misa.id });
    expect(events[0].payload).toEqual({
      note_id: noteId,
      content_type: "image/png",
      size_bytes: PNG.length,
      status: "uploaded",
    });
    expect(JSON.stringify(events[0].payload)).not.toMatch(UNSAFE_IN_PAYLOAD);
  });

  it("lists the note with its uploader for household members", async () => {
    const notes = await listHouseholdNotes(people.misa.client, HOUSEHOLD_A);
    expect(notes).toContainEqual(
      expect.objectContaining({ id: noteId, status: "uploaded", uploaderName: "Misa" }),
    );

    // The care recipient can read (but not upload).
    const detail = await getNoteDetail(people.mom.client, noteId);
    expect(detail).toMatchObject({
      householdName: `Test household A ${run}`,
      uploaderName: "Misa",
    });
  });

  it("serves the original image to a member through the server only", async () => {
    const image = await openNoteImage({ userClient: people.mom.client, admin, noteId });
    expect(image?.contentType).toBe("image/png");
    const bytes = new Uint8Array(await new Response(image!.body).arrayBuffer());
    expect(bytes).toEqual(PNG);
  });

  it("is never public: there is no working public URL", async () => {
    const { data } = admin.storage.from(NOTES_BUCKET).getPublicUrl(objectPath);
    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(false);
    const { data: bucket } = await admin.storage.getBucket(NOTES_BUCKET);
    expect(bucket).toMatchObject({ public: false, file_size_limit: MAX_NOTE_BYTES });
  });
});

describe("invalid file type", () => {
  it("is refused before upload and audited", async () => {
    const result = await serviceFor(people.misa).prepare(people.misa, {
      householdId: HOUSEHOLD_A,
      contentType: "application/pdf",
      sizeBytes: PDF.length,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported_type" } });
    const last = (await auditsFor(HOUSEHOLD_A)).at(-1);
    expect(last).toMatchObject({
      event_type: "note.upload_failed",
      actor_id: people.misa.id,
      payload: { stage: "validate", reason: "unsupported_type" },
    });
  });

  it("is refused by the bucket even if the browser check is bypassed", async () => {
    const prepared = await serviceFor(people.misa).prepare(people.misa, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: PDF.length,
    });
    if (!prepared.ok) throw new Error(prepared.error.code);
    const { error } = await people.misa.client.storage
      .from(NOTES_BUCKET)
      .uploadToSignedUrl(prepared.objectPath, prepared.token, new Blob([PDF]), {
        contentType: "application/pdf",
      });
    expect(error).not.toBeNull();
    expect(await objectExists(prepared.objectPath)).toBe(false);

    await serviceFor(people.misa).reportFailure(people.misa, {
      noteId: prepared.noteId,
      reason: "storage_rejected",
    });
    const { data } = await admin
      .from("note_uploads")
      .select("status")
      .eq("note_id", prepared.noteId)
      .single();
    expect(data?.status).toBe("failed");
  });

  it("is removed when the bytes are not the image type they claim to be", async () => {
    const prepared = await uploadAs(people.misa, PDF, "image/png");
    expect(await objectExists(prepared.objectPath)).toBe(true);

    const result = await serviceFor(people.misa).complete(people.misa, { noteId: prepared.noteId });
    expect(result).toMatchObject({ ok: false, error: { code: "verify_failed" } });
    expect(await objectExists(prepared.objectPath)).toBe(false);

    const { data: note } = await admin
      .from("notes")
      .select("id")
      .eq("id", prepared.noteId)
      .maybeSingle();
    expect(note).toBeNull();
    const last = (await auditsFor(HOUSEHOLD_A)).at(-1);
    expect(last?.payload).toEqual({
      note_id: prepared.noteId,
      stage: "verify",
      reason: "content_mismatch",
      object_removed: true,
    });
  });
});

describe("oversized file", () => {
  it("is refused before upload and audited", async () => {
    const result = await serviceFor(people.misa).prepare(people.misa, {
      householdId: HOUSEHOLD_A,
      contentType: "image/jpeg",
      sizeBytes: MAX_NOTE_BYTES + 1,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "too_large" } });
    expect((await auditsFor(HOUSEHOLD_A)).at(-1)?.payload).toEqual({
      stage: "validate",
      reason: "too_large",
    });
  });

  it("is refused by the bucket even if a small size was declared", async () => {
    const prepared = await serviceFor(people.misa).prepare(people.misa, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: 1024,
    });
    if (!prepared.ok) throw new Error(prepared.error.code);
    const big = new Uint8Array(MAX_NOTE_BYTES + 1);
    big.set(PNG.subarray(0, 16));
    const { error } = await people.misa.client.storage
      .from(NOTES_BUCKET)
      .uploadToSignedUrl(
        prepared.objectPath,
        prepared.token,
        new Blob([big], { type: "image/png" }),
        {
          contentType: "image/png",
        },
      );
    expect(error).not.toBeNull();
    expect(await objectExists(prepared.objectPath)).toBe(false);
    await serviceFor(people.misa).reportFailure(people.misa, {
      noteId: prepared.noteId,
      reason: "storage_rejected",
    });
  });
});

describe("unauthenticated upload", () => {
  it("is refused by the server", async () => {
    const result = await serviceFor(people.misa).prepare(null, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "signed_out" } });
  });

  it("cannot write, sign, list, or read anything in the bucket directly", async () => {
    const path = `${HOUSEHOLD_A}/${crypto.randomUUID()}/1763700000000-note.png`;
    const bucket = anon.storage.from(NOTES_BUCKET);
    expect(
      (await bucket.upload(path, new Blob([PNG]), { contentType: "image/png" })).error,
    ).not.toBeNull();
    expect((await bucket.createSignedUploadUrl(path)).error).not.toBeNull();
    const listed = await bucket.list(HOUSEHOLD_A);
    expect(listed.data ?? []).toEqual([]);
    expect(await objectExists(path)).toBe(false);
  });

  it("cannot read notes or reservations", async () => {
    const notes = await anon.from("notes").select("id");
    expect(notes.error ?? notes.data?.length).toBeTruthy();
    const reservations = await anon.from("note_uploads").select("note_id");
    expect(reservations.error).not.toBeNull();
  });
});

describe("cross-household access", () => {
  let noteId = "";
  let objectPath = "";

  beforeAll(async () => {
    const prepared = await uploadAs(people.misa, PNG);
    ({ noteId, objectPath } = prepared);
    const done = await serviceFor(people.misa).complete(people.misa, { noteId });
    if (!done.ok) throw new Error(done.error.code);
  });

  it("cannot upload into another household, and leaves no trace in its audit trail", async () => {
    const before = (await auditsFor(HOUSEHOLD_A)).length;
    const result = await serviceFor(people.outsider).prepare(people.outsider, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_member" } });
    expect((await auditsFor(HOUSEHOLD_A)).length).toBe(before);
    expect(people.outsider.logs.at(-1)).toMatchObject({ event: "note_upload.not_member" });
  });

  it("cannot see, open, or stream another household's note", async () => {
    expect(await listHouseholdNotes(people.outsider.client, HOUSEHOLD_A)).toEqual([]);
    expect(await getNoteDetail(people.outsider.client, noteId)).toBeNull();
    expect(await openNoteImage({ userClient: people.outsider.client, admin, noteId })).toBeNull();
    const { data } = await people.outsider.client.from("notes").select("id").eq("id", noteId);
    expect(data).toEqual([]);
  });

  it("cannot list, download, sign, overwrite, or delete objects in another household's folder", async () => {
    const bucket = people.outsider.client.storage.from(NOTES_BUCKET);
    expect((await bucket.list(HOUSEHOLD_A)).data ?? []).toEqual([]);
    expect((await bucket.list(`${HOUSEHOLD_A}/${noteId}`)).data ?? []).toEqual([]);
    expect((await bucket.download(objectPath)).error).not.toBeNull();
    expect((await bucket.createSignedUrl(objectPath, 60)).error).not.toBeNull();
    expect(
      (await bucket.upload(objectPath, new Blob([PDF]), { contentType: "image/png", upsert: true }))
        .error,
    ).not.toBeNull();
    expect(
      (
        await bucket.upload(
          `${HOUSEHOLD_A}/${crypto.randomUUID()}/1763700000000-note.png`,
          new Blob([PNG]),
        )
      ).error,
    ).not.toBeNull();
    await bucket.remove([objectPath]);
    expect(await objectExists(objectPath)).toBe(true);
  });

  it("cannot finish, fail, or redirect another person's upload", async () => {
    const pending = await serviceFor(people.misa).prepare(people.misa, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    if (!pending.ok) throw new Error(pending.error.code);

    expect(
      await serviceFor(people.outsider).complete(people.outsider, { noteId: pending.noteId }),
    ).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
    expect(
      await serviceFor(people.outsider).reportFailure(people.outsider, {
        noteId: pending.noteId,
        reason: "network_error",
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } });

    // A token is bound to its one path.
    const elsewhere = `${HOUSEHOLD_B}/${crypto.randomUUID()}/1763700000000-note.png`;
    const { error } = await people.outsider.client.storage
      .from(NOTES_BUCKET)
      .uploadToSignedUrl(elsewhere, pending.token, new Blob([PNG]), { contentType: "image/png" });
    expect(error).not.toBeNull();
    expect(await objectExists(elsewhere)).toBe(false);

    const { data } = await admin
      .from("note_uploads")
      .select("status")
      .eq("note_id", pending.noteId)
      .single();
    expect(data?.status).toBe("pending");
  });

  it("cannot call the upload functions or read reservations directly", async () => {
    const { error: rpcError } = await people.outsider.client.rpc("complete_note_upload", {
      p_note_id: noteId,
      p_user_id: people.outsider.id,
      p_size_bytes: 10,
      p_content_type: "image/png",
    });
    expect(rpcError).not.toBeNull();
    const { error: readError } = await people.outsider.client
      .from("note_uploads")
      .select("note_id");
    expect(readError).not.toBeNull();
  });
});

describe("audit trail", () => {
  it("lets a care recipient prepare an upload", async () => {
    const result = await serviceFor(people.mom).prepare(people.mom, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    expect(result.ok).toBe(true);
  });
  it("removes the stored image and audits when saving the note fails", async () => {
    const prepared = await uploadAs(people.kenta, PNG);
    // Kenta leaves the household between uploading and saving: the database refuses the note.
    await admin
      .from("household_members")
      .update({ is_active: false })
      .eq("household_id", HOUSEHOLD_A)
      .eq("user_id", people.kenta.id);

    const result = await serviceFor(people.kenta).complete(people.kenta, {
      noteId: prepared.noteId,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_allowed" } });
    expect(await objectExists(prepared.objectPath)).toBe(false);
    const { data: note } = await admin
      .from("notes")
      .select("id")
      .eq("id", prepared.noteId)
      .maybeSingle();
    expect(note).toBeNull();
    expect((await auditsFor(HOUSEHOLD_A)).at(-1)).toMatchObject({
      event_type: "note.upload_failed",
      actor_id: people.kenta.id,
      payload: {
        note_id: prepared.noteId,
        stage: "save",
        reason: "role_not_allowed",
        object_removed: true,
      },
    });
  });

  it("cleans up and audits an abandoned upload once it expires", async () => {
    const abandoned = await uploadAs(people.misa, PNG);
    await admin
      .from("note_uploads")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("note_id", abandoned.noteId);

    // The next upload in the household sweeps it.
    await serviceFor(people.misa).prepare(people.misa, {
      householdId: HOUSEHOLD_A,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });

    expect(await objectExists(abandoned.objectPath)).toBe(false);
    const { data } = await admin
      .from("note_uploads")
      .select("status")
      .eq("note_id", abandoned.noteId)
      .single();
    expect(data?.status).toBe("expired");
    const event = (await auditsFor(HOUSEHOLD_A)).find(
      (e) =>
        e.event_type === "note.upload_abandoned" &&
        (e.payload as { note_id?: string }).note_id === abandoned.noteId,
    );
    expect(event).toMatchObject({
      actor_type: "system",
      actor_id: null,
      payload: { previous_status: "pending", object_removed: true },
    });
  });

  it("never stores file names, paths, or URLs in any upload audit payload", async () => {
    const events = await auditsFor(HOUSEHOLD_A);
    expect(events.length).toBeGreaterThan(5);
    for (const event of events) {
      const text = JSON.stringify(event.payload);
      expect(text).not.toMatch(UNSAFE_IN_PAYLOAD);
    }
  });
});
