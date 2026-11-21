import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { NoteStatusBadge } from "@/components/app/note-status";
import { getSession } from "@/lib/auth/session";
import {
  ROLE_LABELS,
  canUploadNotes,
  chooseHousehold,
  type Membership,
} from "@/lib/households/membership";
import { listMemberships } from "@/lib/households/queries";
import { listHouseholdNotes, type NoteSummary } from "@/lib/notes/queries";

import { UploadNoteForm } from "./upload-note-form";

export const metadata: Metadata = {
  title: "Notes — Fudepan",
};

export default function NotesPage({ searchParams }: PageProps<"/notes">) {
  return (
    <Suspense fallback={<p role="status">Loading your household&apos;s notes…</p>}>
      <HouseholdNotes searchParams={searchParams} />
    </Suspense>
  );
}

async function HouseholdNotes({ searchParams }: Pick<PageProps<"/notes">, "searchParams">) {
  const { household } = await searchParams;
  const { supabase, user } = await getSession();
  if (!user) redirect("/login?next=/notes");

  const choice = chooseHousehold(
    await listMemberships(supabase, user.id),
    typeof household === "string" ? household : null,
  );

  if (choice.kind === "no_household") {
    return (
      <>
        <h1 className="app-title">No household yet</h1>
        <p className="app-lede">
          Your account is not part of a household yet. Ask the person who organizes your
          family&apos;s care to add you.
        </p>
      </>
    );
  }
  if (choice.kind === "not_member") {
    return (
      <>
        <h1 className="app-title">You can&apos;t open this household</h1>
        <p className="app-lede">
          You are not a member of the household in this link.{" "}
          <Link href="/notes" className="app-link">
            Go to your own household&apos;s notes
          </Link>
          .
        </p>
      </>
    );
  }

  const { current, all } = choice;
  const notes = await listHouseholdNotes(supabase, current.householdId);

  return (
    <div className="grid gap-12">
      <header>
        <p className="app-kicker">Household</p>
        <h1 className="app-title">{current.householdName}</h1>
        <p className="app-lede">
          Signed in as {current.displayName}, {ROLE_LABELS[current.role].toLowerCase()}.
        </p>
        {all.length > 1 && <HouseholdSwitcher current={current} all={all} />}
      </header>

      {canUploadNotes(current.role) ? (
        <UploadNoteForm householdId={current.householdId} householdName={current.householdName} />
      ) : (
        <section aria-labelledby="read-only-heading" className="app-panel">
          <h2 id="read-only-heading" className="app-subtitle">
            Reading notes
          </h2>
          <p className="app-lede">
            You can read every note in {current.householdName}. A family caregiver adds new notes.
          </p>
        </section>
      )}

      <NoteList notes={notes} />
    </div>
  );
}

function HouseholdSwitcher({ current, all }: { current: Membership; all: Membership[] }) {
  return (
    <nav aria-label="Your households" className="mt-6">
      <p className="app-hint">You belong to more than one household:</p>
      <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
        {all.map((m) => (
          <li key={m.householdId}>
            <Link
              href={`/notes?household=${m.householdId}`}
              aria-current={m.householdId === current.householdId ? "page" : undefined}
              className="app-link aria-[current=page]:font-bold"
            >
              {m.householdName}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function NoteList({ notes }: { notes: NoteSummary[] }) {
  return (
    <section aria-labelledby="notes-heading">
      <h2 id="notes-heading" className="app-subtitle">
        Notes
      </h2>
      {notes.length === 0 ? (
        <p className="app-lede">No notes yet. Upload a photo of a handwritten note to begin.</p>
      ) : (
        <ul className="mt-6 grid gap-4">
          {notes.map((note) => (
            <li key={note.id}>
              <article aria-labelledby={`note-${note.id}`} className="app-panel grid gap-4">
                <h3 id={`note-${note.id}`} className="text-xl font-semibold">
                  <Link href={`/notes/${note.id}`} className="app-link">
                    Note uploaded <LocalDateTime iso={note.createdAt} />
                  </Link>
                </h3>
                <dl className="app-facts">
                  <dt>Uploaded by</dt>
                  <dd>{note.uploaderName ?? "A former member"}</dd>
                  <dt>Status</dt>
                  <dd>
                    <NoteStatusBadge status={note.status} />
                  </dd>
                </dl>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
