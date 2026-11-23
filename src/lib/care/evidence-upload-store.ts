import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { errorCode, log } from "@/lib/log";
import { readFirstBytes } from "@/lib/notes/upload-store";
import type { Database } from "@/lib/supabase/database.types";

import { EVIDENCE_BUCKET, type EvidenceUploadStore } from "./evidence-upload";

type Client = SupabaseClient<Database>;

const SERVER_READ_URL_SECONDS = 60;

function isMissingObject(error: unknown): boolean {
  const e = error as { status?: number; statusCode?: string; code?: string } | null;
  return e?.status === 404 || e?.statusCode === "404" || e?.code === "NoSuchKey";
}

/**
 * Supabase implementation of the evidence store. `userClient` acts as the
 * signed-in person (row-level security) and only reads the Part. `admin`
 * (service role) touches Storage only.
 */
export function createSupabaseEvidenceUploadStore({
  userClient,
  admin,
  fetchImpl = fetch,
}: {
  userClient: Client;
  admin: Client;
  fetchImpl?: typeof fetch;
}): EvidenceUploadStore {
  const bucket = () => admin.storage.from(EVIDENCE_BUCKET);

  return {
    async findStepHousehold(stepId) {
      const { data, error } = await userClient
        .from("care_steps")
        .select("id, care_chains!inner ( household_id )")
        .eq("id", stepId)
        .maybeSingle();
      if (error) throw new Error("step_query_failed");
      if (!data) return null;
      const chain = Array.isArray(data.care_chains) ? data.care_chains[0] : data.care_chains;
      return chain?.household_id ?? null;
    },

    async createUploadToken(objectPath) {
      const { data, error } = await bucket().createSignedUploadUrl(objectPath);
      if (error) {
        log("error", "evidence_upload.token_failed", { code: errorCode(error) });
        return null;
      }
      return data.token;
    },

    async statObject(objectPath) {
      const { data, error } = await bucket().info(objectPath);
      if (error) {
        if (isMissingObject(error)) return "missing";
        log("error", "evidence_upload.stat_failed", { code: errorCode(error) });
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

    async removeObject(objectPath) {
      const { data, error } = await bucket().remove([objectPath]);
      if (error) {
        log("error", "evidence_upload.remove_failed", { code: errorCode(error) });
        return "error";
      }
      return data.length > 0 ? "removed" : "absent";
    },
  };
}
