import Link from "next/link";
import { CreateHouseholdForm } from "@/components/CreateHouseholdForm";
import { Landing } from "@/components/Landing";
import { NoteUploadForm } from "@/components/NoteUploadForm";
import { SignInPrompt } from "@/components/SignInPrompt";
import { linkClass } from "@/components/ui";
import { t } from "@/lib/i18n/messages";
import { getSessionContext } from "@/server/session";

export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

export default async function HomePage() {
  const session = await getSessionContext();

  if (session.status === "signed_out") return <Landing />;
  if (session.status === "unconfigured") {
    return (
      <>
        <Landing />
        <SignInPrompt status="unconfigured" />
      </>
    );
  }

  if (session.status === "no_household") {
    return (
      <>
        <h1 className="text-4xl font-bold">{t.onboarding.title}</h1>
        <p className="mt-2 text-lg text-ink-soft">{t.onboarding.intro}</p>
        <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <CreateHouseholdForm />
          <section aria-labelledby="invited-title" className="paper-card p-6">
            <h2 id="invited-title" className="text-2xl font-semibold">
              {t.onboarding.inviteTitle}
            </h2>
            <p className="mt-2 text-lg">{t.onboarding.inviteBody}</p>
          </section>
        </div>
      </>
    );
  }

  // RLS limits notes to the user's households; the filter picks the active one.
  const { data: notes } = await session.supabase
    .from("notes")
    .select("id, source_type, created_at")
    .eq("household_id", session.householdId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <>
      <h1 className="text-4xl font-bold">{t.inbox.title}</h1>
      <p className="mt-2 text-lg text-ink-soft">{t.inbox.intro}</p>

      <div id="add-note" className="mt-8 scroll-mt-4">
        <NoteUploadForm />
      </div>

      <section aria-labelledby="recent-title" className="paper-card mt-10 p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 id="recent-title" className="text-2xl font-semibold">
            {t.inbox.recentTitle}
          </h2>
          <Link href="/board" className={`${linkClass} text-lg`}>
            {t.nav.board}
          </Link>
        </div>
        {(notes ?? []).length === 0 ? (
          <>
            <p className="mt-3 text-lg font-semibold">{t.inbox.emptyTitle}</p>
            <p className="text-lg text-ink-soft">{t.inbox.emptyBody}</p>
          </>
        ) : (
          <ul className="mt-4 grid gap-2">
            {(notes ?? []).map((note) => (
              <li key={note.id as string}>
                <Link
                  href={`/notes/${note.id as string}`}
                  className="flex min-h-12 items-center gap-3 rounded-md border border-line bg-paper px-4 py-2 text-lg font-semibold text-sage-800 hover:bg-sage-50"
                >
                  <span aria-hidden="true">{note.source_type === "image" ? "📷" : "✎"}</span>
                  {note.source_type === "image" ? t.inbox.photoNote : t.inbox.textNote},{" "}
                  {dateFormat.format(new Date(note.created_at as string))}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
