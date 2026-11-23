import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LocalDateTime } from "@/components/app/local-date-time";
import { NoteStatusBadge } from "@/components/app/note-status";
import { AppointmentTime } from "@/app/(app)/care/appointment-facts";
import { actionCount, type ChainSummary } from "@/lib/care/chain-summary";
import { listNoteChainOverviews, type NoteChainOverview } from "@/lib/care/queries";
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

/**
 * Server Actions run inside the route of the page that calls them, so this
 * value is the time budget of completeNoteUpload and its after() recognition.
 */
export const maxDuration = 300;

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
  const [notes, overviews] = await Promise.all([
    listHouseholdNotes(supabase, current.householdId),
    listNoteChainOverviews(supabase, current.householdId),
  ]);

  return (
    <div className="grid gap-12">
      <header>
        <p className="app-kicker">{current.householdName}</p>
        <h1 className="app-title">Your family&apos;s notes</h1>
        <p className="app-hint mt-2">
          Signed in as {current.displayName}, {ROLE_LABELS[current.role].toLowerCase()}.
        </p>
        {all.length > 1 && <HouseholdSwitcher current={current} all={all} />}
      </header>

      <NeedsYou notes={notes} overviews={overviews} />
      {canUploadNotes(current.role) && (
        <UploadNoteForm householdId={current.householdId} householdName={current.householdName} />
      )}

      <NoteList notes={notes} overviews={overviews} />
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

function NeedsYou({
  notes,
  overviews,
}: {
  notes: NoteSummary[];
  overviews: Map<string, NoteChainOverview>;
}) {
  const all = [...overviews.values()].map((o) => o.summary);
  const confirm = all.reduce((n, s) => n + s.awaitingConfirmation, 0);
  const owner = all.reduce((n, s) => n + s.withoutOwner, 0);
  const missing = all.reduce((n, s) => n + s.missingAppointmentDetails, 0);
  const unread = notes.filter((n) => n.status === "uploaded" || n.status === "extraction_failed").length;
  const items = [
    confirm > 0 && `${plural(confirm, "step")} waiting for a family member to confirm`,
    owner > 0 && `${plural(owner, "step")} with no responsible person`,
    missing > 0 && `${plural(missing, "appointment")} missing the place or time`,
    unread > 0 && `${plural(unread, "note")} not read yet`,
  ].filter((x): x is string => Boolean(x));
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="needs-you-heading" className="app-alert">
      <h2 id="needs-you-heading" className="app-alert__title text-lg">
        Needs attention
      </h2>
      <ul className="mt-2 grid gap-1 pl-5 list-disc">
        {items.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <p className="mt-2">Open a note below to deal with it.</p>
    </section>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What still has to happen for one chain, in words. */
function todoItems(summary: ChainSummary): { kind: "todo" | "done"; text: string }[] {
  const items: { kind: "todo" | "done"; text: string }[] = [];
  if (summary.awaitingConfirmation > 0)
    items.push({ kind: "todo", text: `${summary.awaitingConfirmation} to confirm` });
  if (summary.withoutOwner > 0)
    items.push({ kind: "todo", text: `${summary.withoutOwner} with no one responsible` });
  if (summary.missingAppointmentDetails > 0)
    items.push({
      kind: "todo",
      text: `${plural(summary.missingAppointmentDetails, "appointment")} missing place or time`,
    });
  if (items.length === 0 && summary.total > 0) {
    items.push({
      kind: "done",
      text:
        summary.done === summary.total
          ? `All ${summary.total} steps done`
          : `Nothing waiting on you · ${summary.done} of ${summary.total} done`,
    });
  }
  return items;
}

function NoteList({
  notes,
  overviews,
}: {
  notes: NoteSummary[];
  overviews: Map<string, NoteChainOverview>;
}) {
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
              <NoteCard note={note} overview={overviews.get(note.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NoteCard({ note, overview }: { note: NoteSummary; overview: NoteChainOverview | null }) {
  const hasChain = note.status === "pending_review" && overview;
  const title = hasChain
    ? overview.title
    : note.status === "extraction_failed"
      ? "Note could not be read yet"
      : note.status === "extracting"
        ? "Note being read"
        : "Note not read yet";
  const href = hasChain ? `/care/${overview.chainId}` : `/notes/${note.id}`;
  const action = hasChain
    ? actionCount(overview.summary) > 0
      ? "Review and assign"
      : "Open care steps"
    : note.status === "extraction_failed"
      ? "Try reading again"
      : note.status === "extracting"
        ? "See progress"
        : "Read this note";
  const todos = hasChain ? todoItems(overview.summary) : [];
  return (
    <article aria-labelledby={`note-${note.id}`} className="app-panel app-note-card">
      {/* eslint-disable-next-line @next/next/no-img-element -- private image; the route checks membership */}
      <img
        src={`/notes/${note.id}/image`}
        alt=""
        loading="lazy"
        className="app-note-thumb"
      />
      <div className="grid gap-3">
        <h3 id={`note-${note.id}`} className="text-xl font-semibold">
          <Link href={href} className="app-link">
            {title}
          </Link>
        </h3>
        <p className="app-hint">
          Uploaded by {note.uploaderName ?? "a former member"} · <LocalDateTime iso={note.createdAt} />
        </p>
        {hasChain ? (
          <>
            {todos.length > 0 && (
              <ul className="app-todo" aria-label="What still needs doing">
                {todos.map((t) => (
                  <li key={t.text} data-kind={t.kind}>
                    {t.text}
                  </li>
                ))}
              </ul>
            )}
            {overview.summary.nextAppointment && (
              <p>
                <span className="font-semibold">Next appointment:</span>{" "}
                <AppointmentTime
                  iso={overview.summary.nextAppointment.iso}
                  timeZone={overview.summary.nextAppointment.timeZone}
                />
              </p>
            )}
          </>
        ) : (
          <p>
            <NoteStatusBadge status={note.status} />
          </p>
        )}
        <p>
          <Link href={href} className="app-button app-button--quiet" aria-describedby={`note-${note.id}`}>
            {action}
          </Link>
        </p>
      </div>
    </article>
  );
}
