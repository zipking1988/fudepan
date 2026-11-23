import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isUuid } from "@/lib/ids";
import { hasModelOnlyDeadline } from "./appointment";
import { summarizeChain, type ChainSummary } from "./chain-summary";
import type { Database } from "@/lib/supabase/database.types";
import { CARE_CATEGORIES, type CareCategory } from "@/lib/ai/schema";
import { RISK_LEVELS, type RiskLevel } from "./risk";
import { effectiveApprovalState } from "./rules/approval";
import {
  deriveMissingDetails,
  MISSING_DETAIL_KINDS,
  type MissingDetailKind,
  type MissingDetailQuestionCode,
  type StoredMissingDetail,
} from "./rules/missing-details";
import type { ApprovalState, ConfirmedTime } from "./rules/types";
import { wallClockInZone } from "./appointment";
import {
  isEventDone,
  selectEventChain,
  type EventPart,
  type EventTime,
  type MemberRef,
  type SharedCareEvent,
} from "@/lib/family/shared-care-event";

type Client = SupabaseClient<Database>;

export type CareChainSummary = {
  id: string;
  noteId: string;
  title: string;
  status: string;
  riskLevel: string;
  createdAt: string;
  stepCount: number;
};

export type CareStepDetail = {
  id: string;
  title: string;
  description: string | null;
  careCategory: string;
  riskLevel: string;
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  backupOwnerId: string | null;
  backupOwnerName: string | null;
  dueAt: string | null;
  escalationAt: string | null;
  evidenceRequired: string[];
  approvalRequired: boolean;
  /** Stored approval_state; null for legacy rows. */
  approvalState: string | null;
  sourceQuote: string | null;
  confidence: number | null;
  appointmentLocation: string | null;
  appointmentTime: string | null;
  appointmentTimezone: string | null;
};

export type CareChainDetail = {
  id: string;
  noteId: string;
  householdId: string;
  title: string;
  status: string;
  riskLevel: string;
  createdAt: string;
  steps: CareStepDetail[];
};

export type AmbiguityRow = {
  field: string;
  question: string;
  reason: string;
};

export type CareChainWithAmbiguities = CareChainDetail & {
  ambiguities: AmbiguityRow[];
};

/** All Care Chains for a note, newest first. */
export async function listCareChainsByNote(
  supabase: Client,
  noteId: string,
): Promise<CareChainSummary[]> {
  if (!isUuid(noteId)) return [];

  const { data, error } = await supabase
    .from("care_chains")
    .select("id, note_id, title, status, risk_level, created_at, care_steps ( id )")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });

  if (error) throw new Error("care_chains_query_failed");

  return data.map((row) => ({
    id: row.id,
    noteId: row.note_id,
    title: row.title,
    status: row.status,
    riskLevel: row.risk_level,
    createdAt: row.created_at,
    stepCount: Array.isArray(row.care_steps) ? row.care_steps.length : 0,
  }));
}

/**
 * One Care Chain with its steps and member names.
 * Returns null if the chain does not exist or belongs to another household.
 */
export async function getCareChainDetail(
  supabase: Client,
  chainId: string,
): Promise<CareChainDetail | null> {
  if (!isUuid(chainId)) return null;

  const { data, error } = await supabase
    .from("care_chains")
    .select(
      `id, note_id, household_id, title, status, risk_level, created_at,
       care_steps (
         id, title, description, care_category, risk_level, status,
         owner_id, backup_owner_id, due_at, escalation_at,
         evidence_required, approval_required, approval_state, source_quote, confidence,
         appointment_location, appointment_time, appointment_timezone
       )`,
    )
    .eq("id", chainId)
    .maybeSingle();

  if (error) throw new Error("care_chain_query_failed");
  if (!data) return null;

  // Resolve member names for owners
  const ownerIds = new Set<string>();
  const steps = Array.isArray(data.care_steps) ? data.care_steps : [];
  for (const s of steps) {
    if (s.owner_id) ownerIds.add(s.owner_id);
    if (s.backup_owner_id) ownerIds.add(s.backup_owner_id);
  }

  const namesMap = new Map<string, string>();
  if (ownerIds.size > 0) {
    const { data: members } = await supabase
      .from("household_members")
      .select("id, display_name")
      .eq("household_id", data.household_id)
      .in("id", [...ownerIds]);
    for (const m of members ?? []) {
      namesMap.set(m.id, m.display_name);
    }
  }

  return {
    id: data.id,
    noteId: data.note_id,
    householdId: data.household_id,
    title: data.title,
    status: data.status,
    riskLevel: data.risk_level,
    createdAt: data.created_at,
    steps: steps.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      careCategory: s.care_category,
      riskLevel: s.risk_level,
      status: s.status,
      ownerId: s.owner_id,
      ownerName: s.owner_id ? (namesMap.get(s.owner_id) ?? null) : null,
      backupOwnerId: s.backup_owner_id,
      backupOwnerName: s.backup_owner_id ? (namesMap.get(s.backup_owner_id) ?? null) : null,
      // Legacy appointment rows may hold a model-guessed instant; never show it as a deadline.
      dueAt: hasModelOnlyDeadline(s.care_category) ? null : s.due_at,
      escalationAt: hasModelOnlyDeadline(s.care_category) ? null : s.escalation_at,
      evidenceRequired: s.evidence_required ?? [],
      approvalRequired: s.approval_required,
      approvalState: s.approval_state,
      sourceQuote: s.source_quote,
      confidence: s.confidence,
      appointmentLocation: s.appointment_location,
      appointmentTime: s.appointment_time,
      appointmentTimezone: s.appointment_timezone,
    })),
  };
}

export type NoteChainOverview = {
  chainId: string;
  noteId: string;
  title: string;
  status: string;
  riskLevel: string;
  summary: ChainSummary;
};

/**
 * The newest Care Chain of each note in a household, with its step summary.
 * Uses the person's row-level-security client, so other households never appear.
 */
export async function listNoteChainOverviews(
  supabase: Client,
  householdId: string,
): Promise<Map<string, NoteChainOverview>> {
  if (!isUuid(householdId)) return new Map();
  const { data, error } = await supabase
    .from("care_chains")
    .select(
      `id, note_id, title, status, risk_level, created_at,
       care_steps ( care_category, status, approval_required, approval_state, owner_id,
                    appointment_location, appointment_time, appointment_timezone )`,
    )
    .eq("household_id", householdId)
    .order("created_at", { ascending: false });
  if (error) throw new Error("chain_overview_query_failed");
  const byNote = new Map<string, NoteChainOverview>();
  for (const row of data) {
    if (byNote.has(row.note_id)) continue; // newest first; keep the newest chain
    const steps = Array.isArray(row.care_steps) ? row.care_steps : [];
    byNote.set(row.note_id, {
      chainId: row.id,
      noteId: row.note_id,
      title: row.title,
      status: row.status,
      riskLevel: row.risk_level,
      summary: summarizeChain(
        steps.map((s) => ({
          careCategory: s.care_category,
          status: s.status,
          approvalRequired: s.approval_required,
          approvalState: s.approval_state,
          ownerId: s.owner_id,
          appointmentLocation: s.appointment_location,
          appointmentTime: s.appointment_time,
          appointmentTimezone: s.appointment_timezone,
        })),
      ),
    });
  }
  return byNote;
}

/** Household members available to be assigned as owners. */
export type MemberOption = {
  id: string;
  displayName: string;
  role: string;
};

export async function listHouseholdMemberOptions(
  supabase: Client,
  householdId: string,
): Promise<MemberOption[]> {
  const { data, error } = await supabase
    .from("household_members")
    .select("id, display_name, role")
    .eq("household_id", householdId)
    .eq("is_active", true)
    .order("display_name");

  if (error) throw new Error("member_options_query_failed");
  return data.map((m) => ({ id: m.id, displayName: m.display_name, role: m.role }));
}

// ---------------------------------------------------------------------------
// Shared_Care_Event (family-shared-care design, read layer)
// ---------------------------------------------------------------------------

const QUESTION_CODES: ReadonlySet<string> = new Set<MissingDetailQuestionCode>([
  "which_clinic",
  "which_date",
  "which_time",
  "which_amount",
  "who_will_drive",
  "when_is_deadline",
  "which_person",
  "which_document",
  "which_contact",
  "ai_question",
]);

const APPROVAL_STATES: ReadonlySet<string> = new Set(["not_required", "pending", "approved", "rejected"]);

function asCategory(value: string): CareCategory {
  return (CARE_CATEGORIES as readonly string[]).includes(value) ? (value as CareCategory) : "household";
}

function asRisk(value: string): RiskLevel {
  return (RISK_LEVELS as readonly string[]).includes(value) ? (value as RiskLevel) : "high";
}

function eventTime(
  at: string | null,
  timeZone: string | null,
  provenance: string | null,
): EventTime | null {
  if (!at || !timeZone) return null;
  if (provenance !== "human_confirmed" && provenance !== "model_suggested") return null;
  return { at, timeZone, provenance };
}

function toConfirmed(t: EventTime | null): ConfirmedTime | null {
  return t ? { at: new Date(t.at), timeZone: t.timeZone, provenance: t.provenance } : null;
}

/**
 * The Shared_Care_Event of one note: the note plus its newest Usable_Draft.
 *
 * Uses the person's row-level-security client, so a note, Part, request, Evidence row,
 * Missing_Detail, or member of another household is never returned. Returns null when the note
 * is not visible. Recognition runs are service-role only, so the state comes from the note status.
 * Evidence text and storage paths are never selected.
 */
export async function getSharedCareEvent(
  supabase: Client,
  noteId: string,
): Promise<SharedCareEvent | null> {
  if (!isUuid(noteId)) return null;

  const { data: note, error: noteError } = await supabase
    .from("notes")
    .select("id, household_id, status, created_at")
    .eq("id", noteId)
    .maybeSingle();
  if (noteError) throw new Error("shared_event_note_query_failed");
  if (!note) return null;

  const { data: chains, error: chainsError } = await supabase
    .from("care_chains")
    .select("id, title, status, risk_level, created_at")
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });
  if (chainsError) throw new Error("shared_event_chains_query_failed");

  const selection = selectEventChain(
    (chains ?? []).map((c) => ({ id: c.id, status: c.status, createdAt: c.created_at })),
    [],
    note.status,
  );
  const chain = selection.chain ? (chains ?? []).find((c) => c.id === selection.chain!.id) : undefined;

  const base: SharedCareEvent = {
    noteId: note.id,
    householdId: note.household_id,
    state: selection.state,
    retryable: selection.retryable,
    failureReason: selection.failureReason,
    chainId: chain?.id ?? null,
    title: chain?.title ?? null,
    riskLevel: chain ? asRisk(chain.risk_level) : null,
    createdAt: note.created_at,
    parts: [],
    done: false,
  };
  if (!chain) return base;

  const [stepsRes, requestsRes, evidenceRes, detailsRes, membersRes] = await Promise.all([
    supabase
      .from("care_steps")
      .select(
        `id, title, description, care_category, risk_level, status, source_quote, confidence,
         owner_id, backup_owner_id, driver_id, companion_id,
         evidence_required, approval_required, approval_state, plan_version,
         suggested_role, person_to_ask, required_amount_minor,
         appointment_location, appointment_time, appointment_timezone,
         respond_by_at, respond_by_timezone, respond_by_provenance,
         task_due_at, task_due_timezone, task_due_provenance`,
      )
      .eq("care_chain_id", chain.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("care_requests")
      .select("id, care_step_id, kind, helper_role, from_member_id, to_member_id, created_at, expires_at")
      .eq("care_chain_id", chain.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    // No text_body and no storage_path: counts and labels only.
    supabase
      .from("part_evidence")
      .select("id, care_step_id, kind, label")
      .eq("care_chain_id", chain.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("part_missing_details")
      .select("id, care_step_id, kind, question_code, ai_question, resolved_at, resolved_by, answer")
      .eq("care_chain_id", chain.id)
      .order("created_at", { ascending: true }),
    supabase.from("household_members").select("id, display_name").eq("household_id", note.household_id),
  ]);
  if (stepsRes.error) throw new Error("shared_event_steps_query_failed");
  if (requestsRes.error) throw new Error("shared_event_requests_query_failed");
  if (evidenceRes.error) throw new Error("shared_event_evidence_query_failed");
  if (detailsRes.error) throw new Error("shared_event_details_query_failed");

  const names = new Map<string, string>();
  for (const m of membersRes.data ?? []) names.set(m.id, m.display_name);
  const ref = (id: string | null): MemberRef | null => (id ? { id, name: names.get(id) ?? null } : null);

  const parts: EventPart[] = (stepsRes.data ?? []).map((s) => {
    const careCategory = asCategory(s.care_category);
    const riskLevel = asRisk(s.risk_level);
    const storedApproval = s.approval_state && APPROVAL_STATES.has(s.approval_state)
      ? (s.approval_state as ApprovalState)
      : null;

    // A saved appointment time comes from the human clarification form.
    const appointment = eventTime(s.appointment_time, s.appointment_timezone, s.appointment_time ? "human_confirmed" : null);
    const respondBy = eventTime(s.respond_by_at, s.respond_by_timezone, s.respond_by_provenance);
    const taskDue = eventTime(s.task_due_at, s.task_due_timezone, s.task_due_provenance);
    const confirmedOnly = (t: EventTime | null) => (t?.provenance === "human_confirmed" ? t : null);
    const suggestedOnly = (t: EventTime | null) => (t?.provenance === "model_suggested" ? t : null);

    const evidenceRows = (evidenceRes.data ?? []).filter((e) => e.care_step_id === s.id);
    const evidenceRequired = s.evidence_required ?? [];

    const stored: StoredMissingDetail[] = [];
    for (const d of detailsRes.data ?? []) {
      if (d.care_step_id !== s.id) continue;
      if (!(MISSING_DETAIL_KINDS as readonly string[]).includes(d.kind)) continue;
      stored.push({
        id: d.id,
        kind: d.kind as MissingDetailKind,
        questionCode: (QUESTION_CODES.has(d.question_code) ? d.question_code : "ai_question") as MissingDetailQuestionCode,
        aiQuestion: d.ai_question,
        resolvedAt: d.resolved_at,
        resolvedBy: d.resolved_by,
        answer: d.answer,
      });
    }

    const appointmentConfirmed = confirmedOnly(appointment);
    const missingDetails = deriveMissingDetails(
      {
        id: s.id,
        householdId: note.household_id,
        careCategory,
        riskLevel,
        approvalRequired: s.approval_required,
        storedApprovalState: storedApproval,
        legacyStatus: s.status,
        ownerId: s.owner_id,
        driverId: s.driver_id,
        companionId: s.companion_id,
        backupOwnerId: s.backup_owner_id,
        taskDue: toConfirmed(taskDue),
        respondBy: toConfirmed(respondBy),
        evidenceRequired,
        evidenceAttached: evidenceRows.map((e) => e.label),
        planVersion: s.plan_version,
        rejectedAtPlanVersion: null,
        location: s.appointment_location,
        appointmentTime: toConfirmed(appointmentConfirmed),
        appointmentDate: appointmentConfirmed
          ? wallClockInZone(new Date(appointmentConfirmed.at), appointmentConfirmed.timeZone).date
          : null,
        requiredAmountMinor: s.required_amount_minor,
        personToAsk: s.person_to_ask,
      },
      stored,
    );

    return {
      id: s.id,
      title: s.title,
      description: s.description,
      careCategory,
      riskLevel,
      progressStatus: s.status,
      sourceQuote: s.source_quote,
      confidence: s.confidence,
      approvalRequired: s.approval_required,
      approvalState: effectiveApprovalState({
        approvalRequired: s.approval_required,
        storedApprovalState: storedApproval,
        legacyStatus: s.status,
      }),
      planVersion: s.plan_version,
      // Legacy owners are shown as Owners.
      owner: ref(s.owner_id),
      driver: ref(s.driver_id),
      companion: ref(s.companion_id),
      backup: ref(s.backup_owner_id),
      suggestedRole: s.suggested_role,
      personToAsk: s.person_to_ask,
      location: s.appointment_location,
      // Legacy due_at and escalation_at are never selected: only a confirmed task_due is a deadline.
      confirmed: {
        appointment: appointmentConfirmed,
        respondBy: confirmedOnly(respondBy),
        taskDue: confirmedOnly(taskDue),
      },
      suggested: {
        appointment: suggestedOnly(appointment),
        respondBy: suggestedOnly(respondBy),
        taskDue: suggestedOnly(taskDue),
      },
      hasRequiredAmount: s.required_amount_minor !== null,
      pendingRequests: (requestsRes.data ?? [])
        .filter((r) => r.care_step_id === s.id)
        .map((r) => ({
          id: r.id,
          kind: r.kind,
          helperRole: r.helper_role,
          from: { id: r.from_member_id, name: names.get(r.from_member_id) ?? null },
          to: { id: r.to_member_id, name: names.get(r.to_member_id) ?? null },
          createdAt: r.created_at,
          expiresAt: r.expires_at,
        })),
      missingDetails,
      evidence: {
        required: evidenceRequired,
        attachedCount: evidenceRows.length,
        attached: evidenceRows.map((e) => ({ id: e.id, kind: e.kind, label: e.label })),
      },
    };
  });

  return { ...base, parts, done: isEventDone(parts) };
}
