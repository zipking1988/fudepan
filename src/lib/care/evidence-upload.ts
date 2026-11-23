import "server-only";

import { z } from "zod";

import type { SessionUser } from "@/lib/auth/session";
import type { LogFields, Logger } from "@/lib/log";
import { MAX_NOTE_BYTES, NOTE_FILE_EXTENSIONS, isNoteContentType } from "@/lib/notes/rules";
import { sniffNoteImageType } from "@/lib/notes/validation";

import type { PartActionResult, PartActionService } from "./part-actions";

/**
 * Evidence upload (family-shared-care design, Requirements 11.2 and 15.3).
 *
 *   prepare  → checks the Part is visible to the person (row-level security),
 *              checks the declared type and size, builds the object path, and
 *              returns a signed upload token for that one path.
 *   (the browser uploads the bytes straight to the private `evidence` bucket)
 *   complete → checks the object exists at that exact path, its size, type,
 *              and first bytes, then records it with `record_evidence`.
 *
 * Paths: `{household}/{step}/{13-digit epoch ms}-evidence.(jpg|png|webp|pdf)`.
 * The browser's file name is never used. Logs carry stage and code only,
 * never paths, labels, or text.
 */

export const EVIDENCE_BUCKET = "evidence";
export const MAX_EVIDENCE_BYTES = MAX_NOTE_BYTES;
export const EVIDENCE_SIGNATURE_BYTES = 16;

const PDF_TYPE = "application/pdf";
const EXTENSIONS: Record<string, string> = {
  ...NOTE_FILE_EXTENSIONS,
  [PDF_TYPE]: "pdf",
};
const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: PDF_TYPE,
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PATH_PATTERN = new RegExp(`^(${UUID})/(${UUID})/([0-9]{13})-evidence\\.(jpg|png|webp|pdf)$`);

export type EvidenceMessageKey =
  | "refusal.signedOut"
  | "refusal.notFoundOrNoAccess"
  | "refusal.invalidInput"
  | "evidence.empty"
  | "evidence.tooLarge"
  | "evidence.unsupportedType"
  | "evidence.notUploaded"
  | "evidence.contentMismatch"
  | "evidence.unavailable";

export type EvidenceFailure = {
  ok: false;
  messageKey: string;
  params: { field?: string };
};

export type PreparedEvidenceUpload = { ok: true; objectPath: string; token: string };

export function buildEvidenceObjectPath(
  householdId: string,
  stepId: string,
  contentType: string,
  now: Date,
): string {
  const extension = EXTENSIONS[contentType];
  if (!extension) throw new Error("Unsupported evidence type");
  const timestamp = String(now.getTime()).padStart(13, "0");
  return `${householdId}/${stepId}/${timestamp}-evidence.${extension}`;
}

export function parseEvidenceObjectPath(
  path: string,
): { householdId: string; stepId: string; contentType: string } | null {
  const match = PATH_PATTERN.exec(path);
  if (!match) return null;
  return { householdId: match[1], stepId: match[2], contentType: TYPE_BY_EXTENSION[match[4]] };
}

/** JPEG, PNG, WebP, or PDF from the first bytes. */
export function sniffEvidenceType(head: Uint8Array): string | null {
  const image = sniffNoteImageType(head);
  if (image) return image;
  const pdf = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  return head.length >= pdf.length && pdf.every((b, i) => head[i] === b) ? PDF_TYPE : null;
}

/** Everything the service needs from Supabase. */
export interface EvidenceUploadStore {
  /** The Part's household, read with the person's own row-level-security client. */
  findStepHousehold(stepId: string): Promise<string | null>;
  createUploadToken(objectPath: string): Promise<string | null>;
  statObject(
    objectPath: string,
  ): Promise<{ sizeBytes: number; contentType: string | null } | "missing" | "error">;
  readObjectHead(objectPath: string, bytes: number): Promise<Uint8Array | null>;
  removeObject(objectPath: string): Promise<"removed" | "absent" | "error">;
}

const prepareInput = z.object({
  stepId: z.uuid(),
  kind: z.enum(["photo", "file"]),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const completeInput = z.object({
  stepId: z.uuid(),
  label: z.string().trim().min(1).max(200),
  objectPath: z.string().max(300),
});

function failure(messageKey: EvidenceMessageKey, field?: string): EvidenceFailure {
  return { ok: false, messageKey, params: field === undefined ? {} : { field } };
}

export function createEvidenceUploadService(deps: {
  store: EvidenceUploadStore;
  partActions: Pick<PartActionService, "recordEvidence">;
  log: Logger;
  now?: () => Date;
}) {
  const { store, partActions, log } = deps;
  const now = deps.now ?? (() => new Date());

  async function safely<T>(stage: string, fields: LogFields, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch {
      log("error", "evidence_upload.threw", { ...fields, stage, code: "threw" });
      return undefined;
    }
  }

  async function prepare(
    user: SessionUser | null,
    rawInput: unknown,
  ): Promise<PreparedEvidenceUpload | EvidenceFailure> {
    if (!user) {
      log("warn", "evidence_upload.refused", { stage: "prepare", code: "signed_out" });
      return failure("refusal.signedOut");
    }
    const parsed = prepareInput.safeParse(rawInput);
    if (!parsed.success) {
      log("warn", "evidence_upload.refused", {
        stage: "prepare",
        code: "invalid_input",
        user_id: user.id,
      });
      const field = parsed.error.issues[0]?.path[0];
      return failure("refusal.invalidInput", typeof field === "string" ? field : undefined);
    }
    const { kind, contentType, sizeBytes } = parsed.data;
    const stepId = parsed.data.stepId.toLowerCase();

    const householdId = await safely("find_step", { user_id: user.id, step_id: stepId }, () =>
      store.findStepHousehold(stepId),
    );
    if (householdId === undefined) return failure("evidence.unavailable");
    if (!householdId) {
      // A missing Part and a Part in another household look the same (Requirement 14.2).
      log("warn", "evidence_upload.refused", {
        stage: "prepare",
        code: "not_found",
        user_id: user.id,
        step_id: stepId,
      });
      return failure("refusal.notFoundOrNoAccess");
    }

    if (sizeBytes <= 0) return refuse(user.id, stepId, "empty", "evidence.empty", "sizeBytes");
    if (sizeBytes > MAX_EVIDENCE_BYTES) {
      return refuse(user.id, stepId, "too_large", "evidence.tooLarge", "sizeBytes");
    }
    const allowed =
      kind === "photo"
        ? isNoteContentType(contentType)
        : isNoteContentType(contentType) || contentType === PDF_TYPE;
    if (!allowed) {
      return refuse(user.id, stepId, "unsupported_type", "evidence.unsupportedType", "contentType");
    }

    const objectPath = buildEvidenceObjectPath(householdId, stepId, contentType, now());
    const token = await safely("create_token", { user_id: user.id, step_id: stepId }, () =>
      store.createUploadToken(objectPath),
    );
    if (!token) return failure("evidence.unavailable");

    log("info", "evidence_upload.prepared", { stage: "prepare", user_id: user.id, step_id: stepId });
    return { ok: true, objectPath, token };
  }

  function refuse(
    userId: string,
    stepId: string,
    code: string,
    messageKey: EvidenceMessageKey,
    field: string,
  ): EvidenceFailure {
    log("warn", "evidence_upload.refused", { stage: "prepare", code, user_id: userId, step_id: stepId });
    return failure(messageKey, field);
  }

  async function complete(
    user: SessionUser | null,
    rawInput: unknown,
  ): Promise<PartActionResult | EvidenceFailure> {
    if (!user) {
      log("warn", "evidence_upload.refused", { stage: "complete", code: "signed_out" });
      return failure("refusal.signedOut");
    }
    const parsed = completeInput.safeParse(rawInput);
    if (!parsed.success) {
      log("warn", "evidence_upload.refused", {
        stage: "complete",
        code: "invalid_input",
        user_id: user.id,
      });
      const field = parsed.error.issues[0]?.path[0];
      return failure("refusal.invalidInput", typeof field === "string" ? field : undefined);
    }
    const { label, objectPath } = parsed.data;
    const stepId = parsed.data.stepId.toLowerCase();
    const fields = { user_id: user.id, step_id: stepId };

    const householdId = await safely("find_step", fields, () => store.findStepHousehold(stepId));
    if (householdId === undefined) return failure("evidence.unavailable");
    if (!householdId) {
      log("warn", "evidence_upload.refused", { stage: "complete", code: "not_found", ...fields });
      return failure("refusal.notFoundOrNoAccess");
    }

    // Only a path built for this exact Part and household is accepted.
    const path = parseEvidenceObjectPath(objectPath);
    if (!path || path.householdId !== householdId || path.stepId !== stepId) {
      log("warn", "evidence_upload.refused", { stage: "complete", code: "path_mismatch", ...fields });
      return failure("refusal.invalidInput", "objectPath");
    }

    const stat = await safely("stat_object", fields, () => store.statObject(objectPath));
    if (stat === undefined || stat === "error") return failure("evidence.unavailable");
    if (stat === "missing") {
      log("warn", "evidence_upload.refused", { stage: "complete", code: "object_missing", ...fields });
      return failure("evidence.notUploaded");
    }
    if (stat.sizeBytes <= 0 || stat.sizeBytes > MAX_EVIDENCE_BYTES) {
      await discard(objectPath, fields, "object_invalid");
      return failure(stat.sizeBytes <= 0 ? "evidence.empty" : "evidence.tooLarge");
    }
    if (stat.contentType !== path.contentType) {
      await discard(objectPath, fields, "type_mismatch");
      return failure("evidence.contentMismatch");
    }
    const head = await safely("read_head", fields, () =>
      store.readObjectHead(objectPath, EVIDENCE_SIGNATURE_BYTES),
    );
    if (!head) return failure("evidence.unavailable");
    if (sniffEvidenceType(head) !== path.contentType) {
      await discard(objectPath, fields, "content_mismatch");
      return failure("evidence.contentMismatch");
    }

    const result = await partActions.recordEvidence(user, {
      stepId,
      kind: path.contentType === PDF_TYPE ? "file" : "photo",
      label,
      storagePath: objectPath,
    });
    // A refused record leaves an object nothing refers to; a plain error may be a retry, so keep it.
    if (!result.ok && result.code !== "error") {
      await discard(objectPath, fields, `record_${result.code}`);
    }
    return result;
  }

  async function discard(objectPath: string, fields: LogFields, code: string): Promise<void> {
    const removal = await safely("remove_object", fields, () => store.removeObject(objectPath));
    log("warn", "evidence_upload.discarded", {
      stage: "complete",
      code: removal === "error" || removal === undefined ? "remove_failed" : code,
      ...fields,
    });
  }

  return { prepare, complete };
}

export type EvidenceUploadService = ReturnType<typeof createEvidenceUploadService>;
