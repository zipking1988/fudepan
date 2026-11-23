/**
 * Shared_Care_Event read-layer types and the pure chain selection
 * (family-shared-care design, Property 27; Requirements 3.1, 3.5, 4.9, 11.5, 18.3).
 *
 * Pure: no I/O, no clock, no server-only imports.
 *
 * One note is one event. The event shows the newest Usable_Draft, which is the newest
 * chain whose status is not `extraction_failed`. Legacy notes may have several chains.
 */
import type { CareCategory } from "@/lib/ai/schema";
import type { RiskLevel } from "@/lib/care/risk";
import type { ApprovalState, ProgressStatus } from "@/lib/care/rules/types";
import type { MissingDetail } from "@/lib/care/rules/missing-details";

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type EventChainCandidate = { id: string; status: string; createdAt: string };

export type EventRunCandidate = {
  /** `queued | running | succeeded | failed | superseded` */
  status: string;
  createdAt: string;
  /** Reason code only, never model text. */
  failureReason?: string | null;
};

/**
 * - `reading`: a recognition run is active and there is no usable chain ("Being read").
 * - `ready`: a Usable_Draft exists.
 * - `failed`: reading failed and there is no usable chain ("Could not read this note").
 * - `uploaded`: the note exists and nothing has started yet.
 */
export type EventState = "reading" | "ready" | "failed" | "uploaded";

export type EventSelection = {
  state: EventState;
  chain: EventChainCandidate | null;
  /** True only for `failed`: a new run on the same note and photo may be started (Requirement 2.15). */
  retryable: boolean;
  /** Reason code of the latest failed run, when known. */
  failureReason: string | null;
};

function time(value: string): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

function newestFirst<T extends { createdAt: string }>(items: readonly T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => time(b.item.createdAt) - time(a.item.createdAt) || a.index - b.index)
    .map((x) => x.item);
}

const ACTIVE_RUN = new Set(["queued", "running"]);

/**
 * Picks the chain for one note's event and the event state.
 * `noteStatus` is only a fallback for legacy notes that have no recognition run.
 */
export function selectEventChain(
  chains: readonly EventChainCandidate[],
  runs: readonly EventRunCandidate[] = [],
  noteStatus?: string | null,
): EventSelection {
  // Same tie-break as the database: newest first, then the later id.
  const ordered = chains
    .map((chain, index) => ({ chain, index }))
    .sort(
      (a, b) =>
        time(b.chain.createdAt) - time(a.chain.createdAt) ||
        (a.chain.id < b.chain.id ? 1 : a.chain.id > b.chain.id ? -1 : a.index - b.index),
    )
    .map((x) => x.chain);
  const usable = ordered.find((c) => c.status !== "extraction_failed") ?? null;
  const latestRun = newestFirst(runs)[0] ?? null;

  if (usable) return { state: "ready", chain: usable, retryable: false, failureReason: null };

  if (runs.some((r) => ACTIVE_RUN.has(r.status))) {
    return { state: "reading", chain: null, retryable: false, failureReason: null };
  }
  // The note status is the live signal when runs are not readable: a retry sets it to `extracting`.
  if (noteStatus === "extracting" && latestRun?.status !== "failed") {
    return { state: "reading", chain: null, retryable: false, failureReason: null };
  }
  if (
    latestRun?.status === "failed" ||
    noteStatus === "extraction_failed" ||
    ordered.some((c) => c.status === "extraction_failed")
  ) {
    const reason = latestRun?.status === "failed" ? (latestRun.failureReason ?? null) : null;
    return { state: "failed", chain: null, retryable: true, failureReason: reason };
  }
  return { state: "uploaded", chain: null, retryable: false, failureReason: null };
}

/** The event is done exactly when it has Parts and every Part is `completed` or `cancelled`. */
export function isEventDone(parts: readonly { progressStatus: string }[]): boolean {
  return parts.length > 0 && parts.every((p) => p.progressStatus === "completed" || p.progressStatus === "cancelled");
}

// ---------------------------------------------------------------------------
// Read-layer types
// ---------------------------------------------------------------------------

export type MemberRef = { id: string; name: string | null };

export type EventTime = {
  /** ISO instant. */
  at: string;
  timeZone: string;
  provenance: "human_confirmed" | "model_suggested";
};

/** Times of one Part, with who set them. Legacy `due_at` and `escalation_at` are never shown. */
export type EventTimes = {
  appointment: EventTime | null;
  respondBy: EventTime | null;
  taskDue: EventTime | null;
};

export type PendingRequestView = {
  id: string;
  kind: string;
  /** Role the request is about, when it names one. */
  helperRole: string | null;
  from: MemberRef;
  to: MemberRef;
  createdAt: string;
  expiresAt: string;
};

export type MissingDetailView = MissingDetail;

/** Counts and labels only. Never the evidence text or a storage path. */
export type EvidenceView = {
  /** Labels of the Evidence the Part asks for. */
  required: string[];
  attachedCount: number;
  attached: { id: string; kind: string; label: string }[];
};

export type EventPart = {
  id: string;
  title: string;
  description: string | null;
  careCategory: CareCategory;
  riskLevel: RiskLevel;
  progressStatus: ProgressStatus | string;
  sourceQuote: string | null;
  confidence: number | null;
  approvalRequired: boolean;
  /** From `effectiveApprovalState`, so legacy rows with a null stored state map correctly. */
  approvalState: ApprovalState;
  planVersion: number;
  owner: MemberRef | null;
  driver: MemberRef | null;
  companion: MemberRef | null;
  backup: MemberRef | null;
  /** Advisory text from ai&. It never creates an Owner. */
  suggestedRole: string | null;
  /** Hint only. */
  personToAsk: string | null;
  location: string | null;
  /** Times a human confirmed. */
  confirmed: EventTimes;
  /** Times the model suggested. Shown as suggestions, never as deadlines. */
  suggested: EventTimes;
  /** Whether a required amount is stored. The amount itself is not part of this view. */
  hasRequiredAmount: boolean;
  pendingRequests: PendingRequestView[];
  missingDetails: MissingDetailView[];
  evidence: EvidenceView;
};

export type SharedCareEvent = {
  noteId: string;
  householdId: string;
  state: EventState;
  retryable: boolean;
  failureReason: string | null;
  chainId: string | null;
  title: string | null;
  riskLevel: RiskLevel | null;
  createdAt: string;
  parts: EventPart[];
  done: boolean;
};
