"use client";

import { useSyncExternalStore } from "react";
import { formatUtcDateTimeLang, type Language } from "@/lib/i18n/format";

const subscribe = () => () => {};

/** A moment in the reader's own time zone, with the zone named. The server render shows UTC. */
export function LocalTime({ iso, language, compact = false }: { iso: string; language: Language; compact?: boolean }) {
  const text = useSyncExternalStore(
    subscribe,
    () => {
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return iso;
      return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
        // dateStyle/timeStyle cannot be combined with timeZoneName, so name each field.
        ...(compact ? {} : { year: "numeric" as const, timeZoneName: "short" as const }),
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    },
    () => {
      const date = new Date(iso);
      return Number.isNaN(date.getTime()) ? iso : formatUtcDateTimeLang(date, language);
    },
  );
  return <time dateTime={iso}>{text}</time>;
}

const SLOT = "\u0000";

/** Fills the `{time}` of a translated sentence with a LocalTime. Pass the sentence made with `{ time: SLOT }`. */
export function TimedText({ sentence, iso, language }: { sentence: string; iso: string; language: Language }) {
  const [before, ...rest] = sentence.split(SLOT);
  return (
    <>
      {before}
      <LocalTime iso={iso} language={language} />
      {rest.join(SLOT)}
    </>
  );
}

export const TIME_SLOT = SLOT;
