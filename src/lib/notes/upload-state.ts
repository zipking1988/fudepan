/**
 * Upload form state. Generic over the file type so it can be tested without a DOM.
 *
 *   idle ──submit──▶ validating ──validated──▶ uploading ──succeeded──▶ uploaded
 *                        │                         │
 *                        └────────failed───────────┴──▶ failed ──submit (retry)──▶ validating
 *
 * The selected file is kept through validation failures and upload failures,
 * so "Try again" never asks the person to find the photo again.
 */

export type UploadError = { code: string; message: string };

export type UploadState<F> =
  | { status: "idle"; file: F | null }
  | { status: "validating"; file: F }
  | { status: "uploading"; file: F }
  | { status: "uploaded"; file: null; noteId: string }
  | { status: "failed"; file: F | null; error: UploadError };

export type UploadEvent<F> =
  | { type: "select"; file: F | null }
  | { type: "submit" }
  | { type: "validated" }
  | { type: "failed"; error: UploadError }
  | { type: "succeeded"; noteId: string }
  | { type: "reset" };

export const NO_FILE_ERROR: UploadError = {
  code: "no_file",
  message: "Choose a photo of the note first.",
};

export function initialUploadState<F>(): UploadState<F> {
  return { status: "idle", file: null };
}

export function isUploadBusy(state: UploadState<unknown>): boolean {
  return state.status === "validating" || state.status === "uploading";
}

export function uploadReducer<F>(state: UploadState<F>, event: UploadEvent<F>): UploadState<F> {
  switch (event.type) {
    case "select":
      // The file input is disabled while busy; ignore stray events anyway.
      if (isUploadBusy(state)) return state;
      return { status: "idle", file: event.file };

    case "submit":
      if (isUploadBusy(state) || state.status === "uploaded") return state;
      if (!state.file) return { status: "failed", file: null, error: NO_FILE_ERROR };
      return { status: "validating", file: state.file };

    case "validated":
      if (state.status !== "validating") return state;
      return { status: "uploading", file: state.file };

    case "failed":
      if (!isUploadBusy(state)) return state;
      return { status: "failed", file: state.file, error: event.error };

    case "succeeded":
      if (state.status !== "uploading") return state;
      return { status: "uploaded", file: null, noteId: event.noteId };

    case "reset":
      if (isUploadBusy(state)) return state;
      return initialUploadState();
  }
}
