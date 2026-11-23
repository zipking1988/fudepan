import Link from "next/link";
import { sentencesForPart, recipientSentences, type RecipientSentence } from "@/lib/family/recipient-sentences";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language, type Translator } from "@/lib/i18n/messages";
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
        <p>
          <TakePhotoLink tr={tr} />
        </p>
      )}

      {comingUp && (
        <section aria-labelledby="coming-up" className="family-assistant__card grid gap-5">
          <p className="family-assistant__kicker" id="coming-up">
            {tr.t("assistant.comingUp")}
          </p>
          <h2 className="family-assistant__title">{titleOf(comingUp, tr)}</h2>
          <SentenceList sentences={comingSentences} tr={tr} />
          <ReadAloudButton
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
                  <article aria-labelledby={headingId} className="family-assistant__card grid gap-3">
                    <h3 id={headingId} className="text-2xl font-bold">
                      {titleOf(event, tr)}
                    </h3>
                    <SentenceList sentences={forGrandma(recipientSentences(event, language))} tr={tr} />
                    <p>
                      <Link
                        href={`/family/me/${event.noteId}`}
                        className="app-link family-recipient__link"
                        aria-describedby={headingId}
                      >
                        {tr.t("recipient.see")}
                      </Link>
                    </p>
                  </article>
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

export function RecipientEventView({ event, language }: { event: SharedCareEvent; language: Language }) {
  const tr = createTranslator(language);
  const src = `/notes/${event.noteId}/image`;
  const detailed = event.state === "ready" && !event.done && event.parts.length > 0;
  const groups = detailed
    ? event.parts.map((part) => {
        const sentences = forGrandma(sentencesForPart(part, language));
        return { part, sentences: sentences.length === 0 ? [{ key: "recipient.allDone" } as RecipientSentence] : sentences };
      })
    : [];
  const flat = detailed ? [] : forGrandma(recipientSentences(event, language));
  const spoken = detailed
    ? groups.map((g) => `${g.part.title}. ${plainText(g.sentences, tr)}`).join(" ")
    : plainText(flat, tr);

  return (
    <div className={`${TEXT} grid gap-8`}>
      <p>
        <Link href="/family" className="app-link family-recipient__link">
          {tr.t("recipient.back")}
        </Link>
      </p>
      <h1 className="family-assistant__hello">{titleOf(event, tr)}</h1>
      <ReadAloudButton text={`${titleOf(event, tr)}. ${spoken}`} language={language} />
      {detailed ? (
        <ul className="grid gap-6">
          {groups.map(({ part, sentences }) => {
            const headingId = `recipient-part-${part.id}`;
            return (
              <li key={part.id}>
                <section aria-labelledby={headingId} className="family-assistant__card grid gap-3">
                  <h2 id={headingId} className="text-2xl font-bold">
                    {part.title}
                  </h2>
                  <SentenceList sentences={sentences} tr={tr} />
                </section>
              </li>
            );
          })}
        </ul>
      ) : (
        <SentenceList sentences={flat} tr={tr} />
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
