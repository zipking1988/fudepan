import Link from "next/link";
import type { ChangeEvent, FormEvent, Ref } from "react";
import { isUploadBusy, type UploadState } from "@/lib/notes/upload-state";
import { NOTE_FILE_ACCEPT } from "@/lib/notes/rules";
import type { Translator } from "@/lib/i18n/messages";

export type CaptureFile = { name: string; size: number };

/** Problems with the photo itself. Sending it again would fail the same way. */
const PHOTO_PROBLEMS = new Set(["no_file", "empty", "too_large", "unsupported_type", "not_an_image", "unreadable"]);

/** The message shown for an error: the photo's own problem, or a translated plain sentence. */
export function captureErrorMessage(error: { code: string; message: string }, tr: Translator): string {
  if (PHOTO_PROBLEMS.has(error.code)) return error.message;
  if (error.code === "signed_out") return tr.t("capture.signedOut");
  if (error.code === "not_allowed" || error.code === "not_member") return tr.t("capture.notAllowed");
  return tr.t("capture.sendFailed");
}

/**
 * Presentational Capture_Screen. All behavior lives in CaptureForm; this turns a state into
 * accessible markup so every state can be rendered and checked in tests.
 */
export function CaptureFormView({
  state,
  tr,
  onSelect,
  onSubmit,
  onReset,
  successRef,
  previewUrl = null,
}: {
  state: UploadState<CaptureFile>;
  tr: Translator;
  onSelect?: (event: ChangeEvent<HTMLInputElement>) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onReset?: () => void;
  successRef?: Ref<HTMLDivElement>;
  previewUrl?: string | null;
}) {
  const busy = isUploadBusy(state);
  const error = state.status === "failed" ? state.error : null;
  const photoProblem = error ? PHOTO_PROBLEMS.has(error.code) : false;
  const statusText =
    state.status === "validating"
      ? tr.t("capture.checking")
      : state.status === "uploading"
        ? tr.t("capture.sending")
        : "";
  const describedBy = ["capture-hint", error ? "capture-error" : null].filter(Boolean).join(" ");

  return (
    <section
      aria-labelledby="capture-heading"
      className="app-panel family-capture"
      data-capture-state={state.status}
    >
      <h1 id="capture-heading" className="app-subtitle">
        {tr.t("capture.title")}
      </h1>
      {state.status === "uploaded" ? (
        <div ref={successRef} tabIndex={-1} role="status" className="app-success mt-5 grid gap-4">
          <p className="font-semibold">{tr.t("capture.sent")}</p>
          <div className="flex flex-wrap gap-3">
            <Link href={`/family/events/${state.noteId}`} className="app-button">
              {tr.t("capture.seeIt")}
            </Link>
            <button type="button" className="app-button app-button--quiet" onClick={onReset}>
              {tr.t("capture.another")}
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate aria-busy={busy} className="mt-5 grid gap-5">
          <div className="grid gap-2">
            <label htmlFor="capture-camera" className="app-label">
              {tr.t("capture.label")} <span className="app-required">{tr.t("capture.required")}</span>
            </label>
            <p id="capture-hint" className="app-hint">
              {tr.t("capture.hint")}
            </p>
            <input
              id="capture-camera"
              name="photo"
              type="file"
              accept="image/*"
              capture="environment"
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={describedBy}
              disabled={busy}
              onChange={onSelect}
              className="app-file family-capture__camera"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="capture-choose" className="app-label">
              {tr.t("capture.choosePhoto")}
            </label>
            <p id="capture-choose-hint" className="app-hint">
              {tr.t("capture.chooseHint")}
            </p>
            <input
              id="capture-choose"
              name="existing"
              type="file"
              accept={NOTE_FILE_ACCEPT}
              aria-describedby="capture-choose-hint"
              disabled={busy}
              onChange={onSelect}
              className="app-file family-capture__camera"
            />
          </div>
          {state.file && previewUrl && (
            <div className="grid gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, never leaves the device */}
              <img
                src={previewUrl}
                alt={tr.t("capture.previewAlt")}
                className="app-note-preview family-capture__preview"
              />
              <p data-privacy className="app-hint">
                {tr.t("capture.privacy")}
              </p>
            </div>
          )}
          {error && (
            <div id="capture-error" role="alert" className="app-alert">
              <p className="app-alert__title">{tr.t("capture.errorTitle")}</p>
              <p>{captureErrorMessage(error, tr)}</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4">
            {state.file && !photoProblem && (
              <button type="submit" className="app-button" disabled={busy}>
                {state.status === "validating"
                  ? tr.t("capture.checking")
                  : state.status === "uploading"
                    ? tr.t("capture.sending")
                    : error
                      ? tr.t("capture.retryUpload")
                      : tr.t("capture.send")}
              </button>
            )}
            <p role="status" aria-live="polite" className="app-hint">
              {statusText}
            </p>
          </div>
        </form>
      )}
      <noscript>
        <p className="app-alert mt-5">{tr.t("capture.noScript")}</p>
      </noscript>
    </section>
  );
}
