"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";

import {
  addTextEvidence,
  claimPart,
  completeEvidenceUpload,
  completePart,
  confirmPartTime,
  decideApproval,
  prepareEvidenceUpload,
  releasePart,
  reopenPart,
  reportPartFailed,
  requestAssignment,
  requestBackup,
  requestHandover,
  resolveMissingDetail,
  respondToRequest,
  resubmitPart,
  retryRecognition,
  saveAppointmentDetails,
  savePartAmount,
  volunteerBackup,
} from "@/app/(family)/family/actions";
import { createClient } from "@/lib/supabase/client";

import { ThreadView, type ThreadViewProps } from "./thread-view";
import type { EventActions } from "./event-runner";

/** Private bucket that holds Evidence files (same name as the server's EVIDENCE_BUCKET). */
const EVIDENCE_BUCKET = "evidence";

async function uploadEvidenceFile(objectPath: string, token: string, file: File): Promise<boolean> {
  const { error } = await createClient()
    .storage.from(EVIDENCE_BUCKET)
    .uploadToSignedUrl(objectPath, token, file, { contentType: file.type, upsert: false });
  return !error;
}

/** The Event_View, shown as the family thread, wired to the real Server Actions and the router. */
export function ConnectedEventView(props: Omit<ThreadViewProps, "actions" | "onChanged">) {
  const router = useRouter();
  const onChanged = useCallback(() => router.refresh(), [router]);
  const actions: EventActions = useMemo(
    () => ({
      claimPart,
      releasePart,
      requestAssignment,
      requestHandover,
      requestBackup,
      volunteerBackup,
      respondToRequest,
      decideApproval,
      resubmitPart,
      completePart,
      reportPartFailed,
      reopenPart,
      confirmPartTime,
      resolveMissingDetail,
      addTextEvidence,
      prepareEvidenceUpload,
      completeEvidenceUpload,
      uploadEvidenceFile,
      saveAppointment: saveAppointmentDetails,
      savePartAmount,
      retryRecognition,
    }),
    [],
  );
  return <ThreadView {...props} actions={actions} onChanged={onChanged} />;
}
