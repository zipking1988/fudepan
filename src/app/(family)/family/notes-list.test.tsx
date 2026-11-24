import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { NotesList } from "./notes-list";
const N1 = "11111111-1111-4111-8111-111111111111";
const part = (status: string) => ({ progressStatus: status }) as unknown as SharedCareEvent["parts"][number];
const ev = (o: Partial<SharedCareEvent>) =>
  ({ noteId: N1, state: "ready", done: false, parts: [part("claimed"), part("claimed"), part("completed")], title: "Clinic visit", createdAt: "2026-01-02T03:04:05Z", ...o }) as SharedCareEvent;
describe("NotesList", () => {
  it("opens each note's board and shows thumbnail, status and real progress", () => {
    const html = renderToStaticMarkup(<NotesList events={[ev({})]} language="en" />);
    expect(html).toContain(`href="/family?note=${N1}"`);
    expect(html).toContain(`src="/notes/${N1}/image"`);
    expect(html).toContain("Needs review");
    expect(html).toContain("1 of 3 tasks done");
    expect(html).toContain("Clinic visit");
    expect(html.match(/href="\/family\/capture"/g)).toHaveLength(1);
    expect(html).not.toContain("Other notes");
  });
  it("shows Reading and Done states", () => {
    const html = renderToStaticMarkup(
      <NotesList events={[ev({ state: "reading", parts: [], title: null }), ev({ noteId: "22222222-2222-4222-8222-222222222222", done: true, parts: [part("completed")] })]} language="en" />,
    );
    expect(html).toContain("Reading");
    expect(html).toContain("Done");
  });
  it("has an actionable first-use state with one upload entry per spot", () => {
    const html = renderToStaticMarkup(<NotesList events={[]} language="en" />);
    expect(html).toContain("Upload your first note");
    expect(html).toContain('href="/family/capture"');
  });
  it("writes Japanese", () => {
    const html = renderToStaticMarkup(<NotesList events={[ev({})]} language="ja" />);
    expect(html).toContain("メモをアップロード");
    expect(html).toContain("3件中1件完了");
  });
  const A = { id: "a", name: "Aki Sato" };
  const B = { id: "b", name: "Ben Ito" };
  const own = (id: string, status: string, owner: typeof A | null) => ({ id, title: `Task ${id}`, progressStatus: status, owner }) as unknown as SharedCareEvent["parts"][number];
  const N2 = "22222222-2222-4222-8222-222222222222";
  const populated = [
    ev({ parts: [own("p1", "completed", A), own("p2", "claimed", A), own("p3", "completed", B)] }),
    ev({ noteId: N2, title: "Pharmacy", parts: [own("p4", "completed", A), own("p5", "cancelled", A)] }),
  ];
  it("shows the viewer's finished tasks by note with links back, scoped to this list", () => {
    const html = renderToStaticMarkup(<NotesList events={populated} language="en" viewerId="a" recipientName="Haru" />);
    expect(html).toContain("Your finished tasks");
    expect(html).toContain("for Haru");
    expect(html).toContain("2 tasks finished");
    expect(html).toContain("Counted across the 2 notes in this list.");
    expect(html).toContain("See completed tasks");
    expect(html).toContain(`href="/family/events/${N1}?task=p1"`);
    expect(html).toContain(`href="/family/events/${N2}?task=p4"`);
    expect(html).not.toContain("task=p2");
    expect(html).not.toContain("task=p5");
  });
  it("uses a neutral family label without a recipient", () => {
    const html = renderToStaticMarkup(<NotesList events={populated} language="en" viewerId="a" />);
    expect(html).toContain("for your family");
  });
  it("ranks the family with ties and shows no rows for zero completions", () => {
    const tie = renderToStaticMarkup(
      <NotesList events={[ev({ parts: [own("p1", "completed", A), own("p3", "completed", B)] })]} language="en" viewerId="a" />,
    );
    expect(tie.match(/Tied No\. 1/g)).toHaveLength(2);
    const zero = renderToStaticMarkup(<NotesList events={[ev({ parts: [own("p1", "claimed", A)] })]} language="en" viewerId="a" />);
    expect(zero).toContain("Nobody has finished a task yet");
    expect(zero).not.toContain("nx-rank__name");
    expect(zero).not.toContain("See completed tasks");
  });
  it("writes the contribution area in Japanese", () => {
    const html = renderToStaticMarkup(<NotesList events={populated} language="ja" viewerId="a" recipientName="春" />);
    expect(html).toContain("あなたが終えたやること");
    expect(html).toContain("春さんのために");
    expect(html).toContain("完了したやることを見る");
    expect(html).toContain("家族のありがとうボード");
  });
});
