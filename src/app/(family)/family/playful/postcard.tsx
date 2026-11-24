import Link from "next/link";
import { pickMainPart } from "@/lib/family/event-card";
import { firstName } from "@/lib/family/names";
import { forGrandma } from "@/app/(family)/family/recipient-view";
import { recipientSentences } from "@/lib/family/recipient-sentences";
import { taskState } from "@/lib/family/playful";
import type { EventPart, MemberRef, SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language, type MessageKey, type Translator } from "@/lib/i18n/messages";
import { ReadAloudButton } from "@/app/(family)/family/recipient-actions";
import { OriginalNote } from "./original-note";
import { PostcardReplies } from "./postcard-replies";
import { Avatar, Chip, Icon, Stamp, Tape } from "./ui";

/**
 * Grandma's postcard: one big appointment card with the date, time and place the family
 * confirmed, the people who go with her, what to bring, and two fixed replies. Every sentence is
 * a fixed dictionary sentence filled with names and times a person entered. Nothing from the
 * model is shown as a fact, and no medical advice appears.
 */
function whenParts(part: EventPart | null, language: Language) {
  const t = part?.confirmed.appointment;
  if (!t || t.provenance !== "human_confirmed") return null;
  try {
    const locale = language === "ja" ? "ja-JP" : "en-US";
    const at = new Date(t.at);
    const day = new Intl.DateTimeFormat(locale, {
      timeZone: t.timeZone,
      month: "long",
      day: "numeric",
      weekday: "short",
    }).format(at);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: t.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
    return { day, time };
  } catch {
    return null;
  }
}

function PersonCard({
  member,
  role,
  householdId,
}: {
  member: MemberRef;
  role: string;
  householdId: string;
}) {
  return (
    <li className="pb-guest">
      <Avatar name={member.name} householdId={householdId} memberId={member.id} size={84} ring />
      <span className="pb-guest__text">
        <strong>{firstName(member.name)}</strong>
        <span>{role}</span>
      </span>
    </li>
  );
}

const KEEP = new Set(["recipient.checking", "recipient.timeNotConfirmed"]);

export function Postcard({
  event,
  language,
  householdId,
  headingLevel = 1,
  showReplies = true,
}: {
  event: SharedCareEvent;
  language: Language;
  householdId: string;
  headingLevel?: 1 | 2;
  showReplies?: boolean;
}) {
  const tr = createTranslator(language);
  const H = headingLevel === 1 ? "h1" : "h2";
  const title = event.state === "ready" && event.title?.trim() ? event.title.trim() : tr.t("recipient.noteFallback");

  if (event.state !== "ready") {
    return (
      <article className="pb-postcard pb-postcard--quiet" aria-labelledby={`pc-${event.noteId}`}>
        <H id={`pc-${event.noteId}`} className="pb-card-title">
          {event.state === "failed" ? tr.t("recipient.notRead") : tr.t("pb.card.readingTitle")}
        </H>
        <p role="status">{event.state === "failed" ? tr.t("recipient.notRead") : tr.t("recipient.beingRead")}</p>
      </article>
    );
  }

  const main = pickMainPart(event.parts);
  const when = whenParts(main, language);
  const open = event.parts.filter((p) => p.progressStatus !== "completed" && p.progressStatus !== "cancelled");
  const confirmed =
    main !== null &&
    when !== null &&
    (main.approvalState === "approved" || !main.approvalRequired || main.progressStatus === "completed");
  const people: { member: MemberRef; role: string }[] = [];
  if (main) {
    const seen = new Set<string>();
    const add = (m: MemberRef | null, role: string) => {
      if (m && !seen.has(m.id)) {
        seen.add(m.id);
        people.push({ member: m, role });
      }
    };
    add(main.driver, tr.t("pb.role.driver"));
    add(main.companion, tr.t("pb.role.companion"));
    add(main.owner, tr.t("pb.role.owner"));
  }
  const bring = event.parts.filter((p) => p !== main && p.careCategory === "document" && p.progressStatus !== "cancelled");
  const others = open.filter((p) => p !== main && p.careCategory !== "document");
  const unsettled = forGrandma(recipientSentences(event, language)).filter(
    (s) => KEEP.has(s.key) || s.key.startsWith("recipient.missing."),
  );
  const speech = [
    title,
    when ? `${when.day} ${when.time}` : "",
    main?.location ?? "",
    ...people.map((p) => `${firstName(p.member.name)}, ${p.role}`),
  ]
    .filter(Boolean)
    .join(". ");
  const quotes = event.parts.flatMap((p) => (p.sourceQuote ? [p.sourceQuote] : []));

  return (
    <article className="pb-postcard" aria-labelledby={`pc-${event.noteId}`} data-recipient-card>
      <div className="pb-postcard__top">
        <H id={`pc-${event.noteId}`} className="pb-card-title">
          <span className="pb-title__mark">{title}</span>
        </H>
        {event.done ? (
          <Stamp>{tr.t("pb.stamp.done")}</Stamp>
        ) : confirmed ? (
          <Chip tone="mint">
            <Icon name="check" size={18} /> {tr.t("pb.card.confirmed")}
          </Chip>
        ) : (
          <Chip tone="butter">{tr.t("pb.card.notConfirmed")}</Chip>
        )}
      </div>

      <div className="pb-ticket">
        <Tape tone="check" className="pb-ticket__tape" />
        <p className="pb-ticket__day">
          <Icon name="calendar" size={30} /> <span>{when?.day ?? tr.t("grandma.notYet")}</span>
        </p>
        <p className="pb-ticket__time" aria-label={when?.time ?? undefined}>
          {when?.time ?? "--:--"}
        </p>
        <p className="pb-ticket__place">
          <Icon name="pin" size={30} /> <span>{main?.location ?? tr.t("recipient.missing.which_clinic")}</span>
        </p>
      </div>

      <section className="pb-guests" aria-labelledby={`pcg-${event.noteId}`}>
        <h2 id={`pcg-${event.noteId}`} className="pb-ribbon pb-ribbon--butter">
          {tr.t("pb.card.people")}
        </h2>
        {people.length > 0 ? (
          <ul>
            {people.map((p) => (
              <PersonCard key={p.member.id} member={p.member} role={p.role} householdId={householdId} />
            ))}
          </ul>
        ) : (
          <p className="pb-guests__none">{tr.t("pb.card.noPeople")}</p>
        )}
      </section>

      {bring.length > 0 && (
        <p className="pb-bring">
          <Icon name="card" size={34} />
          <span className="pb-bring__label">{tr.t("pb.card.bring")}</span>
          <span className="pb-bring__items">{bring.map((p) => p.title).join(" · ")}</span>
          <span className="sr-only">
            {bring.map((p) => `${p.title}: ${tr.t(taskState(p) === "done" ? "label.done" : "pb.home.unassigned")}`).join(", ")}
          </span>
        </p>
      )}

      {unsettled.length > 0 && (
        <section className="pb-unsettled" aria-label={tr.t("pb.card.stillOpen")}>
          <h2 className="pb-unsettled__title">{tr.t("pb.card.stillOpen")}</h2>
          <ul>
            {unsettled.map((s, i) => (
              <li key={`${s.key}-${i}`}>{tr.t(s.key, s.params)}</li>
            ))}
          </ul>
        </section>
      )}

      {others.length > 0 && (
        <section className="pb-others" aria-label={tr.t("pb.card.other")}>
          <h2 className="pb-unsettled__title">{tr.t("pb.card.other")}</h2>
          <ul>
            {others.map((p) => (
              <li key={p.id}>
                {p.title}
                {p.owner && <span> · {firstName(p.owner.name)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="pb-postcard__tools">
        <ReadAloudButton text={speech} language={language} />
        <OriginalNote
          noteId={event.noteId}
          quotes={quotes}
          className="pb-linkbtn"
          labels={{
            open: tr.t("pb.memo.view"),
            title: tr.t("pb.memo.title"),
            close: tr.t("pb.memo.close"),
            alt: tr.t("pb.memo.photoAlt"),
          }}
        />
      </div>
      {showReplies && <PostcardReplies noteId={event.noteId} language={language} />}
    </article>
  );
}

export function PostcardList({
  events,
  language,
  householdId,
  selectedId,
  tr,
}: {
  events: readonly SharedCareEvent[];
  language: Language;
  householdId: string;
  selectedId?: string;
  tr: Translator;
}) {
  const selected = events.find((e) => e.noteId === selectedId) ?? events.find((e) => e.state === "ready" && !e.done) ?? events[0];
  const rest = events.filter((e) => e !== selected);
  return (
    <div className="pb-recipient">
      <div className="pb-recipient__bar">
        <Link href="/family/capture" className="pb-btn pb-btn--outline">
          <Icon name="camera" size={22} /> {tr.t("pb.card.camera")}
        </Link>
      </div>
      {selected ? (
        <Postcard event={selected} language={language} householdId={householdId} />
      ) : (
        <div className="pb-state">
          <p className="pb-state__title">{tr.t("pb.card.empty")}</p>
        </div>
      )}
      {rest.length > 0 && (
        <nav className="pb-notes" aria-label={tr.t("pb.card.latest")}>
          <h2 className="pb-notes__title">{tr.t("pb.card.latest")}</h2>
          <ul>
            {rest.map((e) => (
              <li key={e.noteId}>
                <Link href={`/family/me/${e.noteId}`}>
                  {e.state === "ready" && e.title ? e.title : tr.t(("recipient.noteFallback") as MessageKey)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
