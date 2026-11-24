import { firstRunPrompts } from "@/lib/membership/first-run";
import Link from "next/link";
import { recipientSentences, type RecipientSentence } from "@/lib/family/recipient-sentences";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language, type Translator } from "@/lib/i18n/messages";
import { buildEventCard, type CardWhen } from "@/lib/family/event-card";
import { ICON, initial, monthName, timeText, weekdayName } from "./card-parts";
import { ReadAloudButton, ReplyButtons } from "./recipient-actions";
import { TodayLine } from "./today-line";

/**
 * Grandma's own assistant (Requirement 13). It greets her by name, says in one
 * sentence what is happening, puts the next thing first ("Coming up"), and can
 * read it aloud. Her only actions are taking a photo and the two fixed replies.
 * Every sentence is a fixed dictionary sentence filled with names and times.
 */
const TEXT = "family-recipient family-assistant";

function SentenceList({ sentences, tr }: { sentences: RecipientSentence[]; tr: Translator }) {
  return (
    <ul className="grid gap-3">
      {sentences.map((s, i) => (
        <li key={`${s.key}-${i}`} className="family-assistant__line">
          {tr.t(s.key, s.params)}
        </li>
      ))}
    </ul>
  );
}

/** Details the family sorts out among themselves; Grandma does not need to hear them. */
const FAMILY_ONLY = new Set([
  "recipient.missing.which_person",
  "recipient.missing.when_is_deadline",
  "recipient.missing.which_contact",
]);
const MAX_LINES = 6;

/** One line per thing, without repeats or family-only details, so the card stays calm. */
export function forGrandma(sentences: readonly RecipientSentence[]): RecipientSentence[] {
  const seen = new Set<string>();
  const out: RecipientSentence[] = [];
  for (const s of sentences) {
    if (FAMILY_ONLY.has(s.key)) continue;
    const id = `${s.key}|${JSON.stringify(s.params ?? {})}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out.slice(0, MAX_LINES);
}

function titleOf(event: SharedCareEvent, tr: Translator): string {
  const title = event.state === "ready" ? event.title?.trim() : "";
  return title || tr.t("recipient.noteFallback");
}

/** "Haruko (Mom)" -> "Haruko". The name is shown as the family wrote it, never translated. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? "").replace(/\s*[(（].*?[)）]\s*/g, " ").trim();
}

function isOpen(event: SharedCareEvent): boolean {
  return event.state === "ready" && !event.done && event.parts.length > 0;
}

/** Soonest family-confirmed appointment among the event's open parts, as a sort key. */
function nextTime(event: SharedCareEvent): number {
  const times = event.parts
    .filter((p) => p.progressStatus !== "completed" && p.progressStatus !== "cancelled")
    .map((p) => p.confirmed.appointment?.at)
    .filter((at): at is string => Boolean(at))
    .map((at) => Date.parse(at));
  return times.length ? Math.min(...times) : Number.POSITIVE_INFINITY;
}

/** The note to show first: the open one with the soonest confirmed time, else the newest open one. */
export function pickComingUp(events: readonly SharedCareEvent[]): SharedCareEvent | null {
  const open = events.filter(isOpen);
  if (open.length === 0) return null;
  return [...open].sort((a, b) => nextTime(a) - nextTime(b))[0];
}

type Mood = "reading" | "onIt" | "allDone" | "nothingYet";

export function assistantMood(events: readonly SharedCareEvent[]): Mood {
  if (events.length === 0) return "nothingYet";
  if (events.some((e) => e.state === "reading" || e.state === "uploaded")) return "reading";
  if (events.some(isOpen)) return "onIt";
  return "allDone";
}

function plainText(sentences: RecipientSentence[], tr: Translator): string {
  return sentences.map((s) => tr.t(s.key, s.params)).join(" ");
}

/** "11月27日（金）" / "Fri, Nov 27": the full date line inside the big orange block. */
function dateLine(when: Exclude<CardWhen, { kind: "unknown" }>, language: Language): string {
  const weekday = weekdayName(when.weekday, language);
  return language === "ja"
    ? `${when.month}月${when.day}日（${weekday}）`
    : `${weekday}, ${monthName(when.month, language)} ${when.day}`;
}
/**
 * Grandma's picture card: her name, one big orange block with the date, time and
 * place, faces of who goes with her, and icons for what to bring. Only a time the
 * family confirmed is shown (Requirement 13); otherwise "your family is checking the time".
 */
export function GrandmaCard({
  event,
  language,
  name,
  headingLevel = "h2",
}: {
  event: SharedCareEvent;
  language: Language;
  name?: string;
  headingLevel?: "h1" | "h2";
}) {
  const tr = createTranslator(language);
  const card = buildEventCard(event, { mainRule: "nextOpen" });
  const main = card.main;
  if (!main) return null;
  const when: CardWhen = main.when.kind === "confirmed" ? main.when : { kind: "unknown" };
  const time = timeText(when);
  const people = main.slots.filter((s) => s.role !== "owner");
  const shown = people.length > 0 ? people : main.slots;
  const Heading = headingLevel;
  const what = (
    <p className="grandma-card__what">
      <span aria-hidden="true">{ICON[main.icon]}</span>
      {main.place ?? tr.t(`card.icon.${main.icon}` as "card.icon.clinic")}
    </p>
  );
  return (
    <div className="grid gap-5">
      {name && <Heading className="grandma-card__name">{tr.t("grandma.name", { name })}</Heading>}
      {time && when.kind !== "unknown" ? (
        <div className="grandma-card__hero">
          <p className="grandma-card__date">{dateLine(when, language)}</p>
          <p className="grandma-card__time">{time}</p>
          {what}
        </div>
      ) : (
        <div className="grandma-card__hero grandma-card__hero--waiting">
          <p className="grandma-card__waiting">
            <span aria-hidden="true">⏳</span> {tr.t("grandma.timeChecking")}
          </p>
          {what}
        </div>
      )}
      <div className="grid gap-3">
        <h3 className="grandma-card__label">{tr.t("grandma.goingWith")}</h3>
        <ul className="flex flex-wrap justify-center gap-6">
          {shown.map((slot) => (
            <li key={slot.role} className="grid justify-items-center gap-1">
              <span
                aria-hidden="true"
                className={`grandma-card__face ${slot.member ? "" : "grandma-card__face--empty"}`}
              >
                {slot.member ? initial(firstName(slot.member.name)) : "?"}
              </span>
              <span className="text-xl">{slot.member ? firstName(slot.member.name) : tr.t("grandma.notYet")}</span>
            </li>
          ))}
        </ul>
      </div>
      {card.items.length > 0 && (
        <div className="grid gap-3">
          <h3 className="grandma-card__label">{tr.t("grandma.bring")}</h3>
          <ul className="flex flex-wrap justify-center gap-5">
            {card.items.map((item) => (
              <li key={item.partId} className="grid justify-items-center gap-1 text-center">
                <span className="text-5xl" aria-hidden="true">
                  {item.done ? "✅" : ICON[item.icon]}
                </span>
                <span className="text-lg text-stone-700">{item.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
/** The two big square buttons under Grandma's card: read it to me, and photograph a new note. */
export function GrandmaButtons({
  text,
  language,
  onMemo,
}: {
  text: string;
  language: Language;
  /** On /demo the memo button runs this instead of opening the camera page. */
  onMemo?: () => void;
}) {
  const tr = createTranslator(language);
  const inner = (
    <>
      <span aria-hidden="true" className="text-4xl">
        📷
      </span>
      <span>{tr.t("grandma.memo")}</span>
    </>
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      <ReadAloudButton text={text} language={language} variant="tile" />
      {onMemo ? (
        <button type="button" onClick={onMemo} className="grandma-card__tile grandma-card__tile--dark">
          {inner}
        </button>
      ) : (
        <Link href="/family/capture" className="grandma-card__tile grandma-card__tile--dark">
          {inner}
        </Link>
      )}
    </div>
  );
}
/** What Grandma's speaker button reads for one event. */
export function grandmaSpeech(event: SharedCareEvent, language: Language): string {
  const tr = createTranslator(language);
  return `${titleOf(event, tr)}. ${plainText(forGrandma(recipientSentences(event, language)), tr)}`;
}
export function TakePhotoLink({ tr }: { tr: Translator }) {
  return (
    <Link href="/family/capture" className="app-button family-recipient__photo family-assistant__photo">
      <span aria-hidden="true">📷</span> {tr.t("recipient.takePhoto")}
    </Link>
  );
}

function AssistantSays({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="family-assistant__avatar">
        F
      </span>
      <p className="family-assistant__bubble" role="status">
        {text}
      </p>
    </div>
  );
}

export function RecipientHomeView({
  events,
  language,
  recipientName,
}: {
  events: SharedCareEvent[];
  language: Language;
  recipientName?: string | null;
}) {
  const tr = createTranslator(language);
  const name = firstName(recipientName);
  const mood = assistantMood(events);
  const comingUp = pickComingUp(events);
  const others = events.filter((e) => e !== comingUp);
  const comingSentences = comingUp ? forGrandma(recipientSentences(comingUp, language)) : [];
  const greeting = name ? tr.t("assistant.hello", { name }) : tr.t("assistant.helloNoName");
  const says = tr.t(`assistant.${mood}`);

  return (
    <div className={`${TEXT} grid gap-8`}>
      <header className="grid gap-1">
        <TodayLine language={language} />
        <h1 className="family-assistant__hello">{greeting}</h1>
      </header>

      <AssistantSays text={says} />

      {mood === "nothingYet" && (
        <>
          {firstRunPrompts({
            viewerRole: "care_recipient",
            eventCount: events.length,
            activeMemberCount: 0,
            hasActiveRecipient: true,
            dismissed: new Set(),
          }).includes("recipient_take_photo") && <p>{tr.t("firstRun.recipient.body")}</p>}
          <p>
            <TakePhotoLink tr={tr} />
          </p>
        </>
      )}

      {comingUp && (
        <section aria-labelledby="coming-up" className="family-assistant__card grid gap-5">
          <p className="family-assistant__kicker" id="coming-up">
            {tr.t("assistant.comingUp")}
          </p>
          <h2 className="sr-only">{titleOf(comingUp, tr)}</h2>
          <GrandmaCard event={comingUp} language={language} />
          <GrandmaButtons
            text={`${greeting} ${says} ${titleOf(comingUp, tr)}. ${plainText(comingSentences, tr)}`}
            language={language}
          />
          <p>
            <Link href={`/family/me/${comingUp.noteId}`} className="app-link family-recipient__link">
              {tr.t("recipient.see")}
            </Link>
          </p>
          <ReplyButtons noteId={comingUp.noteId} language={language} />
        </section>
      )}

      {others.length > 0 && (
        <section aria-labelledby="recipient-latest" className="grid gap-4">
          <h2 id="recipient-latest" className="app-subtitle">
            {comingUp ? tr.t("assistant.otherNotes") : tr.t("recipient.latest")}
          </h2>
          <ul className="grid gap-4">
            {others.map((event) => {
              const headingId = `recipient-note-${event.noteId}`;
              return (
                <li key={event.noteId}>
                  <Link
                    href={`/family/me/${event.noteId}`}
                    aria-labelledby={headingId}
                    className="family-assistant__card family-assistant__noteTile"
                  >
                    <span aria-hidden="true" className="text-4xl">
                      {event.done ? "✅" : event.state === "ready" ? ICON[buildEventCard(event).main?.icon ?? "home"] : "⏳"}
                    </span>
                    <span id={headingId} className="text-xl font-bold">
                      {titleOf(event, tr)}
                    </span>
                    <span aria-hidden="true" className="text-3xl">
                      ›
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {mood !== "nothingYet" && (
        <p>
          <TakePhotoLink tr={tr} />
        </p>
      )}
    </div>
  );
}

export function RecipientEventView({
  event,
  language,
  recipientName,
}: {
  event: SharedCareEvent;
  language: Language;
  recipientName?: string | null;
}) {
  const tr = createTranslator(language);
  const src = `/notes/${event.noteId}/image`;
  const detailed = event.state === "ready" && !event.done && event.parts.length > 0;
  const flat = detailed ? [] : forGrandma(recipientSentences(event, language));
  const name = firstName(recipientName);
  const spoken = detailed ? forGrandma(recipientSentences(event, language)) : flat;
  return (
    <div className={`${TEXT} grid gap-8`}>
      <p>
        <Link href="/family" className="app-link family-recipient__link">
          {tr.t("recipient.back")}
        </Link>
      </p>
      {detailed ? (
        <section aria-label={titleOf(event, tr)} className="grandma-card grid gap-6">
          {!name && <h1 className="grandma-card__name">{titleOf(event, tr)}</h1>}
          <GrandmaCard event={event} language={language} name={name || undefined} headingLevel="h1" />
          <GrandmaButtons text={`${titleOf(event, tr)}. ${plainText(spoken, tr)}`} language={language} />
        </section>
      ) : (
        <>
          <h1 className="family-assistant__hello">{titleOf(event, tr)}</h1>
          <SentenceList sentences={flat} tr={tr} />
          <ReadAloudButton text={`${titleOf(event, tr)}. ${plainText(flat, tr)}`} language={language} />
        </>
      )}
      {event.state === "ready" && <ReplyButtons noteId={event.noteId} language={language} />}
      <section aria-labelledby="recipient-photo" className="grid gap-3">
        <h2 id="recipient-photo" className="app-subtitle">
          {tr.t("recipient.photo.heading")}
        </h2>
        <a href={src} className="family-recipient__link">
          {/* The route checks the session and household on every request. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={tr.t("recipient.photo.alt")} className="max-h-72 w-auto max-w-full rounded border border-stone-400" />
        </a>
        <p>
          <a href={src} className="app-link family-recipient__link">
            {tr.t("recipient.photo.link")}
          </a>
        </p>
      </section>
      <p>
        <TakePhotoLink tr={tr} />
      </p>
    </div>
  );
}
