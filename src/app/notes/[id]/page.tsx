import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { OriginalNotePanel } from "@/components/OriginalNotePanel";
import { SignInPrompt } from "@/components/SignInPrompt";
import { linkClass, primaryButton } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { loadNote } from "@/server/notes/load-note";
import { getSessionContext } from "@/server/session";

export const metadata: Metadata = { title: t.note.title };
export const dynamic = "force-dynamic";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const session = await getSessionContext();
  if (session.status !== "ready") {
    return (
      <>
        <h1 className="text-3xl font-bold">{t.note.title}</h1>
        <SignInPrompt status={session.status} next={`/notes/${id}`} />
      </>
    );
  }

  // RLS returns nothing for notes outside the user's households.
  const note = await loadNote(session.supabase, id);
  if (!note) notFound();

  return (
    <>
      <p>
        <Link href="/" className={`${linkClass} inline-flex min-h-11 items-center text-lg`}>
          <span aria-hidden="true">← </span>
          {t.note.back}
        </Link>
      </p>
      <h1 className="mt-2 text-4xl font-bold">{t.note.title}</h1>
      <p className="mt-4">
        <Link href={`/notes/${id}/review`} className={primaryButton}>
          {t.review.linkFromNote}
        </Link>
      </p>
      <div className="mt-6 max-w-2xl">
        <OriginalNotePanel
          sourceType={note.sourceType}
          imageUrl={note.imageUrl}
          text={note.text}
          ocrConfidence={note.ocrConfidence}
        />
      </div>
    </>
  );
}
