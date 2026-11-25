"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import { completeNoteUpload, prepareNoteUpload, reportNoteUploadFailure } from "@/app/(app)/notes/actions";
import { createTranslator, type Language } from "@/lib/i18n/messages";
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
import { CaptureFormView, SAMPLE_NOTE } from "./capture-form-view";

/** How long "Sent to your family" stays on screen before the event opens. */
const REDIRECT_DELAY_MS = 3000;

const UNREADABLE: UploadError = {
  code: "unreadable",
  message: "This photo could not be opened. Take the photo again.",
};

/**
 * Capture flow. It reuses the notes pipeline: check the photo in the browser, ask the server for
 * a one-path token, send the photo straight to private Storage, then ask the server to verify and
 * save it (which also starts reading). The photo stays selected through any failure.
 */
export function CaptureForm({ householdId, language }: { householdId: string; language: Language }) {
  const tr = useMemo(() => createTranslator(language), [language]);
  const [state, dispatch] = useReducer(uploadReducer<File>, undefined, initialUploadState<File>);
  const router = useRouter();
  const [dragging, setDragging] = useState(false);
  const successRef = useRef<HTMLDivElement>(null);

  const previewUrl = useMemo(() => (state.file ? URL.createObjectURL(state.file) : null), [state.file]);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  // Land on the result, then open the event after a moment.
  const savedNoteId = state.status === "uploaded" ? state.noteId : null;
  useEffect(() => {
    if (!savedNoteId) return;
    successRef.current?.focus();
    const timer = setTimeout(() => router.push(`/family/events/${savedNoteId}`), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [savedNoteId, router]);

  async function send(file: File) {
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
    const { error: storageError } = await createClient()
      .storage.from(NOTES_BUCKET)
      .uploadToSignedUrl(prepared.objectPath, prepared.token, file, {
        contentType: check.contentType,
        upsert: false,
      });
    if (storageError) {
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
    // The success message only appears after the server has saved the note.
    const completed = await completeNoteUpload({ noteId: prepared.noteId });
    if (!completed.ok) {
      dispatch({ type: "failed", error: completed.error });
      return;
    }
    dispatch({ type: "succeeded", noteId: completed.noteId });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isUploadBusy(state)) return;
    dispatch({ type: "submit" });
    if (!state.file) return;
    send(state.file).catch(() =>
      dispatch({
        type: "failed",
        error: { code: "unavailable", message: NOTE_UPLOAD_MESSAGES.unavailable },
      }),
    );
  }

  /**
   * Camera, photo picker and drag-and-drop all arrive here, so they share one check and one
   * preview. A photo that cannot be used shows its problem at once instead of after "Send".
   */
  async function handlePick(file: File | null) {
    dispatch({ type: "select", file });
    if (!file) return;
    let head: Uint8Array;
    try {
      head = new Uint8Array(await file.slice(0, NOTE_SIGNATURE_BYTES).arrayBuffer());
    } catch {
      dispatch({ type: "submit" });
      dispatch({ type: "failed", error: UNREADABLE });
      return;
    }
    const check = checkNoteFile({ type: file.type, size: file.size }, head);
    if (!check.ok) {
      dispatch({ type: "submit" });
      dispatch({ type: "failed", error: { code: check.problem, message: check.message } });
    }
  }

  /** Loads the sample note as if it had been chosen, so it shows the same preview before anything is sent. */
  async function handleSample() {
    try {
      const response = await fetch(SAMPLE_NOTE.src);
      if (!response.ok) throw new Error("sample unavailable");
      const blob = await response.blob();
      await handlePick(new File([blob], SAMPLE_NOTE.name, { type: SAMPLE_NOTE.type }));
    } catch {
      dispatch({ type: "submit" });
      dispatch({ type: "failed", error: { code: "sample_failed", message: "The sample note could not be loaded." } });
    }
  }
  return (
    <CaptureFormView
      state={state}
      tr={tr}
      onPick={(file) => void handlePick(file)}
      onSample={() => void handleSample()}
      onSubmit={handleSubmit}
      dragging={dragging}
      onDragState={setDragging}
      onReset={() => dispatch({ type: "reset" })}
      successRef={successRef}
      previewUrl={previewUrl}
    />
  );
}
