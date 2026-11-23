import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LocalDateTime } from "@/components/app/local-date-time";
import { NoteStatusBadge } from "@/components/app/note-status";
import type { UploadState } from "@/lib/notes/upload-state";

import { UploadNoteFormView, type SelectedFile } from "./upload-note-form-view";

const photo: SelectedFile = { name: "IMG_0042.jpg", size: 2.4 * 1024 * 1024 };
const error = { code: "too_large", message: "This photo is 12.4 MB. The limit is 10 MB." };

function render(state: UploadState<SelectedFile>) {
  return renderToStaticMarkup(<UploadNoteFormView state={state} householdName="Demo household" />);
}

function submitButton(html: string): string {
  return html.match(/<button type="submit"[^>]*>[^<]*<\/button>/)?.[0] ?? "";
}

describe("upload form markup", () => {
  it("labels the file input 'Upload a handwritten note' and marks it required", () => {
    const html = render({ status: "idle", file: null });
    expect(html).toMatch(
      /<label for="note-file"[^>]*>Upload a handwritten note <span[^>]*>\(required\)<\/span><\/label>/,
    );
    const input = html.match(/<input id="note-file"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="file"');
    expect(input).toContain('accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"');
    expect(input).toContain('required=""');
    expect(input).toContain('aria-required="true"');
    expect(input).toContain('aria-describedby="note-file-help"');
    expect(html).toContain("JPEG, PNG, or WebP, up to 10 MB");
  });

  it("has a labelled submit button and a polite status region", () => {
    const html = render({ status: "idle", file: photo });
    expect(submitButton(html)).toBe(
      '<button type="submit" class="app-button">Upload and read note</button>',
    );
    expect(html).toMatch(/<p role="status" aria-live="polite"[^>]*>/);
    expect(html).toContain("IMG_0042.jpg");
    expect(html).toContain("2.4 MB");
    expect(html).toContain('data-upload-state="idle"');
  });

  it("disables the submit button and file input while validating and uploading", () => {
    for (const [status, label, announcement] of [
      ["validating", "Checking…", "Checking the photo…"],
      ["uploading", "Uploading…", "Uploading the note. Please keep this page open."],
    ] as const) {
      const html = render({ status, file: photo });
      expect(submitButton(html)).toBe(
        `<button type="submit" class="app-button" disabled="">${label}</button>`,
      );
      expect(html.match(/<input id="note-file"[^>]*>/)?.[0]).toContain('disabled=""');
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain(announcement);
      expect(html).toContain(`data-upload-state="${status}"`);
    }
  });

  it("shows a failure as an alert tied to the input, keeps the file, and offers a retry", () => {
    const html = render({ status: "failed", file: photo, error });
    expect(html).toContain('<div id="note-file-error" role="alert" class="app-alert">');
    expect(html).toContain("The note was not uploaded");
    expect(html).toContain(error.message);
    const input = html.match(/<input id="note-file"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('aria-invalid="true"');
    expect(input).toContain('aria-describedby="note-file-help note-file-error"');
    expect(input).not.toContain("disabled");
    expect(html).toContain("IMG_0042.jpg");
    expect(submitButton(html)).toBe('<button type="submit" class="app-button">Try again</button>');
  });

  it("asks for a file when none is chosen", () => {
    const html = render({
      status: "failed",
      file: null,
      error: { code: "no_file", message: "Choose a photo of the note first." },
    });
    expect(html).toContain("Choose a photo of the note first.");
    expect(submitButton(html)).toContain(">Upload and read note<");
  });

  it("confirms success with a link to the note and a way to upload another", () => {
    const html = render({
      status: "uploaded",
      file: null,
      noteId: "a0000000-0000-4000-8000-000000000001",
    });
    expect(html).toContain('data-upload-state="uploaded"');
    expect(html).toContain("Note saved.");
    expect(html).toContain('href="/notes/a0000000-0000-4000-8000-000000000001"');
    expect(html).toContain(">Open the note<");
    expect(html).toContain(">Upload another note<");
    expect(html).toMatch(/<div tabindex="-1" class="app-success/);
    expect(html).not.toContain('id="note-file"');
  });

  it("shows reading progress after upload, with no buttons that could interrupt it", () => {
    const html = renderToStaticMarkup(
      <UploadNoteFormView
        state={{ status: "uploaded", file: null, noteId: "a0000000-0000-4000-8000-000000000001" }}
        householdName="Demo household"
        reading={{ phase: "reading", startedAt: Date.now() }}
      />,
    );
    expect(html).toContain("Note saved.");
    expect(html).toMatch(/<p role="status"[^>]*>Reading the handwriting…<\/p>/);
    expect(html).toContain("marked as missing instead of guessed");
    expect(html).toContain("Nothing is booked, paid, or sent.");
    expect(html).not.toContain(">Open the note<");
    expect(html).not.toContain(">Upload another note<");
  });

  it("explains a reading failure and offers a retry from the note", () => {
    const html = renderToStaticMarkup(
      <UploadNoteFormView
        state={{ status: "uploaded", file: null, noteId: "a0000000-0000-4000-8000-000000000001" }}
        householdName="Demo household"
        reading={{ phase: "failed", message: "The reading service did not answer. The photo is saved. Try again in a minute." }}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("The note could not be read");
    expect(html).toContain("The photo is saved.");
    expect(html).toContain(">Open the note to try again<");
  });

  it("offers a retry button on a reading failure when a retry handler is given", () => {
    const html = renderToStaticMarkup(
      <UploadNoteFormView
        state={{ status: "uploaded", file: null, noteId: "a0000000-0000-4000-8000-000000000001" }}
        householdName="Demo household"
        reading={{ phase: "failed", message: "Try again." }}
        onRetryReading={() => undefined}
      />,
    );
    expect(html).toContain(">Try reading again<");
    expect(html).toContain(">Open the note<");
  });

  it("previews the chosen photo before upload", () => {
    const html = renderToStaticMarkup(
      <UploadNoteFormView state={{ status: "idle", file: photo }} householdName="Demo household" previewUrl="blob:fake" />,
    );
    expect(html).toMatch(/<img src="blob:fake" alt="Preview of the photo you chose\. Check it shows the whole note\."/);
  });

  it("never uses vague error wording in any state", () => {
    for (const state of [
      { status: "idle", file: null },
      { status: "failed", file: photo, error },
    ] as UploadState<SelectedFile>[]) {
      expect(render(state)).not.toMatch(/invalid input/i);
    }
  });
});

describe("note status and time", () => {
  it("states the status in words", () => {
    expect(renderToStaticMarkup(<NoteStatusBadge status="uploaded" />)).toBe(
      '<span class="app-status app-status--uploaded">Uploaded</span>',
    );
  });

  it("server-renders times in labelled UTC with a machine-readable value", () => {
    expect(renderToStaticMarkup(<LocalDateTime iso="2026-11-21T09:12:00.000Z" />)).toBe(
      '<time dateTime="2026-11-21T09:12:00.000Z">Sat, November 21, 2026 at 9:12 AM UTC</time>',
    );
  });
});
