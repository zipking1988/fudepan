import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { OriginalNotePanel } from "@/components/OriginalNotePanel";
import { SignInPrompt } from "@/components/SignInPrompt";
import { TaskReviewForm, type Member } from "@/components/TaskReviewForm";
import { linkClass } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { hasPermission } from "@/lib/permissions";
import { loadNote } from "@/server/notes/load-note";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: t.review.title };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const session = await getSessionContext();
  if (session.status !== "ready") {
    return (
      <>
        <h1 className="text-3xl font-bold">{t.review.title}</h1>
        <SignInPrompt status={session.status} next={`/notes/${id}/review`} />
      </>
    );
  }

  const note = await loadNote(session.supabase, id);
  if (!note) notFound();

  const canDraft = hasPermission(session.role, "task.draft");
  const { data: members } = canDraft
    ? await session.supabase
        .from("members")
        .select("id, display_name")
        .eq("household_id", session.householdId)
        .order("display_name", { ascending: true })
    : { data: [] };

  return (
    <>
      <p>
        <Link
          href={`/notes/${id}`}
          className={`${linkClass} inline-flex min-h-11 items-center text-lg`}
        >
          <span aria-hidden="true">← </span>
          {t.review.backToNote}
        </Link>
      </p>
      <h1 className="mt-2 text-4xl font-bold">{t.review.title}</h1>
      <p className="mt-2 max-w-2xl text-lg text-ink-soft">{t.review.intro}</p>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <OriginalNotePanel
          sourceType={note.sourceType}
          imageUrl={note.imageUrl}
          text={note.text}
          ocrConfidence={note.ocrConfidence}
        />
        {canDraft ? (
          <TaskReviewForm
            noteId={id}
            members={(members ?? []) as Member[]}
            noteText={note.text ?? ""}
          />
        ) : (
          <p role="status" className="paper-card p-6 text-lg">
            {t.review.elderCannotDraft}
          </p>
        )}
      </div>
    </>
  );
}
