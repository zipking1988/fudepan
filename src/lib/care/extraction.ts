import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { extractCareChain } from "@/lib/ai/client";
import { getSession } from "@/lib/auth/session";
import { log } from "@/lib/log";
import { openNoteImage } from "@/lib/notes/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export type ExtractResult =
  | { ok: true; careChainId: string }
  | { ok: false; reason: string };

/**
 * Run ai& extraction for a note, write the Care Chain draft to the database,
 * and audit every step. Returns the new care chain ID on success.
 *
 * Caller must have already verified the user belongs to the note's household.
 */
export async function runExtraction(noteId: string): Promise<ExtractResult> {
  const { supabase: userClient, user } = await getSession();
  if (!user) return { ok: false, reason: "signed_out" };

  const admin = createAdminClient();

  // 1. Load note to get household_id and image path
  const { data: note, error: noteErr } = await userClient
    .from("notes")
    .select("id, household_id, status, image_path")
    .eq("id", noteId)
    .maybeSingle();

  if (noteErr || !note) {
    log("warn", "extraction.note_not_found", { note_id: noteId });
    return { ok: false, reason: "note_not_found" };
  }

  if (note.status === "pending_review") {
    // Already extracted — find and return the existing chain
    const { data: existing } = await admin
      .from("care_chains")
      .select("id")
      .eq("note_id", noteId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return { ok: true, careChainId: existing.id };
  }

  // 2. Mark note as extracting
  await admin
    .from("notes")
    .update({ status: "extracting" })
    .eq("id", noteId);

  // 3. Write audit: extraction_started
  await writeAudit(admin, {
    householdId: note.household_id,
    actorType: "human",
    actorId: user.id,
    eventType: "extraction_started",
    payload: { note_id: noteId },
  });

  // 4. Read image bytes
  const image = await openNoteImage({
    userClient,
    admin,
    noteId,
  });

  if (!image) {
    await markExtractionFailed(admin, noteId, note.household_id, user.id, "image_not_found");
    return { ok: false, reason: "image_not_found" };
  }

  // Convert ReadableStream to Uint8Array
  const chunks: Uint8Array[] = [];
  const reader = image.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const totalLength = chunks.reduce((n, c) => n + c.length, 0);
  const imageBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    imageBytes.set(chunk, offset);
    offset += chunk.length;
  }

  // 5. Call ai& extraction
  const result = await extractCareChain(imageBytes, image.contentType);

  if (!result.ok) {
    log("warn", "extraction.aiand_failed", { note_id: noteId, reason: result.reason });
    await markExtractionFailed(admin, noteId, note.household_id, user.id, result.reason);
    return { ok: false, reason: result.reason };
  }

  const draft = result.draft;

  // 6. Write Care Chain and steps in a single transaction-like sequence
  // Insert care chain
  const { data: chain, error: chainErr } = await admin
    .from("care_chains")
    .insert({
      household_id: note.household_id,
      note_id: noteId,
      title: draft.chain_title,
      status: "pending_review",
      risk_level: draft.overall_risk,
      created_by_ai: true,
    })
    .select("id")
    .single();

  if (chainErr || !chain) {
    log("error", "extraction.chain_insert_failed", { note_id: noteId });
    await markExtractionFailed(admin, noteId, note.household_id, user.id, "db_error");
    return { ok: false, reason: "db_error" };
  }

  // Write audit: extraction_succeeded
  const { data: auditRow } = await writeAuditReturning(admin, {
    householdId: note.household_id,
    careChainId: chain.id,
    actorType: "ai",
    actorId: null,
    eventType: "extraction_succeeded",
    payload: {
      note_id: noteId,
      care_chain_id: chain.id,
      step_count: draft.steps.length,
      ambiguity_count: draft.ambiguities.length,
      overall_risk: draft.overall_risk,
    },
  });

  // Insert care steps
  const stepInserts = draft.steps.map((step) => ({
    care_chain_id: chain.id,
    title: step.title,
    description: step.description ?? null,
    care_category: step.care_category,
    risk_level: step.risk_level,
    status: "pending_review",
    owner_id: null as string | null,
    backup_owner_id: null as string | null,
    due_at: step.due_at ?? null,
    escalation_at: step.escalation_at ?? null,
    evidence_required: step.evidence_required,
    approval_required: step.approval_required,
    source_quote: step.source_quote ?? null,
    confidence: step.confidence,
    audit_event_id: auditRow?.id ?? null,
  }));

  const { error: stepsErr } = await admin.from("care_steps").insert(stepInserts);
  if (stepsErr) {
    log("error", "extraction.steps_insert_failed", { note_id: noteId });
    // Chain was created but steps failed — mark chain failed
    await admin.from("care_chains").update({ status: "extraction_failed" }).eq("id", chain.id);
    await markExtractionFailed(admin, noteId, note.household_id, user.id, "steps_insert_failed");
    return { ok: false, reason: "db_error" };
  }

  // Store ambiguities in audit payload (not a separate table for Alpha)
  if (draft.ambiguities.length > 0) {
    await writeAudit(admin, {
      householdId: note.household_id,
      careChainId: chain.id,
      actorType: "ai",
      actorId: null,
      eventType: "ambiguities_detected",
      payload: { ambiguities: draft.ambiguities },
    });
  }

  // 7. Mark note as pending_review
  await admin.from("notes").update({ status: "pending_review" }).eq("id", noteId);

  log("info", "extraction.completed", {
    note_id: noteId,
    household_id: note.household_id,
  });

  return { ok: true, careChainId: chain.id };
}

async function markExtractionFailed(
  admin: Client,
  noteId: string,
  householdId: string,
  userId: string,
  reason: string,
): Promise<void> {
  await admin.from("notes").update({ status: "extraction_failed" }).eq("id", noteId);
  await writeAudit(admin, {
    householdId,
    actorType: "human",
    actorId: userId,
    eventType: "extraction_failed",
    payload: { note_id: noteId, reason },
  });
}

type AuditInput = {
  householdId: string;
  careChainId?: string;
  actorType: string;
  actorId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
};

async function writeAudit(admin: Client, input: AuditInput): Promise<void> {
  await admin.from("audit_events").insert({
    household_id: input.householdId,
    care_chain_id: input.careChainId ?? null,
    actor_type: input.actorType,
    actor_id: input.actorId,
    event_type: input.eventType,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    payload: input.payload as any,
  });
}

async function writeAuditReturning(
  admin: Client,
  input: AuditInput,
): Promise<{ data: { id: string } | null }> {
  const { data, error } = await admin
    .from("audit_events")
    .insert({
      household_id: input.householdId,
      care_chain_id: input.careChainId ?? null,
      actor_type: input.actorType,
      actor_id: input.actorId,
      event_type: input.eventType,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      payload: input.payload as any,
    })
    .select("id")
    .single();
  if (error) return { data: null };
  return { data };
}
