"use client";

import { useSyncExternalStore } from "react";

import { formatLocalDateTimeLang, formatUtcDateTimeLang, type Language } from "@/lib/i18n/format";

const subscribe = () => () => {};

/**
 * A timestamp in the reader's time zone. The server renders UTC (labelled as
 * such); after hydration the browser re-renders it in local time.
 */
export function LocalDateTime({ iso, lang = "en" }: { iso: string; lang?: Language }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  return (
    <time dateTime={iso}>{inBrowser ? formatLocalDateTimeLang(date, lang) : formatUtcDateTimeLang(date, lang)}</time>
  );
}
