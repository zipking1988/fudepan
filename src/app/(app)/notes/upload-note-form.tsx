"use client";

import { useRouter } from "next/navigation";
import { useEffect, useReducer, useRef, type ChangeEvent, type FormEvent } from "react";

import { NOTE_UPLOAD_MESSAGES } from "@/lib/notes/messages";
import { NOTES_BUCKET } from "@/lib/notes/rules";
import {
  initialUploadState,
  isUploadBusy,
  uploadReducer,
  type UploadError,
} from "@/lib/notes/upload-state";
import { NOTE_SIGNATURE_BYTES, checkNoteFile } from "@/lib/notes/validation";
import { createClient } from "@/lib/supabase/client";

import { completeNoteUpload, prepareNoteUpload, reportNoteUploadFailure } from "./actions";
import { UploadNoteFormView } from "./upload-note-form-view";

const UNREADABLE: UploadError = {
  code: "unreadable",
  message: "Fudepan could not open the selected file. Choose the photo again.",
};

/**
 * Upload flow: check the file in the browser, ask the server for a one-path
 * upload token, send the image straight to private Storage (it never passes
 * through Vercel, which caps request bodies at 4.5 MB), then ask the server to
 * verify and save it. The file stays selected through any failure.
 */
export function UploadNoteForm({
  householdId,
  householdName,
}: {
  householdId: string;
  householdName: string;
}) {
  const [state, dispatch] = useReducer(uploadReducer<File>, undefined, initialUploadState<File>);
  const router = useRouter();
  const successRef = useRef<HTMLDivElement>(null);

  // Move focus to the result so keyboard and screen reader users land on the next step.
  useEffect(() => {
    if (state.status === "uploaded") successRef.current?.focus();
  }, [state.status]);

  async function upload(file: File) {
    let head: Uint8Array;
    try {
      head = new Uint8Array(await file.slice(0, NOTE_SIGNATURE_BYTES).arrayBuffer());
    } catch {
      dispatch({ type: "failed", error: UNREADABLE });
      return;
    }

    const check = checkNoteFile({ type: file.type, size: file.size }, head);
    if (!check.ok) {
      dispatch({ type: "failed", error: { code: check.problem, message: check.message } });
      return;
    }
    dispatch({ type: "validated" });

    const prepared = await prepareNoteUpload({
      householdId,
      contentType: check.contentType,
      sizeBytes: file.size,
    });
    if (!prepared.ok) {
      dispatch({ type: "failed", error: prepared.error });
      return;
    }

    const { error: uploadError } = await createClient()
      .storage.from(NOTES_BUCKET)
      .uploadToSignedUrl(prepared.objectPath, prepared.token, file, {
        contentType: check.contentType,
        upsert: false,
      });
    if (uploadError) {
      await reportNoteUploadFailure({
        noteId: prepared.noteId,
        reason: navigator.onLine ? "storage_rejected" : "network_error",
      }).catch(() => undefined);
      dispatch({
        type: "failed",
        error: { code: "upload_failed", message: NOTE_UPLOAD_MESSAGES.upload_failed },
      });
      return;
    }

    const completed = await completeNoteUpload({ noteId: prepared.noteId });
    if (!completed.ok) {
      dispatch({ type: "failed", error: completed.error });
      return;
    }

    dispatch({ type: "succeeded", noteId: completed.noteId });
    router.refresh();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploadBusy(state)) return;
    dispatch({ type: "submit" });
    if (!state.file) return;
    upload(state.file).catch(() =>
      dispatch({
        type: "failed",
        error: { code: "unavailable", message: NOTE_UPLOAD_MESSAGES.unavailable },
      }),
    );
  }

  function handleSelect(event: ChangeEvent<HTMLInputElement>) {
    dispatch({ type: "select", file: event.currentTarget.files?.[0] ?? null });
  }

  return (
    <UploadNoteFormView
      state={state}
      householdName={householdName}
      onSelect={handleSelect}
      onSubmit={handleSubmit}
      onReset={() => dispatch({ type: "reset" })}
      successRef={successRef}
    />
  );
}
