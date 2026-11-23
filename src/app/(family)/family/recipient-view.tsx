import Link from "next/link";
import { sentencesForPart, recipientSentences, type RecipientSentence } from "@/lib/family/recipient-sentences";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language, type Translator } from "@/lib/i18n/messages";

/**
 * Pure, read-only views for the care recipient (Requirement 13). No forms, no buttons, no
 * claim/approve/complete controls. The only action is the link to take a photo.
 */

const BIG_LINK = "app-button family-recipient__photo";
const TEXT = "family-recipient";

function Sentences({ sentences, tr }: { sentences: RecipientSentence[]; tr: Translator }) {
  return (
    <div className="grid gap-2">
      {sentences.map((s, i) => (
        <p key={`${s.key}-${i}`}>{tr.t(s.key, s.params)}</p>
      ))}
    </div>
  );
}

function titleOf(event: SharedCareEvent, tr: Translator): string {
  const title = event.state === "ready" ? event.title?.trim() : "";
  return title || tr.t("recipient.noteFallback");
}

export function TakePhotoLink({ tr }: { tr: Translator }) {
  return (
    <Link href="/family/capture" className={BIG_LINK}>
      {tr.t("recipient.takePhoto")}
    </Link>
  );
}

export function RecipientHomeView({ events, language }: { events: SharedCareEvent[]; language: Language }) {
  const tr = createTranslator(language);
  return (
    <div className={`${TEXT} grid gap-8`}>
      <h1 className="app-title">{tr.t("recipient.title")}</h1>
      <p>
        <TakePhotoLink tr={tr} />
      </p>
      <p>{tr.t("recipient.readOnly")}</p>
      {events.length === 0 ? (
        <p>{tr.t("recipient.empty")}</p>
      ) : (
        <section aria-labelledby="recipient-latest" className="grid gap-4">
          <h2 id="recipient-latest" className="app-subtitle">
            {tr.t("recipient.latest")}
          </h2>
          <ul className="grid gap-4">
            {events.map((event) => {
              const headingId = `recipient-note-${event.noteId}`;
              return (
                <li key={event.noteId}>
                  <article aria-labelledby={headingId} className="app-panel grid gap-3">
                    <h3 id={headingId} className="text-2xl font-bold">
                      {titleOf(event, tr)}
                    </h3>
                    <Sentences sentences={recipientSentences(event, language)} tr={tr} />
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
    </div>
  );
}

export function RecipientEventView({ event, language }: { event: SharedCareEvent; language: Language }) {
  const tr = createTranslator(language);
  const src = `/notes/${event.noteId}/image`;
  const detailed = event.state === "ready" && !event.done && event.parts.length > 0;
  return (
    <div className={`${TEXT} grid gap-8`}>
      <p>
        <Link href="/family" className="app-link family-recipient__link">
          {tr.t("recipient.back")}
        </Link>
      </p>
      <h1 className="app-title">{titleOf(event, tr)}</h1>
      {detailed ? (
        <ul className="grid gap-6">
          {event.parts.map((part) => {
            const headingId = `recipient-part-${part.id}`;
            const sentences = sentencesForPart(part, language);
            const closed = sentences.length === 0;
            return (
              <li key={part.id}>
                <section aria-labelledby={headingId} className="app-panel grid gap-3">
                  <h2 id={headingId} className="text-2xl font-bold">
                    {part.title}
                  </h2>
                  <Sentences sentences={closed ? [{ key: "recipient.allDone" }] : sentences} tr={tr} />
                </section>
              </li>
            );
          })}
        </ul>
      ) : (
        <Sentences sentences={recipientSentences(event, language)} tr={tr} />
      )}
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
