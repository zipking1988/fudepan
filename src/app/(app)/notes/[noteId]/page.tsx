import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { NoteStatusBadge } from "@/components/app/note-status";
import { safeNextPath } from "@/lib/auth/next-path";
import { getSession } from "@/lib/auth/session";
import { getNoteDetail } from "@/lib/notes/queries";
import { NOTE_STATUS_TEXT } from "@/lib/notes/status";

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
          Note uploaded <LocalDateTime iso={note.createdAt} />
        </h1>
      </header>

      <figure className="grid gap-3">
        {/*
          A plain <img>, not next/image: the optimizer would keep copies of a
          private photo in its cache. The route checks membership on every request.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt={`Original photo of the handwritten note uploaded by ${uploader}. Its text has not been read yet.`}
          className="app-note-image"
        />
        <figcaption className="app-hint">
          This is the original photo.{" "}
          <a href={imageUrl} target="_blank" rel="noreferrer" className="app-link">
            Open it full size (opens in a new tab)
          </a>
        </figcaption>
      </figure>

      <section aria-labelledby="details-heading" className="app-panel">
        <h2 id="details-heading" className="app-subtitle">
          Details
        </h2>
        <dl className="app-facts mt-5">
          <dt>Household</dt>
          <dd>{note.householdName}</dd>
          <dt>Uploaded by</dt>
          <dd>{note.uploaderName ?? "A former member"}</dd>
          <dt>Uploaded</dt>
          <dd>
            <LocalDateTime iso={note.createdAt} />
          </dd>
          <dt>Status</dt>
          <dd className="grid justify-items-start gap-2">
            <NoteStatusBadge status={note.status} />
            <span className="app-hint">{NOTE_STATUS_TEXT[note.status].description}</span>
          </dd>
        </dl>
      </section>

      <section aria-labelledby="next-heading" className="app-panel">
        <h2 id="next-heading" className="app-subtitle">
          What happens next
        </h2>
        <p className="app-lede">
          Fudepan has not read this note. Reading handwriting and suggesting care steps comes in the
          next version of Fudepan. When it does, your family will check every step before anything
          happens, and anything about health, money, or travel will wait for a family member to
          approve it.
        </p>
      </section>
    </article>
  );
}
