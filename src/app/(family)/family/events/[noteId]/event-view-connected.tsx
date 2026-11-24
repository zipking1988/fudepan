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

import { EventDetail, type EventDetailProps } from "../../playful/event-detail";
import type { EventActions } from "./event-runner";

/** Private bucket that holds Evidence files (same name as the server's EVIDENCE_BUCKET). */
const EVIDENCE_BUCKET = "evidence";

async function uploadEvidenceFile(objectPath: string, token: string, file: File): Promise<boolean> {
  const { error } = await createClient()
    .storage.from(EVIDENCE_BUCKET)
    .uploadToSignedUrl(objectPath, token, file, { contentType: file.type, upsert: false });
  return !error;
}

/** The real Server Actions for one event, and a refresh that re-reads the current page in place. */
export function useEventActions(): { actions: EventActions; onChanged: () => void } {
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
  return { actions, onChanged };
}
/** The Event_View as the playful task board, wired to the real Server Actions and the router. */
export function ConnectedEventView(props: Omit<EventDetailProps, "actions" | "onChanged">) {
  const { actions, onChanged } = useEventActions();
  return <EventDetail {...props} actions={actions} onChanged={onChanged} />;
}
