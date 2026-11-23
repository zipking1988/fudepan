import Link from "next/link";

import type { FamilyFeed, FeedEvent, FeedReminder } from "@/lib/family/feed";
import { formatDateTimeInZone } from "@/lib/i18n/format";
import { createTranslator, type Language, type Translator } from "@/lib/i18n/messages";

import { FeedPoller, MarkSeenButton, RetryButton } from "./feed-client";

export type FamilyFeedViewProps = {
  feed: FamilyFeed;
  language: Language;
  householdId: string;
  /** The signed-in Member's display name, used in the reminder sentence. */
  memberName: string;
};

function appointmentText(event: FeedEvent, tr: Translator): string | null {
  if (!event.nextAppointment) return null;
  try {
    const when = formatDateTimeInZone(new Date(event.nextAppointment.at), event.nextAppointment.timeZone, tr.lang);
    return tr.t("feed.nextAppointment", { when });
  } catch {
    // An unknown zone: a wrong time is worse than none.
    return null;
  }
}

function EventCard({ event, tr }: { event: FeedEvent; tr: Translator }) {
  const headingId = `feed-event-${event.noteId}`;
  const title = event.title ?? tr.t(event.titleKey ?? "feed.heading.beingRead");
  const appointment = appointmentText(event, tr);
  const { counts } = event;
  const ready = event.state === "ready";
  return (
    <article aria-labelledby={headingId} className="app-panel grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h3 id={headingId} className="app-subtitle">
          {title}
        </h3>
        {event.unseen && <span className="app-status">{tr.t("feed.new")}</span>}
      </div>

      {event.state === "reading" || event.state === "uploaded" ? (
        <p role="status" aria-live="polite" className="app-reading">
          {tr.t("feed.readingNow")}
        </p>
      ) : null}

      {ready && event.done && <p className="font-semibold">{tr.t("label.done")}</p>}
      {ready && !event.done && (counts.needsSomeone > 0 || counts.awaitingConfirmation > 0) && (
        <ul className="grid gap-1">
          {counts.needsSomeone > 0 && <li>{tr.tCount("feed.parts.needSomeone", counts.needsSomeone)}</li>}
          {counts.awaitingConfirmation > 0 && (
            <li>{tr.t("feed.waitingForConfirmation", { count: counts.awaitingConfirmation })}</li>
          )}
        </ul>
      )}

      {appointment && <p>{appointment}</p>}

      <div className="flex flex-wrap gap-3">
        <Link
          href={`/family/events/${event.noteId}`}
          className="app-button app-button--quiet"
          aria-describedby={headingId}
        >
          {tr.t("feed.open")}
        </Link>
        {event.retry && (
          <>
            <RetryButton
              noteId={event.noteId}
              label={tr.t("feed.retry")}
              failedText={tr.t("feed.retryFailed")}
            />
            <Link href={`/notes/${event.noteId}/image`} className="app-button app-button--quiet">
              {tr.t("feed.viewOriginal")}
            </Link>
          </>
        )}
      </div>
    </article>
  );
}

function EventList({ events, tr }: { events: FeedEvent[]; tr: Translator }) {
  return (
    <ul className="grid gap-4">
      {events.map((e) => (
        <li key={e.noteId}>
          <EventCard event={e} tr={tr} />
        </li>
      ))}
    </ul>
  );
}

function ReminderItem({ reminder, name, tr }: { reminder: FeedReminder; name: string; tr: Translator }) {
  return (
    <li className="flex flex-wrap items-center gap-3">
      <span>{tr.t("feed.inAppReminder", { name })}</span>
      {!reminder.seen && <span className="app-status">{tr.t("feed.new")}</span>}
      {reminder.noteId && (
        <Link href={`/family/events/${reminder.noteId}`} className="app-link">
          {tr.t("feed.openEvent")}
        </Link>
      )}
    </li>
  );
}

/** Pure view of the Family_Feed for a Family_Member. No data loading here. */
export function FamilyFeedView({ feed, language, householdId, memberName }: FamilyFeedViewProps) {
  const tr = createTranslator(language);
  const hasUnseen = feed.newCount > 0 || feed.unseenReminderCount > 0;
  const updates = feed.newCount > 0 ? tr.tCount("feed.newUpdates", feed.newCount) : "";
  return (
    <div className="grid gap-8">
      <h1 className="app-title">{tr.t("feed.title")}</h1>

      <div>
        <Link href="/family/capture" className="app-button">
          {tr.t("nav.capture")}
        </Link>
      </div>

      <FeedPoller message={updates} />

      {hasUnseen && (
        <MarkSeenButton
          householdId={householdId}
          label={tr.t("feed.markSeen")}
          failedText={tr.t("feed.markSeenFailed")}
        />
      )}

      {feed.reminders.length > 0 && (
        <section aria-labelledby="feed-reminders" className="grid gap-3">
          <h2 id="feed-reminders" className="app-subtitle">
            {tr.t("feed.reminders.heading")}
          </h2>
          <ul className="grid gap-2">
            {feed.reminders.map((r) => (
              <ReminderItem key={r.id} reminder={r} name={memberName} tr={tr} />
            ))}
          </ul>
        </section>
      )}

      {feed.events.length === 0 && (
        <section aria-labelledby="feed-empty" className="grid gap-2">
          <h2 id="feed-empty" className="app-subtitle">
            {tr.t("feed.empty")}
          </h2>
          <p className="app-lede">{tr.t("feed.empty.hint")}</p>
        </section>
      )}

      {feed.needsSomeone.length > 0 && (
        <section aria-labelledby="feed-needs-someone" className="grid gap-4">
          <h2 id="feed-needs-someone" className="app-subtitle">
            {tr.t("feed.heading.needsSomeone")}
          </h2>
          <EventList events={feed.needsSomeone} tr={tr} />
        </section>
      )}

      {feed.other.length > 0 && (
        <section aria-labelledby="feed-latest" className="grid gap-4">
          <h2 id="feed-latest" className="app-subtitle">
            {tr.t("feed.heading.latest")}
          </h2>
          <EventList events={feed.other} tr={tr} />
        </section>
      )}
    </div>
  );
}
