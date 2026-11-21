import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isHouseholdRole } from "@/lib/households/membership";
import { errorCode, log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

import { NOTES_BUCKET, isNoteContentType } from "./rules";
import type { NoteUploadStore, Reservation, ReservationStatus } from "./upload-service";

type Client = SupabaseClient<Database>;

const STATUSES: readonly ReservationStatus[] = [
  "pending",
  "failing",
  "failed",
  "completed",
  "expired",
];

/** Signed read URLs used server-side to read a few bytes or stream an image. */
const SERVER_READ_URL_SECONDS = 60;

function rpcCode(error: { message?: string } | null): string | null {
  return error?.message && /^[a-z_]{1,40}$/.test(error.message) ? error.message : null;
}

function isMissingObject(error: unknown): boolean {
  const e = error as { status?: number; statusCode?: string; code?: string } | null;
  return e?.status === 404 || e?.statusCode === "404" || e?.code === "NoSuchKey";
}

/**
 * Supabase implementation of the upload store.
 *
 * `userClient` acts as the signed-in person (row-level security applies) and
 * is used only to confirm membership. `admin` uses the service role and is
 * used only for Storage and the upload functions, which browser roles cannot
 * call. Every admin call is scoped to a reservation the service has verified.
 */
export function createSupabaseNoteUploadStore({
  userClient,
  admin,
  fetchImpl = fetch,
}: {
  userClient: Client;
  admin: Client;
  fetchImpl?: typeof fetch;
}): NoteUploadStore {
  const bucket = () => admin.storage.from(NOTES_BUCKET);

  async function rpcVoid(name: string, call: PromiseLike<{ error: { message?: string } | null }>) {
    const { error } = await call;
    if (error) {
      log("error", "note_upload.rpc_failed", {
        stage: name,
        code: rpcCode(error) ?? errorCode(error),
      });
      throw new Error("rpc_failed");
    }
  }

  return {
    async findMembership(userId, householdId) {
      const { data, error } = await userClient
        .from("household_members")
        .select("role")
        .eq("household_id", householdId)
        .eq("user_id", userId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw new Error("membership_query_failed");
      return data && isHouseholdRole(data.role) ? { role: data.role } : null;
    },

    async recordRejection({ householdId, userId, stage, reason }) {
      await rpcVoid(
        "record_rejection",
        admin.rpc("record_note_upload_rejection", {
          p_household_id: householdId,
          p_user_id: userId,
          p_stage: stage,
          p_reason: reason,
        }),
      );
    },

    async reserve({ noteId, householdId, userId, objectPath, contentType, sizeBytes }) {
      const { error } = await admin.rpc("reserve_note_upload", {
        p_note_id: noteId,
        p_household_id: householdId,
        p_user_id: userId,
        p_object_path: objectPath,
        p_content_type: contentType,
        p_size_bytes: sizeBytes,
      });
      if (!error) return "ok";
      const code = rpcCode(error);
      if (code === "not_allowed" || code === "too_many_pending") return code;
      log("error", "note_upload.reserve_failed", {
        note_id: noteId,
        code: code ?? errorCode(error),
      });
      return "error";
    },

    async createUploadToken(objectPath) {
      const { data, error } = await bucket().createSignedUploadUrl(objectPath);
      if (error) {
        log("error", "note_upload.token_failed", { code: errorCode(error) });
        return null;
      }
      return data.token;
    },

    async findReservation(noteId, userId) {
      const { data, error } = await admin
        .from("note_uploads")
        .select("note_id, household_id, uploaded_by, object_path, content_type, status, expires_at")
        .eq("note_id", noteId)
        .eq("uploaded_by", userId)
        .maybeSingle();
      if (error) throw new Error("reservation_query_failed");
      if (!data) return null;
      if (!isNoteContentType(data.content_type)) return null;
      if (!(STATUSES as readonly string[]).includes(data.status)) return null;
      const reservation: Reservation = {
        noteId: data.note_id,
        householdId: data.household_id,
        uploadedBy: data.uploaded_by,
        objectPath: data.object_path,
        contentType: data.content_type,
        status: data.status as ReservationStatus,
        expiresAt: new Date(data.expires_at),
      };
      return reservation;
    },

    async statObject(objectPath) {
      const { data, error } = await bucket().info(objectPath);
      if (error) {
        if (isMissingObject(error)) return "missing";
        log("error", "note_upload.stat_failed", { code: errorCode(error) });
        return "error";
      }
      if (typeof data.size !== "number") return "error";
      return { sizeBytes: data.size, contentType: data.contentType ?? null };
    },

    async readObjectHead(objectPath, bytes) {
      const { data, error } = await bucket().createSignedUrl(objectPath, SERVER_READ_URL_SECONDS);
      if (error) return null;
      const response = await fetchImpl(data.signedUrl, {
        headers: { Range: `bytes=0-${bytes - 1}` },
        cache: "no-store",
      });
      if (!response.ok || !response.body) return null;
      return readFirstBytes(response.body, bytes);
    },

    async complete({ noteId, userId, sizeBytes, contentType }) {
      const { error } = await admin.rpc("complete_note_upload", {
        p_note_id: noteId,
        p_user_id: userId,
        p_size_bytes: sizeBytes,
        p_content_type: contentType,
      });
      if (!error) return "ok";
      const code = rpcCode(error);
      if (code === "upload_not_pending") return "not_pending";
      if (code === "upload_expired") return "expired";
      if (code === "not_allowed") return "not_allowed";
      log("error", "note_upload.complete_failed", {
        note_id: noteId,
        code: code ?? errorCode(error),
      });
      return "error";
    },

    async claimFailure(noteId, userId) {
      const { data, error } = await admin.rpc("claim_note_upload_failure", {
        p_note_id: noteId,
        p_user_id: userId,
      });
      if (error) throw new Error("claim_failed");
      return data === true;
    },

    async removeObject(objectPath) {
      const { data, error } = await bucket().remove([objectPath]);
      if (error) {
        log("error", "note_upload.remove_failed", { code: errorCode(error) });
        return "error";
      }
      return data.length > 0 ? "removed" : "absent";
    },

    async recordFailure({ noteId, userId, stage, reason, objectRemoved }) {
      await rpcVoid(
        "record_failure",
        admin.rpc("record_note_upload_failure", {
          p_note_id: noteId,
          p_user_id: userId,
          p_stage: stage,
          p_reason: reason,
          p_object_removed: objectRemoved,
        }),
      );
    },

    async listExpiredReservations(householdId, limit) {
      const { data, error } = await admin
        .from("note_uploads")
        .select("note_id, object_path")
        .eq("household_id", householdId)
        .in("status", ["pending", "failing", "failed"])
        .lt("expires_at", new Date().toISOString())
        .order("expires_at")
        .limit(limit);
      if (error) throw new Error("expired_query_failed");
      return data.map((row) => ({ noteId: row.note_id, objectPath: row.object_path }));
    },

    async expireReservation(noteId, objectRemoved) {
      await rpcVoid(
        "expire",
        admin.rpc("expire_note_upload", { p_note_id: noteId, p_object_removed: objectRemoved }),
      );
    },
  };
}

/**
 * Reads at most `count` bytes, then stops the download.
 *
 * The cancel is deliberately not awaited: Next.js tees fetch response bodies,
 * and cancelling one branch of a tee only settles once the other branch is
 * cancelled too, so awaiting it would hang the request.
 */
export async function readFirstBytes(
  body: ReadableStream<Uint8Array>,
  count: number,
): Promise<Uint8Array> {
  const reader = body.getReader();
  const out = new Uint8Array(count);
  let filled = 0;
  try {
    while (filled < count) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.length, count - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out.subarray(0, filled);
}
