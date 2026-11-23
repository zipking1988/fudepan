"use client";

import { useSyncExternalStore } from "react";
import { createTranslator, type Language } from "@/lib/i18n/messages";

const subscribeNever = () => () => {};

/** "Today is Monday, November 23." in the device's own zone. Empty while rendering on the server. */
export function TodayLine({ language }: { language: Language }) {
  const date = useSyncExternalStore(
    subscribeNever,
    () =>
      new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date()),
    () => "",
  );
  if (!date) return <p className="family-assistant__today">&nbsp;</p>;
  return <p className="family-assistant__today">{createTranslator(language).t("assistant.today", { date })}</p>;
}
