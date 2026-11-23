import Link from "next/link";
import type { ChangeEvent, FormEvent, Ref } from "react";

import { NOTE_FILE_ACCEPT } from "@/lib/notes/rules";
import { isUploadBusy, type UploadState } from "@/lib/notes/upload-state";
import { formatFileSize } from "@/lib/notes/validation";
import { ReadingFailed, ReadingInProgress, type ReadState } from "./read-note";

export type SelectedFile = { name: string; size: number };

const STATUS_TEXT = {
  idle: "",
  validating: "Checking the photo…",
  uploading: "Uploading the note. Please keep this page open.",
  uploaded: "Note uploaded.",
  failed: "",
} as const;

/**
 * Presentational upload form. All behavior lives in UploadNoteForm; this
 * component only turns a state into accessible markup, so every state can be
 * rendered and checked in tests.
 */
export function UploadNoteFormView({
  state,
  householdName,
  onSelect,
  onSubmit,
  onReset,
  successRef,
  reading = { phase: "idle" },
  onRetryReading,
  previewUrl = null,
}: {
  state: UploadState<SelectedFile>;
  householdName: string;
  onSelect?: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onReset?: () => void;
  successRef?: Ref<HTMLDivElement>;
  reading?: ReadState;
  onRetryReading?: () => void;
  previewUrl?: string | null;
}) {
  const busy = isUploadBusy(state);
  const error = state.status === "failed" ? state.error : null;
  const describedBy = ["note-file-help", error ? "note-file-error" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      aria-labelledby="upload-heading"
      className="app-panel"
      data-upload-state={state.status}
    >
      <h2 id="upload-heading" className="app-subtitle">
        Add a note
      </h2>

      {state.status === "uploaded" ? (
        <div ref={successRef} tabIndex={-1} className="app-success mt-5 grid gap-4">
          <p className="text-lg font-semibold">Note saved.</p>
          <p>Only members of {householdName} can see the photo.</p>
          {reading.phase === "reading" && <ReadingInProgress startedAt={reading.startedAt} />}
          {reading.phase === "failed" && <ReadingFailed message={reading.message} />}
          {reading.phase !== "reading" && (
            <div className="flex flex-wrap gap-3">
              {reading.phase === "failed" && onRetryReading && (
                <button type="button" className="app-button" onClick={onRetryReading}>
                  Try reading again
                </button>
              )}
              <Link
                href={`/notes/${state.noteId}`}
                className={reading.phase === "failed" && onRetryReading ? "app-button app-button--quiet" : "app-button"}
              >
                {reading.phase === "failed" && !onRetryReading ? "Open the note to try again" : "Open the note"}
              </Link>
              <button type="button" className="app-button app-button--quiet" onClick={onReset}>
                Upload another note
              </button>
            </div>
          )}
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={busy} className="mt-5 grid gap-5">
          <div className="grid gap-2">
            <label htmlFor="note-file" className="app-label">
              Upload a handwritten note <span className="app-required">(required)</span>
            </label>
            <p id="note-file-help" className="app-hint">
              Take a clear photo of the whole note, or choose one you already have. Fudepan then
              reads it and drafts care steps for your family to check. JPEG, PNG, or WebP, up to 10
              MB. Only members of {householdName} can see it.
            </p>
            <input
              id="note-file"
              name="note"
              type="file"
              accept={NOTE_FILE_ACCEPT}
              required
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              disabled={busy}
              onChange={onSelect}
              className="app-file"
            />
            {state.file && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL, never leaves the device
              <img
                src={previewUrl}
                alt="Preview of the photo you chose. Check it shows the whole note."
                className="app-note-preview"
              />
            )}
            {state.file && (
              <p className="app-hint" data-selected-file>
                Selected photo: <span className="font-semibold text-ink">{state.file.name}</span> (
                {formatFileSize(state.file.size)})
              </p>
            )}
          </div>

          {error && (
            <div id="note-file-error" role="alert" className="app-alert">
              <p className="app-alert__title">The note was not uploaded</p>
              <p>{error.message}</p>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4">
            <button type="submit" className="app-button" disabled={busy}>
              {state.status === "validating"
                ? "Checking…"
                : state.status === "uploading"
                  ? "Uploading…"
                  : error && state.file
                    ? "Try again"
                    : "Upload and read note"}
            </button>
            <p role="status" aria-live="polite" className="app-hint">
              {STATUS_TEXT[state.status]}
            </p>
          </div>
        </form>
      )}

      <noscript>
        <p className="app-alert mt-5">
          Uploading a note needs JavaScript. Turn it on, then reload.
        </p>
      </noscript>
    </section>
  );
}
