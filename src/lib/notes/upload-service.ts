import "server-only";

import { z } from "zod";

import type { SessionUser } from "@/lib/auth/session";
import { canUploadNotes, type HouseholdRole } from "@/lib/households/membership";
import type { LogFields, Logger } from "@/lib/log";

import { NOTE_UPLOAD_MESSAGES, type NoteUploadErrorCode } from "./messages";
import { MAX_NOTE_BYTES, type NoteContentType } from "./rules";
import { buildNoteObjectPath, isNoteObjectPathFor } from "./storage-path";
import { NOTE_SIGNATURE_BYTES, checkDeclaredNoteFile, sniffNoteImageType } from "./validation";

/**
 * Server side of the note upload (Phase 2).
 *
 *   prepare  → checks the person and the declared file, reserves a storage
 *              path, and returns a signed upload token for that one path.
 *   (the browser uploads the bytes straight to Storage)
 *   complete → checks the stored object's size, type, and first bytes, then
 *              saves the note and its `note.uploaded` audit event together.
 *   reportFailure → the browser could not upload; record it and clean up.
 *
 * Any failure after a reservation exists is claimed first (so the upload can
 * no longer complete), the stored object is removed, and the failure is
 * audited. Reservations that are never finished are swept later.
 */

export type ReservationStatus = "pending" | "failing" | "failed" | "completed" | "expired";

export type Reservation = {
  noteId: string;
  householdId: string;
  uploadedBy: string;
  objectPath: string;
  contentType: NoteContentType;
  status: ReservationStatus;
  expiresAt: Date;
};

export type RemoveResult = "removed" | "absent" | "error";

/** Everything the service needs from Supabase. See upload-store.ts. */
export interface NoteUploadStore {
  /** Active membership, read with the person's own row-level-security client. */
  findMembership(userId: string, householdId: string): Promise<{ role: HouseholdRole } | null>;
  recordRejection(input: {
    householdId: string;
    userId: string;
    stage: string;
    reason: string;
  }): Promise<void>;
  reserve(input: {
    noteId: string;
    householdId: string;
    userId: string;
    objectPath: string;
    contentType: NoteContentType;
    sizeBytes: number;
  }): Promise<"ok" | "not_allowed" | "too_many_pending" | "error">;
  createUploadToken(objectPath: string): Promise<string | null>;
  findReservation(noteId: string, userId: string): Promise<Reservation | null>;
  statObject(
    objectPath: string,
  ): Promise<{ sizeBytes: number; contentType: string | null } | "missing" | "error">;
  readObjectHead(objectPath: string, bytes: number): Promise<Uint8Array | null>;
  complete(input: {
    noteId: string;
    userId: string;
    sizeBytes: number;
    contentType: NoteContentType;
  }): Promise<"ok" | "not_pending" | "expired" | "not_allowed" | "error">;
  claimFailure(noteId: string, userId: string): Promise<boolean>;
  removeObject(objectPath: string): Promise<RemoveResult>;
  recordFailure(input: {
    noteId: string;
    userId: string;
    stage: string;
    reason: string;
    objectRemoved: boolean;
  }): Promise<void>;
  listExpiredReservations(
    householdId: string,
    limit: number,
  ): Promise<{ noteId: string; objectPath: string }[]>;
  expireReservation(noteId: string, objectRemoved: boolean): Promise<void>;
}

export type UploadFailure = { code: NoteUploadErrorCode; message: string };
export type ServiceResult<T> = ({ ok: true } & T) | { ok: false; error: UploadFailure };

const prepareInput = z.object({
  householdId: z.uuid(),
  contentType: z.string().max(100),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const completeInput = z.object({ noteId: z.uuid() });

const failureInput = z.object({
  noteId: z.uuid(),
  reason: z.enum(["storage_rejected", "network_error"]),
});

const SWEEP_LIMIT = 10;

function failure(code: NoteUploadErrorCode, message?: string): { ok: false; error: UploadFailure } {
  return { ok: false, error: { code, message: message ?? NOTE_UPLOAD_MESSAGES[code] } };
}

export function createNoteUploadService(deps: {
  store: NoteUploadStore;
  log: Logger;
  now?: () => Date;
  newId?: () => string;
}) {
  const { store, log } = deps;
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function safely<T>(label: string, fields: LogFields, fn: () => Promise<T>) {
    try {
      return await fn();
    } catch (error) {
      log("error", `note_upload.${label}_threw`, { ...fields, code: errorName(error) });
      return undefined;
    }
  }

  async function reject(
    user: SessionUser,
    householdId: string,
    stage: string,
    reason: string,
  ): Promise<void> {
    await safely("record_rejection", { household_id: householdId }, () =>
      store.recordRejection({ householdId, userId: user.id, stage, reason }),
    );
  }

  /** Claim → remove the object → audit. Never removes an object of a completed note. */
  async function failReservation(
    reservation: Pick<Reservation, "noteId" | "objectPath">,
    user: SessionUser,
    stage: string,
    reason: string,
    { removeObject = true } = {},
  ): Promise<void> {
    const fields = { note_id: reservation.noteId, stage, reason };
    const claimed = await safely("claim_failure", fields, () =>
      store.claimFailure(reservation.noteId, user.id),
    );
    if (!claimed) return;

    let removal: RemoveResult = "absent";
    if (removeObject) {
      removal =
        (await safely("remove_object", fields, () => store.removeObject(reservation.objectPath))) ??
        "error";
      if (removal === "error") {
        // The reservation stays failed; the expiry sweep retries the removal.
        log("warn", "note_upload.cleanup_deferred", fields);
      }
    }
    await safely("record_failure", fields, () =>
      store.recordFailure({
        noteId: reservation.noteId,
        userId: user.id,
        stage,
        reason,
        objectRemoved: removal === "removed",
      }),
    );
    log("warn", "note_upload.failed", { ...fields, user_id: user.id });
  }

  /** Removes objects of reservations nobody finished. Best effort, bounded. */
  async function sweepExpired(householdId: string): Promise<void> {
    const expired =
      (await safely("list_expired", { household_id: householdId }, () =>
        store.listExpiredReservations(householdId, SWEEP_LIMIT),
      )) ?? [];
    for (const item of expired) {
      const removal = await safely("sweep_remove", { note_id: item.noteId }, () =>
        store.removeObject(item.objectPath),
      );
      if (!removal || removal === "error") continue;
      await safely("sweep_expire", { note_id: item.noteId }, () =>
        store.expireReservation(item.noteId, removal === "removed"),
      );
    }
    if (expired.length > 0) {
      log("info", "note_upload.swept", { household_id: householdId, count: expired.length });
    }
  }

  async function prepare(
    user: SessionUser | null,
    rawInput: unknown,
  ): Promise<ServiceResult<{ noteId: string; objectPath: string; token: string }>> {
    if (!user) {
      log("warn", "note_upload.signed_out", { stage: "prepare" });
      return failure("signed_out");
    }
    const parsed = prepareInput.safeParse(rawInput);
    if (!parsed.success) {
      log("warn", "note_upload.invalid_request", { user_id: user.id, stage: "prepare" });
      return failure("invalid_request");
    }
    const { householdId, contentType, sizeBytes } = parsed.data;

    const membership = await safely("find_membership", { household_id: householdId }, () =>
      store.findMembership(user.id, householdId),
    );
    if (membership === undefined) return failure("unavailable");
    if (!membership) {
      // Not written to that household's audit trail: the person is not part of it.
      log("warn", "note_upload.not_member", { user_id: user.id, household_id: householdId });
      return failure("not_member");
    }
    if (!canUploadNotes(membership.role)) {
      await reject(user, householdId, "prepare", "role_not_allowed");
      return failure("not_allowed");
    }

    const declared = checkDeclaredNoteFile({ type: contentType, size: sizeBytes });
    if (!declared.ok) {
      await reject(user, householdId, "validate", declared.problem);
      return failure(declared.problem as NoteUploadErrorCode, declared.message);
    }

    await sweepExpired(householdId);

    const noteId = newId();
    const objectPath = buildNoteObjectPath(householdId, noteId, declared.contentType, now());
    const reserved =
      (await safely("reserve", { household_id: householdId }, () =>
        store.reserve({
          noteId,
          householdId,
          userId: user.id,
          objectPath,
          contentType: declared.contentType,
          sizeBytes,
        }),
      )) ?? "error";

    if (reserved === "not_allowed") {
      await reject(user, householdId, "prepare", "role_not_allowed");
      return failure("not_allowed");
    }
    if (reserved === "too_many_pending") {
      await reject(user, householdId, "prepare", "too_many_pending");
      return failure("too_many_pending");
    }
    if (reserved !== "ok") return failure("unavailable");

    const token = await safely("create_token", { note_id: noteId }, () =>
      store.createUploadToken(objectPath),
    );
    if (!token) {
      await failReservation({ noteId, objectPath }, user, "prepare", "signed_url_failed", {
        removeObject: false,
      });
      return failure("unavailable");
    }

    log("info", "note_upload.prepared", {
      user_id: user.id,
      household_id: householdId,
      note_id: noteId,
    });
    return { ok: true, noteId, objectPath, token };
  }

  async function complete(
    user: SessionUser | null,
    rawInput: unknown,
  ): Promise<ServiceResult<{ noteId: string }>> {
    if (!user) {
      log("warn", "note_upload.signed_out", { stage: "complete" });
      return failure("signed_out");
    }
    const parsed = completeInput.safeParse(rawInput);
    if (!parsed.success) return failure("invalid_request");
    const { noteId } = parsed.data;

    const reservation = await safely("find_reservation", { note_id: noteId }, () =>
      store.findReservation(noteId, user.id),
    );
    if (reservation === undefined) return failure("unavailable");
    if (
      !reservation ||
      !isNoteObjectPathFor(reservation.objectPath, reservation.householdId, noteId)
    ) {
      log("warn", "note_upload.reservation_not_found", { user_id: user.id, note_id: noteId });
      return failure("not_found");
    }
    if (reservation.status === "completed") return { ok: true, noteId };
    if (reservation.status !== "pending") return failure("expired");
    if (reservation.expiresAt.getTime() <= now().getTime()) {
      await failReservation(reservation, user, "verify", "expired");
      return failure("expired");
    }

    const stat = await safely("stat_object", { note_id: noteId }, () =>
      store.statObject(reservation.objectPath),
    );
    if (stat === undefined || stat === "error") return failure("unavailable");
    if (stat === "missing") {
      await failReservation(reservation, user, "verify", "object_missing", { removeObject: false });
      return failure("upload_failed");
    }
    if (
      stat.sizeBytes <= 0 ||
      stat.sizeBytes > MAX_NOTE_BYTES ||
      stat.contentType !== reservation.contentType
    ) {
      await failReservation(reservation, user, "verify", "object_invalid");
      return failure("verify_failed");
    }

    const head = await safely("read_head", { note_id: noteId }, () =>
      store.readObjectHead(reservation.objectPath, NOTE_SIGNATURE_BYTES),
    );
    if (!head) return failure("unavailable");
    if (sniffNoteImageType(head) !== reservation.contentType) {
      await failReservation(reservation, user, "verify", "content_mismatch");
      return failure("verify_failed");
    }

    const saved =
      (await safely("complete", { note_id: noteId }, () =>
        store.complete({
          noteId,
          userId: user.id,
          sizeBytes: stat.sizeBytes,
          contentType: reservation.contentType,
        }),
      )) ?? "error";

    switch (saved) {
      case "ok":
        log("info", "note_upload.completed", {
          user_id: user.id,
          household_id: reservation.householdId,
          note_id: noteId,
        });
        return { ok: true, noteId };
      case "not_pending": {
        // A retry may have completed it already.
        const latest = await safely("find_reservation", { note_id: noteId }, () =>
          store.findReservation(noteId, user.id),
        );
        return latest?.status === "completed" ? { ok: true, noteId } : failure("expired");
      }
      case "expired":
        await failReservation(reservation, user, "save", "expired");
        return failure("expired");
      case "not_allowed":
        await failReservation(reservation, user, "save", "role_not_allowed");
        return failure("not_allowed");
      default:
        // The database insert failed: remove the stored image so nothing is orphaned.
        await failReservation(reservation, user, "save", "db_insert_failed");
        return failure("save_failed");
    }
  }

  async function reportFailure(
    user: SessionUser | null,
    rawInput: unknown,
  ): Promise<ServiceResult<object>> {
    if (!user) {
      log("warn", "note_upload.signed_out", { stage: "upload" });
      return failure("signed_out");
    }
    const parsed = failureInput.safeParse(rawInput);
    if (!parsed.success) return failure("invalid_request");

    const reservation = await safely("find_reservation", { note_id: parsed.data.noteId }, () =>
      store.findReservation(parsed.data.noteId, user.id),
    );
    if (!reservation) return failure("not_found");
    if (reservation.status === "pending") {
      await failReservation(reservation, user, "upload", parsed.data.reason);
    }
    return { ok: true };
  }

  return { prepare, complete, reportFailure, sweepExpired };
}

export type NoteUploadService = ReturnType<typeof createNoteUploadService>;

function errorName(error: unknown): string {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "unknown";
}
