import Link from "next/link";
import type { ChangeEvent, DragEvent, FormEvent, Ref } from "react";
import { isUploadBusy, type UploadState } from "@/lib/notes/upload-state";
import { NOTE_FILE_ACCEPT } from "@/lib/notes/rules";
import type { Translator } from "@/lib/i18n/messages";
import { Icon, Tape } from "../playful/ui";

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

export type CaptureViewHandlers = {
  /** One chosen, captured or dropped photo (or null). The same path for every way of choosing. */
  onPick?: (file: File | null) => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
  onReset?: () => void;
  onDragState?: (active: boolean) => void;
};

/**
 * Presentational capture screen: a paper inbox that takes a photo, then an instant-print preview
 * with an explicit send. All behavior lives in CaptureForm; this turns a state into accessible
 * markup so every state can be rendered and checked in tests.
 */
export function CaptureFormView({
  state,
  tr,
  onPick,
  onSubmit,
  onReset,
  onDragState,
  successRef,
  previewUrl = null,
  dragging = false,
}: {
  state: UploadState<CaptureFile>;
  tr: Translator;
  successRef?: Ref<HTMLDivElement>;
  previewUrl?: string | null;
  dragging?: boolean;
} & CaptureViewHandlers) {
  const busy = isUploadBusy(state);
  const error = state.status === "failed" ? state.error : null;
  const photoProblem = error ? PHOTO_PROBLEMS.has(error.code) : false;
  const hasPreview = Boolean(state.file && previewUrl && !photoProblem);
  const statusText =
    state.status === "validating"
      ? tr.t("capture.checking")
      : state.status === "uploading"
        ? tr.t("capture.sending")
        : "";
  const describedBy = ["capture-hint", error ? "capture-error" : null].filter(Boolean).join(" ");
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    onPick?.(event.currentTarget.files?.[0] ?? null);
    // The same photo can be chosen again after a retake.
    event.currentTarget.value = "";
  };
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    onDragState?.(false);
    if (busy) return;
    // One photo at a time: the first file only.
    onPick?.(event.dataTransfer?.files?.[0] ?? null);
  };

  if (state.status === "uploaded") {
    return (
      <section aria-labelledby="capture-heading" className="pb-capture" data-capture-state={state.status}>
        <h1 id="capture-heading" className="pb-title">
          <span className="pb-title__mark">{tr.t("pb.capture.sentTitle")}</span>
        </h1>
        <div ref={successRef} tabIndex={-1} role="status" className="pb-capture__sent">
          <p className="pb-capture__sentText">{tr.t("capture.sent")}</p>
          <p className="pb-capture__reading">
            <span className="pb-spinner" aria-hidden="true" /> {tr.t("pb.capture.reading")} {tr.t("pb.capture.opening")}
          </p>
          <div className="pb-capture__row">
            <Link href={`/family/events/${state.noteId}`} className="pb-btn pb-btn--ink">
              {tr.t("pb.capture.open")}
            </Link>
            <button type="button" className="pb-btn pb-btn--outline" onClick={onReset}>
              {tr.t("capture.another")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="capture-heading"
      className={`pb-capture ${hasPreview ? "pb-capture--preview" : ""}`}
      data-capture-state={state.status}
    >
      <Link href="/family" className="pb-back">
        <Icon name="chevronLeft" size={20} /> {tr.t("pb.capture.back")}
      </Link>
      <form onSubmit={onSubmit} noValidate aria-busy={busy} className="pb-capture__form">
        <h1 id="capture-heading" className="pb-title">
          <span className="pb-title__mark">{hasPreview ? tr.t("pb.capture.previewTitle") : tr.t("pb.capture.title")}</span>
        </h1>
        <p id="capture-hint" className="pb-capture__lede">
          {hasPreview ? tr.t("pb.capture.check") : tr.t("pb.capture.lede")}
        </p>

        {/* Both inputs exist in every state, so "retake" and "choose again" use the same fields. */}
        <input
          id="capture-camera"
          name="photo"
          type="file"
          accept="image/*"
          capture="environment"
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          disabled={busy}
          onChange={onChange}
          className="pb-file"
        />
        <input
          id="capture-choose"
          name="existing"
          type="file"
          accept={NOTE_FILE_ACCEPT}
          aria-describedby={describedBy}
          disabled={busy}
          onChange={onChange}
          className="pb-file"
        />

        {!hasPreview && (
          <div className="pb-capture__start">
            <label htmlFor="capture-camera" className="pb-btn pb-btn--outline pb-capture__camera">
              <Icon name="camera" size={24} /> {tr.t("pb.capture.camera")}
            </label>
            {/* Narrow screens: this second label for the same input sits with the camera button; the one inside the inbox is hidden there. */}
            <label htmlFor="capture-choose" className="pb-btn pb-btn--ink pb-capture__choose">
              {tr.t("pb.capture.choose")}
            </label>
            <div
              role="group"
              aria-label={tr.t("pb.capture.inboxLabel")}
              className={`pb-inbox ${dragging ? "pb-inbox--over" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                onDragState?.(true);
              }}
              onDragLeave={() => onDragState?.(false)}
              onDrop={drop}
            >
              <div className="pb-inbox__front">
                <p className="pb-inbox__drop">{dragging ? tr.t("pb.capture.dropActive") : tr.t("pb.capture.drop")}</p>
                <label htmlFor="capture-choose" className="pb-btn pb-btn--ink pb-inbox__choose">
                  {tr.t("pb.capture.choose")}
                </label>
                <p className="pb-inbox__limits">{tr.t("pb.capture.limits")}</p>
              </div>
            </div>
          </div>
        )}

        {hasPreview && (
          <div className="pb-preview">
            <div className="pb-preview__frame">
              <Tape tone="mint" className="pb-preview__tape pb-preview__tape--a" />
              <Tape tone="apricot" className="pb-preview__tape pb-preview__tape--b" />
              <span className="pb-preview__corner pb-preview__corner--tl" aria-hidden="true" />
              <span className="pb-preview__corner pb-preview__corner--tr" aria-hidden="true" />
              <span className="pb-preview__corner pb-preview__corner--bl" aria-hidden="true" />
              <span className="pb-preview__corner pb-preview__corner--br" aria-hidden="true" />
              <div className="pb-preview__photo">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL, never leaves the device */}
                <img src={previewUrl ?? ""} alt={tr.t("capture.previewAlt")} />
                <span className="pb-preview__badge">{tr.t("pb.capture.previewBadge")}</span>
              </div>
            </div>
            <div className="pb-preview__swap">
              <label htmlFor="capture-camera" className="pb-linkbtn">
                <Icon name="refresh" size={24} /> {tr.t("pb.capture.retake")}
              </label>
              <label htmlFor="capture-choose" className="pb-linkbtn">
                <Icon name="image" size={24} /> {tr.t("pb.capture.reselect")}
              </label>
            </div>
          </div>
        )}

        {error && (
          <div id="capture-error" role="alert" className="pb-capture__error">
            <p className="pb-capture__errorTitle">{tr.t("capture.errorTitle")}</p>
            <p>{captureErrorMessage(error, tr)}</p>
          </div>
        )}

        {state.file && hasPreview && (
          <div className="pb-capture__send">
            <button type="submit" className="pb-btn pb-btn--ink pb-btn--wide" disabled={busy}>
              {state.status === "validating"
                ? tr.t("capture.checking")
                : state.status === "uploading"
                  ? tr.t("capture.sending")
                  : error
                    ? tr.t("capture.retryUpload")
                    : tr.t("capture.send")}
            </button>
            <p data-privacy className="pb-capture__privacy">
              {tr.t("capture.privacy")}
            </p>
          </div>
        )}
        <p role="status" aria-live="polite" className="pb-capture__status">
          {statusText}
        </p>
      </form>
      <noscript>
        <p className="pb-capture__error">{tr.t("capture.noScript")}</p>
      </noscript>
    </section>
  );
}
