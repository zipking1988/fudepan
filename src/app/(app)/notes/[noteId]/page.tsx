import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { NoteStatusBadge } from "@/components/app/note-status";
import { safeNextPath } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";
import { listCareChainsByNote } from "@/lib/care/queries";
import { chainStatusText } from "@/lib/care/chain-summary";
import { getNoteDetail } from "@/lib/notes/queries";
import { NOTE_STATUS_TEXT } from "@/lib/notes/status";
import { createAdminClient } from "@/lib/supabase/admin";

import { ExtractButton } from "../extract-button";

/**
 * Server Actions run inside the route of the page that calls them, so this
 * value is the time budget of completeNoteUpload and its after() recognition.
 */
export const maxDuration = 300;

export const metadata: Metadata = {
  title: "Note — Fudepan",
};

export default function NotePage({ params }: PageProps<"/notes/[noteId]">) {
  return (
    <Suspense fallback={<p role="status">Loading the note…</p>}>
      <NoteDetailView params={params} />
    </Suspense>
  );
}

async function NoteDetailView({ params }: Pick<PageProps<"/notes/[noteId]">, "params">) {
  const { noteId } = await params;
  const { supabase, user } = await getSession();
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(`/notes/${noteId}`))}`);

  // Row-level security returns nothing for another household's note, so it
  // looks exactly like a note that does not exist.
  const note = await getNoteDetail(supabase, noteId);
  if (!note) notFound();

  const uploader = note.uploaderName ?? "a former member";
  const imageUrl = `/notes/${note.id}/image`;

  // Load any existing care chains for this note
  const admin = createAdminClient();
  const careChains = await listCareChainsByNote(admin, note.id);

  return (
    <article aria-labelledby="note-title" className="grid gap-10">
      <p>
        <Link href={`/notes?household=${note.householdId}`} className="app-link">
          ← All notes for {note.householdName}
        </Link>
      </p>

      <header>
        <p className="app-kicker">Handwritten note</p>
        <h1 id="note-title" className="app-title">
          {careChains[0]?.title ?? "Handwritten note"}
        </h1>
        <p className="app-hint mt-2">
          Uploaded by {uploader} · <LocalDateTime iso={note.createdAt} />
        </p>
      </header>

      <section aria-labelledby="next-heading" className="app-panel">
        <h2 id="next-heading" className="app-subtitle">
          {note.status === "pending_review" ? "Care steps" : "What happens next"}
        </h2>
        <p className="mt-2">
          <NoteStatusBadge status={note.status} />{" "}
          <span className="app-hint">{NOTE_STATUS_TEXT[note.status].description}</span>
        </p>

        {note.status === "pending_review" && careChains.length > 0 ? (
          <div className="grid gap-4 mt-3">
            <p className="app-lede">
              Fudepan has read this note and drafted care steps. A family member needs to review
              each step, assign a responsible person, and confirm anything about health, money, or
              travel.
            </p>
            <ul className="grid gap-3">
              {careChains.map((chain) => (
                <li key={chain.id}>
                  <Link href={`/care/${chain.id}`} className="app-button">
                    Review care steps
                  </Link>
                  <p className="app-hint mt-2">
                    {chain.stepCount} step{chain.stepCount !== 1 ? "s" : ""} ·{" "}
                    {chainStatusText(chain.status)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : note.status === "extraction_failed" ? (
          <div className="grid gap-4 mt-3">
            <ExtractButton noteId={note.id} retry />
          </div>
        ) : note.status === "extracting" ? (
          <div className="grid gap-4 mt-3">
            <p className="app-lede">
              Reading usually takes up to two minutes. Reload this page to see whether it has
              finished. If it has been longer than that, the reading was probably interrupted, and
              you can start it again.
            </p>
            <ExtractButton noteId={note.id} retry />
          </div>
        ) : (
          <div className="grid gap-4 mt-3">
            <p className="app-lede">
              Fudepan reads the handwriting and drafts care steps. Your family checks every step,
              and anything about health, money, or travel waits for a family member to confirm it.
            </p>
            <ExtractButton noteId={note.id} />
          </div>
        )}
      </section>
      <figure className="grid gap-3">
        {/*
          A plain <img>, not next/image: the optimizer would keep copies of a
          private photo in its cache. The route checks membership on every request.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Original photo of the handwritten note uploaded by ${uploader}.`}
          className="app-note-image"
        />
        <figcaption className="app-hint">
          This is the original photo.{" "}
          <a href={imageUrl} target="_blank" rel="noreferrer" className="app-link">
            Open it full size (opens in a new tab)
          </a>
        </figcaption>
      </figure>

    </article>
  );
}
