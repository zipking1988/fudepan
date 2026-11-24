import Link from "next/link";
import { Suspense } from "react";
import { PaperLoading } from "@/app/(family)/loading-status";
import { listHouseholdMemberOptions } from "@/lib/care/queries";
import { getEventTimeline } from "@/lib/care/timeline";
import { loadFamilyFeed } from "@/lib/family/feed";
import { receiverOptionsFrom } from "@/lib/family/event-offers";
import { requireFamilyContext } from "@/lib/family/session";
import { portraitUrl, portraitVersions } from "@/lib/portraits/service";
import { isUuid } from "@/lib/ids";
import { createTranslator } from "@/lib/i18n/messages";
import { FeedPoller, MarkSeenButton } from "./feed-client";
import { HomeBoard } from "./playful/home-board";
import { NotesList } from "./notes-list";
import { Icon } from "./playful/ui";
import { RecipientHome } from "./recipient-home";

export default function FamilyHomePage({
  searchParams,
}: {
  searchParams: Promise<{ note?: string; task?: string }>;
}) {
  return (
    <Suspense fallback={<PaperLoading />}>
      <FamilyHome searchParams={searchParams} />
    </Suspense>
  );
}

async function FamilyHome({ searchParams }: { searchParams: Promise<{ note?: string; task?: string }> }) {
  const outcome = await requireFamilyContext("/family");
  if (outcome.kind !== "ok") {
    const tr = createTranslator(outcome.language);
    const key = outcome.kind === "no_household" ? "family.noHousehold" : "family.notMember";
    return (
      <div className="pb-state">
        <h1 className="pb-state__title">{tr.t(`${key}.title`)}</h1>
        <p>{tr.t(`${key}.body`)}</p>
      </div>
    );
  }
  const ctx = outcome.context;
  if (ctx.role === "care_recipient")
    return <RecipientHome context={ctx} supabase={outcome.supabase} />;

  const tr = createTranslator(ctx.language);
  const { note, task } = await searchParams;
  const now = new Date();
  const [{ feed, events }, options] = await Promise.all([
    loadFamilyFeed(outcome.supabase, ctx.householdId, ctx.memberId, now),
    listHouseholdMemberOptions(outcome.supabase, ctx.householdId),
  ]);
  const members = receiverOptionsFrom(options);
  const viewer = { memberId: ctx.memberId, householdId: ctx.householdId, role: ctx.role };

  const ordered = feed.events.flatMap((e) => {
    const ev = events.get(e.noteId);
    return ev ? [ev] : [];
  });
  // The Notes list is the default view. A note opens only when ?note= names one of this household's notes.
  const selected = note && isUuid(note) ? (events.get(note) ?? null) : null;
  const hasUpdates = feed.newCount > 0 || feed.unseenReminderCount > 0 || feed.reminders.length > 0;
  const updates = (
    <div className="pb-updates">
      <div className="sr-only">
        <FeedPoller message={feed.newCount > 0 ? tr.tCount("feed.newUpdates", feed.newCount) : ""} />
      </div>
      {hasUpdates && (
        <details className="pb-updates-fold">
          <summary>
            {feed.newCount > 0 ? tr.tCount("feed.newUpdates", feed.newCount) : tr.t("pb.notes.updates.summary")}
          </summary>
          <div className="pb-updates-fold__body">
            {(feed.newCount > 0 || feed.unseenReminderCount > 0) && (
              <MarkSeenButton
                householdId={ctx.householdId}
                label={tr.t("feed.markSeen")}
                failedText={tr.t("feed.markSeenFailed")}
              />
            )}
            {feed.reminders.length > 0 && (
              <ul className="pb-updates__list" aria-label={tr.t("feed.reminders.heading")}>
                {feed.reminders.map((r) => (
                  <li key={r.id}>
                    <span>{tr.t("feed.inAppReminder", { name: ctx.displayName })}</span>
                    {!r.seen && <span className="pb-chip pb-chip--butter">{tr.t("feed.new")}</span>}
                    {r.noteId && (
                      <Link href={`/family/events/${r.noteId}`} className="pb-link">
                        {tr.t("feed.openEvent")}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );

  if (!selected) {
    const showUpdates =
      feed.newCount > 0 || feed.unseenReminderCount > 0 || feed.reminders.length > 0;
    const listUpdates = (
      <div className="pb-updates">
        <div className="sr-only">
          <FeedPoller
            message={feed.newCount > 0 ? tr.tCount("feed.newUpdates", feed.newCount) : ""}
          />
        </div>
        {showUpdates && (
          <details className="nx-updates">
            <summary>
              {feed.newCount > 0
                ? tr.tCount("feed.newUpdates", feed.newCount)
                : tr.t("pb.notes.updates.summary")}
              <Icon name="chevronRight" size={20} className="nx-updates__chev" />
            </summary>
            <div className="nx-updates__body">
              {(feed.newCount > 0 || feed.unseenReminderCount > 0) && (
                <MarkSeenButton
                  householdId={ctx.householdId}
                  label={tr.t("feed.markSeen")}
                  failedText={tr.t("feed.markSeenFailed")}
                />
              )}
              {feed.reminders.length > 0 && (
                <ul className="nx-updates__list" aria-label={tr.t("feed.reminders.heading")}>
                  {feed.reminders.map((r) => (
                    <li key={r.id}>
                      <span>{tr.t("feed.inAppReminder", { name: ctx.displayName })}</span>
                      {!r.seen && (
                        <span className="pb-chip pb-chip--butter">{tr.t("feed.new")}</span>
                      )}
                      {r.noteId && (
                        <Link href={`/family/events/${r.noteId}`}>{tr.t("feed.openEvent")}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        )}
      </div>
    );
    return (
      <NotesList
        events={ordered}
        language={ctx.language}
        missingNote={Boolean(note)}
        updates={listUpdates}
        viewerId={ctx.memberId}
        recipientName={options.find((m) => m.role === "care_recipient")?.displayName ?? null}
      />
    );
  }
  const recipientRow = options.find((m) => m.role === "care_recipient") ?? null;
  const portraits = await portraitVersions(outcome.supabase, ctx.householdId).catch(
    () => new Map<string, string>(),
  );
  const portraitStamp = recipientRow ? (portraits.get(recipientRow.id) ?? null) : null;
  const timeline = await getEventTimeline(outcome.supabase, selected.noteId).catch(() => []);
  const quotes = selected.parts.flatMap((p) => (p.sourceQuote ? [p.sourceQuote] : []));
  return (
    <>
      {updates}
      <HomeBoard
        event={selected}
        viewer={{ ...viewer, name: ctx.displayName, portraitSrc: portraitUrl(ctx.memberId, portraits.get(ctx.memberId)) }}
        members={members}
        language={ctx.language}
        nowIso={now.toISOString()}
        recipient={
          recipientRow
            ? {
                id: recipientRow.id,
                name: recipientRow.displayName,
                portraitSrc: portraitStamp
                  ? `/family/members/${recipientRow.id}/portrait?v=${encodeURIComponent(portraitStamp)}`
                  : null,
              }
            : null
        }
        quotes={quotes}
        timeline={timeline}
        initialTaskId={typeof task === "string" && isUuid(task) ? task : null}
      />
    </>
  );
}
