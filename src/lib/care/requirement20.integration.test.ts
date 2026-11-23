import { deflateSync } from "node:zlib";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { careChainDraftSchema, normalizeCareChainDraft } from "@/lib/ai/schema";
import { approvalLabelKey, LABEL_TEXT_EN } from "@/lib/care/rules/labels";
import { en } from "@/lib/i18n/en";
import { createTranslator } from "@/lib/i18n/messages";
import { getFamilyFeed } from "@/lib/family/feed";
import { recipientSentences, sentencesForPart } from "@/lib/family/recipient-sentences";
import type { LogFields } from "@/lib/log";
import { NOTES_BUCKET } from "@/lib/notes/rules";
import { createNoteUploadService } from "@/lib/notes/upload-service";
import { createSupabaseNoteUploadStore } from "@/lib/notes/upload-store";
import type { Database } from "@/lib/supabase/database.types";

import { createSupabasePartActionStore, createPartActionService } from "./part-actions";
import { getSharedCareEvent } from "./queries";
import {
  createRecognizer,
  createServiceNoteImageReader,
  createSupabaseRecognitionStore,
} from "./recognition";
import { getEventTimeline, type TimelineEntry } from "./timeline";

/**
 * Requirement 20 (family-shared-care): one family scenario against the local Supabase stack.
 *
 *   Grandma photographs a note and closes the page -> a family member sees "Being read" ->
 *   recognition finishes (fake ai& output, ai& is never called) -> Ken claims the High_Risk_Part
 *   but cannot approve it -> Ken asks Mia to take over, Ken stays Owner -> Mia accepts ->
 *   Misa (Primary_Caregiver, not the Owner) approves -> Mia adds the Evidence and completes it.
 *
 * Writes go through the real services and the real SQL functions with the service role. Reads
 * go through each person's signed-in (RLS) client. Everything the test creates is deleted in
 * afterAll, including its audit events (the service role may delete them; client roles may not).
 * Everything lives under one throwaway household with a unique name and unique e-mail addresses;
 * no existing data is touched.
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
  throw new Error("This test creates users and households; it only runs against a local stack.");
}

const OPTIONS = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};
const admin: Client = createClient<Database>(url, serviceKey, OPTIONS);

const run = crypto.randomUUID().slice(0, 8);
const HOUSEHOLD = crypto.randomUUID();
const OTHER_HOUSEHOLD = crypto.randomUUID();
const HOUSEHOLD_NAME = `Req20 test household ${run}`;

/** A small valid PNG, generated here: 8x8, solid colour. */
function makePng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Uint8Array) => {
    let c = 0xffffffff;
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array(4 + data.length);
    body.set(new TextEncoder().encode(type));
    body.set(data, 4);
    const out = new Uint8Array(8 + data.length + 4);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc(body));
    return out;
  };
  const size = 8;
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, size);
  hv.setUint32(4, size);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = new Uint8Array(1 + size * 3);
  for (let i = 0; i < size; i++) row.set([250, 240, 200], 1 + i * 3);
  const raw = new Uint8Array(row.length * size);
  for (let y = 0; y < size; y++) raw.set(row, y * row.length);
  const parts = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const PNG = makePng();

/** The fake ai& output: the QA note. Appointment time is deliberately not stated. */
const FAKE_AIAND_DRAFT = {
  chain_title: "Clinic visit",
  overall_risk: "high" as const,
  steps: [
    {
      title: "Attend clinic visit",
      description: "Clinic name not stated.",
      care_category: "appointment" as const,
      risk_level: "high" as const,
      suggested_owner_role: "a family member who drives",
      evidence_required: ["Visit note"],
      approval_required: true,
      source_quote: "Clinic visit next Friday",
      confidence: 0.8,
    },
    {
      title: "Ask Misa which clinic",
      care_category: "communication" as const,
      risk_level: "low" as const,
      person_to_ask: "Misa",
      approval_required: false,
      source_quote: "Ask Misa which clinic",
      confidence: 0.9,
    },
    {
      title: "Bring insurance card",
      care_category: "document" as const,
      risk_level: "medium" as const,
      approval_required: true,
      source_quote: "Bring insurance card",
      confidence: 0.9,
    },
    {
      title: "Pick up glasses",
      care_category: "household" as const,
      risk_level: "low" as const,
      approval_required: false,
      source_quote: "Pick up glasses",
      confidence: 0.9,
    },
  ],
  ambiguities: [
    {
      field: "location",
      question: "Which clinic?",
      reason: "The note does not name the clinic.",
      step_index: 0,
      kind: "location" as const,
    },
  ],
};

type Person = {
  id: string;
  memberId: string;
  name: string;
  client: Client;
  email: string;
  logs: { event: string; fields?: LogFields }[];
};
const people = {} as Record<"grandma" | "misa" | "ken" | "mia" | "outsider", Person>;
const createdUserIds: string[] = [];
let noteId = "";
let objectPath = "";
let chainId = "";
let clinicStepId = "";
let handoverRequestId = "";

async function createPerson(key: string, name: string): Promise<Omit<Person, "memberId">> {
  const email = `req20-${run}-${key}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  const client = createClient<Database>(url, anonKey, OPTIONS);
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`signIn failed: ${signInError.message}`);
  return { id: data.user.id, name, client, email, logs: [] };
}

const serverLogs: { event: string; fields?: LogFields }[] = [];
const log = (_level: string, event: string, fields?: LogFields) => {
  serverLogs.push({ event, fields });
};
const partActions = createPartActionService({ store: createSupabasePartActionStore(admin, log), log });

type AuditRow = {
  id: string;
  event_type: string;
  actor_type: string;
  actor_id: string | null;
  payload: unknown;
  created_at: string;
};

/** Every audit event of the household, oldest first (service role). */
async function allAudits(): Promise<AuditRow[]> {
  const { data, error } = await admin
    .from("audit_events")
    .select("id, event_type, actor_type, actor_id, payload, created_at")
    .eq("household_id", HOUSEHOLD)
    .order("created_at")
    .order("id");
  if (error) throw error;
  return data;
}

/** Runs one action and returns the audit events it wrote, reminders split out. */
async function observe<T>(action: () => Promise<T>) {
  const before = new Set((await allAudits()).map((e) => e.id));
  const result = await action();
  const fresh = (await allAudits()).filter((e) => !before.has(e.id));
  return {
    result,
    primary: fresh.filter((e) => e.event_type !== "reminder.sent"),
    reminders: fresh.filter((e) => e.event_type === "reminder.sent"),
  };
}

async function partState(stepId: string) {
  const { data, error } = await admin
    .from("care_steps")
    .select("owner_id, approval_state, status, plan_version")
    .eq("id", stepId)
    .single();
  if (error) throw error;
  return data;
}

const tr = createTranslator("en");
const label = (key: string) => en[key as keyof typeof en];

async function clinicLabel(client: Client): Promise<string | null> {
  const event = await getSharedCareEvent(client, noteId);
  const part = event?.parts.find((p) => p.id === clinicStepId);
  if (!part) throw new Error("clinic part not visible");
  const key = approvalLabelKey({ progressStatus: part.progressStatus, approvalState: part.approvalState });
  return key ? LABEL_TEXT_EN[key] : null;
}

async function clinicSentences(client: Client): Promise<string[]> {
  const event = await getSharedCareEvent(client, noteId);
  const part = event?.parts.find((p) => p.id === clinicStepId);
  if (!part) throw new Error("clinic part not visible");
  return sentencesForPart(part).map((s) => tr.t(s.key, s.params));
}

async function deleteWhere(table: string, column: string, value: string | string[]) {
  const query = admin.from(table as "notes").delete();
  const { error } = Array.isArray(value) ? await query.in(column, value) : await query.eq(column, value);
  if (error) throw new Error(`cleanup of ${table} failed: ${error.message}`);
}

beforeAll(async () => {
  Object.assign(people, {
    grandma: await createPerson("grandma", "Grandma"),
    misa: await createPerson("misa", "Misa"),
    ken: await createPerson("ken", "Ken"),
    mia: await createPerson("mia", "Mia"),
    outsider: await createPerson("outsider", "Olive"),
  });

  const { error: hError } = await admin.from("households").insert([
    { id: HOUSEHOLD, name: HOUSEHOLD_NAME },
    { id: OTHER_HOUSEHOLD, name: `Req20 other household ${run}` },
  ]);
  if (hError) throw hError;
  const roles: Record<keyof typeof people, [string, string]> = {
    grandma: [HOUSEHOLD, "care_recipient"],
    misa: [HOUSEHOLD, "primary_caregiver"],
    ken: [HOUSEHOLD, "family_member"],
    mia: [HOUSEHOLD, "family_member"],
    outsider: [OTHER_HOUSEHOLD, "primary_caregiver"],
  };
  const { error: mError } = await admin.from("household_members").insert(
    (Object.keys(roles) as (keyof typeof people)[]).map((key) => ({
      household_id: roles[key][0],
      user_id: people[key].id,
      display_name: people[key].name,
      role: roles[key][1],
    })),
  );
  if (mError) throw mError;
  const { data: members, error: readError } = await admin
    .from("household_members")
    .select("id, user_id")
    .in("household_id", [HOUSEHOLD, OTHER_HOUSEHOLD]);
  if (readError) throw readError;
  for (const person of Object.values(people)) {
    person.memberId = members.find((m) => m.user_id === person.id)!.id;
  }
});

afterAll(async () => {
  for (const person of Object.values(people)) await person?.client.auth.signOut();
  const households = [HOUSEHOLD, OTHER_HOUSEHOLD];

  // FK-safe order. care_steps.audit_event_id and audit_events.care_step_id point at each other.
  for (const table of [
    "feed_items",
    "member_feed_state",
    "step_escalations",
    "part_evidence",
    "part_resubmissions",
    "part_missing_details",
    "care_requests",
    "recognition_runs",
    "household_sweeps",
  ]) {
    await deleteWhere(table, "household_id", households);
  }
  const { data: chains } = await admin.from("care_chains").select("id").in("household_id", households);
  const chainIds = (chains ?? []).map((c) => c.id);
  if (chainIds.length > 0) {
    const { error } = await admin
      .from("care_steps")
      .update({ audit_event_id: null })
      .in("care_chain_id", chainIds);
    if (error) throw new Error(`cleanup of care_steps links failed: ${error.message}`);
  }
  await deleteWhere("audit_events", "household_id", households);
  if (chainIds.length > 0) await deleteWhere("care_steps", "care_chain_id", chainIds);
  await deleteWhere("care_chains", "household_id", households);
  await deleteWhere("note_uploads", "household_id", households);
  await deleteWhere("notes", "household_id", households);
  await deleteWhere("household_members", "household_id", households);
  await deleteWhere("households", "id", households);
  if (objectPath) await admin.storage.from(NOTES_BUCKET).remove([objectPath]);
  for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
});

describe("Requirement 20: the shared family scenario", () => {
  it("20.1 Grandma's photo is stored and the page can close before reading starts", async () => {
    const grandma = people.grandma;
    const service = createNoteUploadService({
      store: createSupabaseNoteUploadStore({ userClient: grandma.client, admin }),
      log: (_l, event, fields) => grandma.logs.push({ event, fields }),
    });
    const prepared = await service.prepare(grandma, {
      householdId: HOUSEHOLD,
      contentType: "image/png",
      sizeBytes: PNG.length,
    });
    if (!prepared.ok) throw new Error(`prepare failed: ${prepared.error.code}`);
    ({ noteId, objectPath } = prepared);
    const { error } = await grandma.client.storage
      .from(NOTES_BUCKET)
      .uploadToSignedUrl(prepared.objectPath, prepared.token, new Blob([PNG as BlobPart], { type: "image/png" }), {
        contentType: "image/png",
      });
    expect(error).toBeNull();

    // The upload action returns here. Recognition runs later in `after()`, which has not run yet.
    expect(await service.complete(grandma, { noteId })).toEqual({ ok: true, noteId });

    const { data: note } = await admin.from("notes").select("status, image_path").eq("id", noteId).single();
    expect(note).toEqual({ status: "uploaded", image_path: objectPath });
    const audits = await allAudits();
    expect(audits.map((e) => e.event_type)).toContain("note.uploaded");
    expect(audits.map((e) => e.event_type)).not.toContain("extraction_started");
    const { count } = await admin
      .from("care_chains")
      .select("id", { count: "exact", head: true })
      .eq("note_id", noteId);
    expect(count).toBe(0);
  });

  it("20.2 Ken sees the same event in the feed as 'Being read'", async () => {
    const feed = await getFamilyFeed(people.ken.client, HOUSEHOLD, people.ken.memberId);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({
      noteId,
      state: "reading",
      title: null,
      titleKey: "feed.heading.beingRead",
      chainId: null,
    });
    expect(label(feed.events[0].titleKey!)).toBe("Being read");
    expect(feed.events[0].unseen).toBe(true);

    // Grandma's own Recipient_View says the same in plain words.
    const event = await getSharedCareEvent(people.grandma.client, noteId);
    expect(event?.state).toBe("uploaded");
    const own = await getFamilyFeed(people.grandma.client, HOUSEHOLD, people.grandma.memberId);
    expect(own.events[0]).toMatchObject({ noteId, state: "reading" });
  });

  it("20.1 recognition finishes with fake ai& output and records started and succeeded", async () => {
    let extractCalls = 0;
    const recognizer = createRecognizer({
      store: createSupabaseRecognitionStore(admin),
      readNoteImage: createServiceNoteImageReader(admin),
      extract: async (bytes, contentType) => {
        extractCalls += 1;
        // The private photo was read back from storage, unchanged.
        expect(contentType).toBe("image/png");
        expect(Uint8Array.from(bytes)).toEqual(PNG);
        return { ok: true, draft: normalizeCareChainDraft(careChainDraftSchema.parse(FAKE_AIAND_DRAFT)) };
      },
      log,
      now: () => new Date(),
    });
    const outcome = await recognizer.recognize(noteId, people.grandma.id);
    expect(outcome).toMatchObject({ state: "ready" });
    expect(extractCalls).toBe(1);
    if (outcome.state === "ready") chainId = outcome.careChainId!;

    // A second call never calls ai& again.
    expect(await recognizer.recognize(noteId, people.grandma.id)).toMatchObject({ state: "done" });
    expect(extractCalls).toBe(1);

    const { data: steps } = await admin
      .from("care_steps")
      .select("id, title, owner_id, approval_state, status")
      .eq("care_chain_id", chainId);
    expect(steps?.map((s) => s.title).sort()).toEqual([
      "Ask Misa which clinic",
      "Attend clinic visit",
      "Bring insurance card",
      "Pick up glasses",
    ]);
    expect(steps?.every((s) => s.owner_id === null)).toBe(true);
    const clinic = steps!.find((s) => s.title === "Attend clinic visit")!;
    expect(clinic).toMatchObject({ approval_state: "pending", status: "pending_review" });
    clinicStepId = clinic.id;
  });

  it("20.2 the feed now shows the ready event with its title and 'Needs someone'", async () => {
    const feed = await getFamilyFeed(people.ken.client, HOUSEHOLD, people.ken.memberId);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({
      noteId,
      chainId,
      state: "ready",
      title: "Clinic visit",
      titleKey: null,
      needsSomeone: true,
    });
    expect(feed.events[0].counts).toMatchObject({ parts: 4, done: 0 });
    expect(await clinicLabel(people.ken.client)).toBe("Requires confirmation");
  });

  it("20.3 Ken (not a Primary_Caregiver) claims the High_Risk_Part; approval stays pending", async () => {
    const { result, primary } = await observe(() =>
      partActions.claim({ id: people.ken.id }, { stepId: clinicStepId, role: "owner" }),
    );
    expect(result).toMatchObject({ ok: true, outcome: "claimed", approvalReset: false });
    expect(primary.map((e) => e.event_type)).toEqual(["part.claimed"]);
    expect(primary[0]).toMatchObject({ actor_type: "human", actor_id: people.ken.id });
    expect(await partState(clinicStepId)).toMatchObject({
      owner_id: people.ken.memberId,
      approval_state: "pending",
      status: "in_progress",
    });
    expect(await clinicLabel(people.mia.client)).toBe("Requires confirmation");
    expect(await clinicSentences(people.grandma.client)).toEqual([
      "No one is going with you yet.",
      "Ken is taking care of this.",
      "The time is not confirmed yet.",
      "Your family is checking this.",
      "Your family still needs to find out: which clinic.",
      "Your family still needs to find out: by when it must be done.",
    ]);
  });

  it("20.4 Ken cannot approve; the refusal writes no event and changes nothing", async () => {
    const before = await partState(clinicStepId);
    const { result, primary, reminders } = await observe(() =>
      partActions.decideApproval({ id: people.ken.id }, { stepId: clinicStepId, decision: "approve" }),
    );
    expect(result).toMatchObject({ ok: false, code: "not_primary_caregiver" });
    expect(primary).toEqual([]);
    expect(reminders).toEqual([]);
    expect(await partState(clinicStepId)).toEqual(before);
    expect((await allAudits()).some((e) => e.event_type.startsWith("approval."))).toBe(false);
  });

  it("20.5 Ken asks Mia to take over; Ken stays Owner", async () => {
    const { result, primary, reminders } = await observe(() =>
      partActions.requestHandover(
        { id: people.ken.id },
        { stepId: clinicStepId, role: "owner", toMemberId: people.mia.memberId },
      ),
    );
    expect(result).toMatchObject({ ok: true });
    expect(primary.map((e) => e.event_type)).toEqual(["handover.requested"]);
    expect(primary[0]).toMatchObject({ actor_type: "human", actor_id: people.ken.id });
    // In-app reminder to the receiver only.
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(await partState(clinicStepId)).toMatchObject({
      owner_id: people.ken.memberId,
      approval_state: "pending",
    });
    const requestId = (result as { requestId?: string }).requestId;
    expect(requestId).toBeTruthy();
    const event = await getSharedCareEvent(people.mia.client, noteId);
    const part = event!.parts.find((p) => p.id === clinicStepId)!;
    expect(part.owner?.name).toBe("Ken");
    expect(part.pendingRequests.map((r) => [r.kind, r.from.name, r.to.name])).toEqual([
      ["handover", "Ken", "Mia"],
    ]);
    handoverRequestId = requestId!;
  });

  it("20.6 Mia accepts; Mia is Owner and approval stays pending (nothing to reset)", async () => {
    const { result, primary } = await observe(() =>
      partActions.respond({ id: people.mia.id }, { requestId: handoverRequestId, accept: true }),
    );
    expect(result).toMatchObject({ ok: true, outcome: "accepted", approvalReset: false });
    expect(primary.map((e) => e.event_type)).toEqual(["handover.accepted"]);
    expect(primary[0]).toMatchObject({ actor_id: people.mia.id });
    expect(await partState(clinicStepId)).toMatchObject({
      owner_id: people.mia.memberId,
      approval_state: "pending",
    });
    expect((await allAudits()).some((e) => e.event_type === "approval.reset")).toBe(false);
    expect(await clinicLabel(people.ken.client)).toBe("Requires confirmation");
  });

  it("the care recipient and another household cannot act on the Part", async () => {
    const before = await partState(clinicStepId);
    const auditCount = (await allAudits()).length;
    const grandma = { id: people.grandma.id };
    expect(await partActions.claim(grandma, { stepId: clinicStepId, role: "driver" })).toMatchObject({
      ok: false,
      code: "recipient_read_only",
    });
    expect(await partActions.decideApproval(grandma, { stepId: clinicStepId, decision: "approve" })).toMatchObject({
      ok: false,
      code: "recipient_read_only",
    });
    expect(await partActions.complete(grandma, { stepId: clinicStepId })).toMatchObject({
      ok: false,
      code: "recipient_read_only",
    });
    const outsider = { id: people.outsider.id };
    expect(await partActions.claim(outsider, { stepId: clinicStepId, role: "owner" })).toMatchObject({
      ok: false,
      code: "part_not_found",
    });
    expect(await partActions.complete({ id: people.ken.id }, { stepId: clinicStepId })).toMatchObject({
      ok: false,
      code: "not_owner",
    });
    expect(await partState(clinicStepId)).toEqual(before);
    expect((await allAudits()).length).toBe(auditCount);

    // Browser roles cannot call the SQL functions or write the rows.
    const { error: rpcError } = await people.ken.client.rpc("complete_part", {
      p_step_id: clinicStepId,
      p_user_id: people.mia.id,
    });
    expect(rpcError).not.toBeNull();
    await people.grandma.client.from("care_steps").update({ owner_id: people.grandma.memberId }).eq("id", clinicStepId);
    expect(await partState(clinicStepId)).toEqual(before);
  });

  it("20.7 Misa (Primary_Caregiver, not the Owner) approves; the label becomes Confirmed", async () => {
    const { result, primary } = await observe(() =>
      partActions.decideApproval({ id: people.misa.id }, { stepId: clinicStepId, decision: "approve" }),
    );
    expect(result).toMatchObject({ ok: true, outcome: "approved", approvalState: "approved", selfApproval: false });
    expect(primary.map((e) => e.event_type)).toEqual(["approval.given"]);
    expect(primary[0]).toMatchObject({ actor_id: people.misa.id, payload: { self_approval: false } });
    expect(await partState(clinicStepId)).toMatchObject({
      owner_id: people.mia.memberId,
      approval_state: "approved",
    });
    expect(await clinicLabel(people.ken.client)).toBe("Confirmed");
    expect(await clinicSentences(people.grandma.client)).not.toContain("Your family is checking this.");
  });

  it("20.8 Mia attaches the required Evidence and completes the Part; the label becomes Done", async () => {
    const evidence = await observe(() =>
      partActions.recordEvidence(
        { id: people.mia.id },
        { stepId: clinicStepId, kind: "text", label: "Visit note", text: "Seen by the doctor today" },
      ),
    );
    expect(evidence.result).toMatchObject({ ok: true });
    expect(evidence.primary.map((e) => e.event_type)).toEqual(["evidence.uploaded"]);

    const done = await observe(() => partActions.complete({ id: people.mia.id }, { stepId: clinicStepId }));
    expect(done.result).toMatchObject({ ok: true, outcome: "completed" });
    expect(done.primary.map((e) => e.event_type)).toEqual(["part.completed"]);
    expect(await partState(clinicStepId)).toMatchObject({ status: "completed", approval_state: "approved" });
    expect(await clinicLabel(people.misa.client)).toBe("Done");

    // Recipient_View: the finished Part gives no sentences; the rest of the note still does.
    expect(await clinicSentences(people.grandma.client)).toEqual([]);
    const event = await getSharedCareEvent(people.grandma.client, noteId);
    expect(event?.done).toBe(false);
    const sentences = recipientSentences(event!).map((s) => tr.t(s.key, s.params));
    expect(sentences).not.toContain("Ken is taking care of this.");
    expect(sentences).not.toContain("Mia is taking care of this.");
    expect(sentences).toContain("Your family is checking this.");
  });

  it("20.9 and 20.10 the Timeline lists every step in order, early events included", async () => {
    const timeline = await getEventTimeline(people.misa.client, noteId);
    const summarize = (entries: TimelineEntry[]) =>
      entries.map((e) => [e.type, e.actorType, e.actorName, label(e.labelKey)]);
    const primary = timeline.filter((e) => e.type !== "reminder.sent");

    // Printed so a reader can see the scenario end to end.
    console.log(
      "Requirement 20 Timeline:\n" +
        timeline
          .map((e, i) => `${String(i + 1).padStart(2)}. ${e.type.padEnd(22)} ${(e.actorName ?? e.actorType).padEnd(8)} ${label(e.labelKey)}`)
          .join("\n"),
    );

    expect(summarize(primary)).toEqual([
      ["note.uploaded", "human", "Grandma", "Note uploaded"],
      ["extraction_started", "human", "Grandma", "Fudepan started reading the note"],
      ["extraction_succeeded", "ai", null, "Fudepan finished reading the note"],
      ["part.claimed", "human", "Ken", "Someone took this part"],
      ["handover.requested", "human", "Ken", "A handover was requested"],
      ["handover.accepted", "human", "Mia", "The handover was accepted"],
      ["approval.given", "human", "Misa", "Confirmed by a household member"],
      ["evidence.uploaded", "human", "Mia", "Proof was added"],
      ["part.completed", "human", "Mia", "This part was marked done"],
    ]);
    for (const e of timeline.filter((x) => x.type === "reminder.sent")) {
      expect(e).toMatchObject({ actorType: "system", actorName: null });
    }
    // Oldest first, and nothing is listed twice.
    const times = timeline.map((e) => Date.parse(e.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(timeline.map((e) => e.id)).size).toBe(timeline.length);
    // The refused approval left no trace.
    expect(timeline.filter((e) => e.type.startsWith("approval."))).toHaveLength(1);
    expect(timeline.some((e) => e.type === "approval.reset")).toBe(false);

    // Same list for every member of the household, including the care recipient.
    for (const key of ["grandma", "ken", "mia"] as const) {
      const seen = await getEventTimeline(people[key].client, noteId);
      expect(seen.map((e) => e.id)).toEqual(timeline.map((e) => e.id));
    }
  });

  it("every audit payload holds ids, codes, counts, and times only", async () => {
    const audits = await allAudits();
    const forbidden = [
      "Attend clinic",
      "Ask Misa",
      "insurance",
      "glasses",
      "Which clinic",
      "Clinic visit",
      "Seen by the doctor",
      "Grandma",
      "Ken",
      "Mia",
      "Visit note",
      "@example.com",
      "-note.png",
      "token",
    ];
    for (const event of audits) {
      const text = JSON.stringify(event.payload);
      for (const word of forbidden) expect(text, `${event.event_type} payload`).not.toContain(word);
      const strings: string[] = [];
      const walk = (value: unknown) => {
        if (typeof value === "string") strings.push(value);
        else if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") Object.values(value).forEach(walk);
      };
      walk(event.payload);
      for (const s of strings) {
        expect(s, `${event.event_type} payload value`).toMatch(
          /^([a-z0-9_.:/-]{1,40}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d{4}-\d{2}-\d{2}T[\d:.+Z-]+)$/i,
        );
      }
    }
    // Exactly one note.uploaded, one extraction_started, one extraction_succeeded.
    for (const type of ["note.uploaded", "extraction_started", "extraction_succeeded"]) {
      expect(audits.filter((e) => e.event_type === type)).toHaveLength(1);
    }
    // Logs of the scenario carry no note content either.
    const logText = JSON.stringify([...serverLogs, ...Object.values(people).flatMap((p) => p.logs)]);
    for (const word of ["Seen by the doctor", "Attend clinic", "Which clinic", "@example.com"]) {
      expect(logText).not.toContain(word);
    }
  });

  it("another household sees none of it", async () => {
    const outsider = people.outsider;
    expect(await getEventTimeline(outsider.client, noteId)).toEqual([]);
    expect(await getSharedCareEvent(outsider.client, noteId)).toBeNull();
    const feed = await getFamilyFeed(outsider.client, HOUSEHOLD, outsider.memberId);
    expect(feed.events).toEqual([]);
    expect(feed.reminders).toEqual([]);
    for (const table of ["audit_events", "feed_items", "care_chains", "notes"] as const) {
      const { data, error } = await outsider.client.from(table).select("id").eq("household_id", HOUSEHOLD);
      expect(error).toBeNull();
      expect(data, table).toEqual([]);
    }
    const { data: steps } = await outsider.client.from("care_steps").select("id").eq("id", clinicStepId);
    expect(steps).toEqual([]);
    const { data: mine } = await outsider.client.from("households").select("id");
    expect((mine ?? []).map((h) => h.id)).toEqual([OTHER_HOUSEHOLD]);
  });
});
