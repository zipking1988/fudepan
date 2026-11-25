import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/messages";
import type { UploadState } from "@/lib/notes/upload-state";
import { CaptureFormView, type CaptureFile } from "./capture-form-view";

const photo: CaptureFile = { name: "IMG_1.jpg", size: 1024 };
const tr = createTranslator("en");
const ja = createTranslator("ja");

function render(state: UploadState<CaptureFile>, previewUrl: string | null = null, dragging = false, t = tr) {
  return renderToStaticMarkup(<CaptureFormView state={state} tr={t} previewUrl={previewUrl} dragging={dragging} />);
}
function visibleText(html: string): string {
  return html.replace(/<noscript>.*?<\/noscript>/g, "").replace(/<[^>]+>/g, " ");
}
const PRIVACY = "Your photo will be sent to ai&amp; to be read and is visible to authorized household members";

describe("capture screen markup", () => {
  it("offers the rear camera and a plain photo picker, both labelled, plus a paper inbox drop target", () => {
    const html = render({ status: "idle", file: null });
    const camera = html.match(/<input id="capture-camera"[^>]*>/)?.[0] ?? "";
    expect(camera).toContain('capture="environment"');
    expect(camera).toContain('accept="image/*"');
    const other = html.match(/<input id="capture-choose"[^>]*>/)?.[0] ?? "";
    expect(other).not.toContain("capture=");
    expect(other).toContain("image/jpeg,image/png,image/webp");
    expect(html).toMatch(/<label for="capture-camera"[^>]*>[\s\S]*Take a photo<\/label>/);
    expect(html).toMatch(/<label for="capture-choose"[^>]*>Choose a photo<\/label>/);
    expect(html).toContain('role="group" aria-label="Photo inbox"');
    expect(html).toContain("Drag a photo here");
    expect(html).toContain("JPEG, PNG, WebP · up to 10 MB");
    expect(html).not.toContain('type="submit"');
  });
  it("writes the same screen in Japanese", () => {
    const html = render({ status: "idle", file: null }, null, false, ja);
    expect(html).toContain("メモを追加");
    expect(html).toContain("ここに写真をドラッグ");
    expect(html).toContain("写真を選ぶ");
  });
  it("changes the drop text while a photo is held over the inbox", () => {
    expect(render({ status: "idle", file: null }, null, true)).toContain("Let go to see the preview");
  });
  it("never says 'upload' in visible text, in any state", () => {
    const states: UploadState<CaptureFile>[] = [
      { status: "idle", file: null },
      { status: "idle", file: photo },
      { status: "validating", file: photo },
      { status: "uploading", file: photo },
      { status: "uploaded", file: null, noteId: "n1" },
      { status: "failed", file: photo, error: { code: "upload_failed", message: "x" } },
    ];
    for (const s of states) expect(visibleText(render(s, "blob:x")).toLowerCase()).not.toContain("upload");
  });
  it("shows the preview with alt text, retake and choose again, the ai& sentence and one send button", () => {
    const html = render({ status: "idle", file: photo }, "blob:preview");
    expect(html).toContain('src="blob:preview"');
    expect(html).toContain('alt="The photo of your note, ready to send"');
    expect(html).toContain("Take it again");
    expect(html).toContain("Choose again");
    expect(html).toContain(PRIVACY);
    expect(html.match(/<button type="submit"[^>]*>Send to my family<\/button>/)).not.toBeNull();
    expect(html).not.toContain("Sent to your family");
  });
  it("shows no privacy sentence or send button before a photo is chosen", () => {
    const html = render({ status: "idle", file: null });
    expect(html).not.toContain("ai&amp;");
    expect(html).not.toContain('type="submit"');
  });
  it("announces checking and sending in a status region and disables the button", () => {
    const checking = render({ status: "validating", file: photo }, "blob:p");
    expect(checking).toMatch(/<p role="status"[^>]*>Checking the photo…<\/p>/);
    const sending = render({ status: "uploading", file: photo }, "blob:p");
    expect(sending).toMatch(/<p role="status"[^>]*>Sending your photo\./);
    expect(sending).toMatch(/<button type="submit" class="[^"]*" disabled/);
  });
  it("shows an alert with plain words and 'Try again' while keeping the photo", () => {
    const html = render(
      { status: "failed", file: photo, error: { code: "upload_failed", message: "Technical text" } },
      "blob:p",
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Your photo was not sent");
    expect(html).not.toContain("Technical text");
    expect(html).toMatch(/<button type="submit"[^>]*>Try again<\/button>/);
    expect(html).toContain('src="blob:p"');
  });
  it("names a photo problem and offers no send for that photo", () => {
    const html = render(
      {
        status: "failed",
        file: photo,
        error: { code: "too_large", message: "This photo is larger than the 10 MB limit." },
      },
      "blob:p",
    );
    expect(html).toContain("This photo is larger than the 10 MB limit.");
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('src="blob:p"');
  });
  it("shows 'Sent to your family' and the reading status only in the sent state", () => {
    const sent = render({ status: "uploaded", file: null, noteId: "n1" });
    expect(sent).toContain("Sent to your family. You&#x27;re done.");
    expect(sent).toContain("Reading your note…");
    expect(sent).toContain('href="/family/events/n1"');
    expect(sent).toContain("Take another photo");
    for (const s of ["idle", "validating", "uploading"] as const) {
      const file = s === "idle" ? null : photo;
      expect(render({ status: s, file } as UploadState<CaptureFile>)).not.toContain("Sent to your family");
    }
  });
  it("offers the sample note as a plain button before a photo is chosen, in both languages", () => {
    const html = render({ status: "idle", file: null });
    expect(html).toMatch(/<button type="button" class="pb-btn pb-btn--outline pb-sample__btn" aria-describedby="capture-sample-hint">Use the sample note<\/button>/);
    expect(html).toContain("made-up family");
    expect(html).toContain('src="/landing/handwritten-note-ja.png"');
    expect(render({ status: "idle", file: null }, null, false, ja)).toContain("サンプルのメモを使う");
    expect(render({ status: "idle", file: photo }, "blob:x")).not.toContain("pb-sample");
  });
});
