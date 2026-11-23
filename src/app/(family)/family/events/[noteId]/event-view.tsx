"use client";

import Link from "next/link";
import { useEffect } from "react";

import type { EventViewer, ReceiverOption } from "@/lib/family/event-offers";
import type { SharedCareEvent } from "@/lib/family/shared-care-event";
import { createTranslator, type Language } from "@/lib/i18n/messages";

import { useRunner, type EventActions } from "./event-runner";
import { PartCard } from "./part-card";

export type EventViewProps = {
  event: SharedCareEvent;
  viewer: EventViewer;
  members: readonly ReceiverOption[];
  language: Language;
  nowIso: string;
  actions: EventActions;
  onChanged: () => void;
};

const READING_REFRESH_MS = 5000;

/** The original photo, only through the signed-in `/notes/[noteId]/image` route. */
function OriginalNote({ noteId, language }: { noteId: string; language: Language }) {
  const tr = createTranslator(language);
  const src = `/notes/${noteId}/image`;
  return (
    <figure className="grid gap-2">
      <a href={src} className="app-link min-h-12 py-2 text-lg">
        {/* The route checks the session and household on every request. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={tr.t("event.original.alt")} className="max-h-72 w-auto max-w-full rounded border border-stone-400" />
      </a>
      <figcaption>
        <a href={src} className="app-link text-lg">
          {tr.t("event.original.link")}
        </a>
      </figcaption>
    </figure>
  );
}

function ReadFailed({ event, language, actions, onChanged }: EventViewProps) {
  const tr = createTranslator(language);
  const runner = useRunner(tr, onChanged);
  return (
    <section className="grid gap-3" aria-labelledby="event-failed">
      <h2 id="event-failed" className="text-2xl font-bold">
        {tr.t("event.failed.title")}
      </h2>
      <p className="app-alert" role="alert">
        {tr.t("event.failed.body")}
      </p>
      {event.retryable && (
        <button
          type="button"
          className="app-button"
          disabled={runner.pending}
          onClick={() =>
            runner.run(async () => {
              const result = await actions.retryRecognition(event.noteId);
              return result.ok ? { ...result, messageKey: undefined } : result;
            })
          }
        >
          {runner.pending ? tr.t("event.btn.working") : tr.t("event.failed.retry")}
        </button>
      )}
      <div role="status" aria-live="polite">
        {runner.message?.kind === "status" && <p>{tr.t("event.retryStarted")}</p>}
      </div>
      <div role="alert">{runner.message?.kind === "alert" && <p className="app-alert">{runner.message.text}</p>}</div>
    </section>
  );
}

function ReadingNow({ language, onChanged }: Pick<EventViewProps, "language" | "onChanged">) {
  const tr = createTranslator(language);
  useEffect(() => {
    const timer = setInterval(onChanged, READING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [onChanged]);
  return (
    <section className="grid gap-2" aria-labelledby="event-reading">
      <h2 id="event-reading" className="text-2xl font-bold">
        {tr.t("event.beingRead.title")}
      </h2>
      <p role="status" aria-live="polite">
        {tr.t("event.beingRead.body")}
      </p>
    </section>
  );
}

export function EventView(props: EventViewProps) {
  const { event, viewer, members, language, nowIso, actions, onChanged } = props;
  const tr = createTranslator(language);

  return (
    <div className="grid gap-6">
      <header className="grid gap-2">
        <h1 className="app-title">{event.title ?? tr.t("event.fallbackTitle")}</h1>
        <p>
          <Link href={`/family/events/${event.noteId}/timeline`} className="app-link text-lg">
            {tr.t("event.timeline.link")}
          </Link>
        </p>
      </header>

      {event.state === "reading" && <ReadingNow language={language} onChanged={onChanged} />}
      {event.state === "uploaded" && <p role="status">{tr.t("event.uploaded.body")}</p>}
      {event.state === "failed" && <ReadFailed {...props} />}

      {event.state === "ready" && (
        <section className="grid gap-4" aria-labelledby="event-parts">
          <h2 id="event-parts" className="text-2xl font-bold">
            {tr.t("event.parts.heading")}
          </h2>
          {event.done && <p className="app-success">{tr.t("event.allDone")}</p>}
          {event.parts.length === 0 && <p>{tr.t("event.parts.none")}</p>}
          {event.parts.map((part) => (
            <PartCard
              key={part.id}
              part={part}
              viewer={viewer}
              members={members}
              language={language}
              nowIso={nowIso}
              actions={actions}
              onChanged={onChanged}
            />
          ))}
        </section>
      )}

      <OriginalNote noteId={event.noteId} language={language} />
    </div>
  );
}
