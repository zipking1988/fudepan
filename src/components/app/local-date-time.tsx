"use client";

import { useSyncExternalStore } from "react";

import { formatLocalDateTime, formatUtcDateTime } from "@/lib/format-date";

const subscribe = () => () => {};

/**
 * A timestamp in the reader's time zone. The server renders UTC (labelled as
 * such); after hydration the browser re-renders it in local time.
 */
export function LocalDateTime({ iso }: { iso: string }) {
  const inBrowser = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  return (
    <time dateTime={iso}>{inBrowser ? formatLocalDateTime(date) : formatUtcDateTime(date)}</time>
  );
}
