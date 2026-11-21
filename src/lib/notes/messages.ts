import { noteFileMessage, type NoteFileProblem } from "./validation";

export type NoteUploadErrorCode =
  | NoteFileProblem
  | "signed_out"
  | "invalid_request"
  | "not_member"
  | "not_allowed"
  | "too_many_pending"
  | "unavailable"
  | "upload_failed"
  | "verify_failed"
  | "save_failed"
  | "expired"
  | "not_found";

/**
 * What went wrong and what to do next, in plain language. Shown to the person
 * uploading; never includes file names, paths, or technical detail.
 */
export const NOTE_UPLOAD_MESSAGES: Record<NoteUploadErrorCode, string> = {
  no_file: noteFileMessage("no_file"),
  empty: noteFileMessage("empty"),
  too_large:
    "This photo is larger than the 10 MB limit. Crop it or take it again, then choose it here.",
  unsupported_type:
    "Fudepan accepts photos saved as JPEG, PNG, or WebP. Choose a photo in one of those formats.",
  not_an_image: noteFileMessage("not_an_image"),
  signed_out: "You have been signed out. Sign in again, then upload the note.",
  invalid_request: "Something went wrong with this upload. Reload the page and try again.",
  not_member: "You can only add notes to a household you belong to.",
  not_allowed:
    "Your role in this household lets you read notes, not add them. Ask a family caregiver to upload the photo.",
  too_many_pending:
    "Several of your uploads did not finish. Wait a few hours for them to clear, then try again.",
  unavailable: "Fudepan could not finish the upload just now. Wait a minute, then press Try again.",
  upload_failed:
    "The photo did not finish uploading. Check your internet connection, then press Try again. Your photo is still selected.",
  verify_failed:
    "The uploaded file was not a JPEG, PNG, or WebP photo, so it was removed. Choose a photo of the note and try again.",
  save_failed:
    "The photo uploaded, but Fudepan could not save the note, so the photo was removed. Press Try again.",
  expired: "This upload took too long and was cancelled. Press Try again.",
  not_found: "Fudepan could not find this upload. Press Try again.",
};
