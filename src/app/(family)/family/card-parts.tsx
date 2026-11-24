import type { CardIcon, CardWhen } from "@/lib/family/event-card";
import { createTranslator, type Language } from "@/lib/i18n/messages";

/**
 * Picture pieces shared by the family event card (client) and Grandma's card
 * (server): the icon for each kind of thing, the big date tile, and the time.
 * No hooks and no browser APIs, so both sides can render them.
 */
export const ICON: Record<CardIcon, string> = {
  clinic: "🏥",
  medicine: "💊",
  car: "🚗",
  card: "🪪",
  money: "💴",
  phone: "📞",
  home: "🏠",
  health: "🩺",
};
const LOCALE = { en: "en-US", ja: "ja-JP" } as const;

const pad = (n: number) => String(n).padStart(2, "0");

export function weekdayName(weekday: number, language: Language): string {
  // 2026-11-22 is a Sunday; add the weekday to reach the right one.
  const date = new Date(Date.UTC(2026, 10, 22 + weekday));
  return new Intl.DateTimeFormat(LOCALE[language], { weekday: "short", timeZone: "UTC" }).format(date);
}

export function monthName(month: number, language: Language): string {
  return new Intl.DateTimeFormat(LOCALE[language], { month: "short", timeZone: "UTC" }).format(
    new Date(Date.UTC(2026, month - 1, 1)),
  );
}

export function initial(name: string | null | undefined): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

export function shortName(name: string | null | undefined): string {
  return (name ?? "").replace(/\s*[(（].*?[)）]\s*/g, " ").trim();
}

export function DateTile({
  when,
  language,
  size = "md",
  dateUnknown = when.kind === "unknown",
}: {
  when: CardWhen;
  language: Language;
  size?: "md" | "lg";
  /** From `main.prompts.dateUnknown`. False for a completed Part, which shows Done instead of a question. */
  dateUnknown?: boolean;
}) {
  const tr = createTranslator(language);
  const big = size === "lg";
  if (when.kind === "unknown" && !dateUnknown) {
    return (
      <div className={`family-card__date ${big ? "family-card__date--lg" : ""}`}>
        <span className="family-card__day" aria-hidden="true">
          ✅
        </span>
        <span className="sr-only">{tr.t("label.done")}</span>
      </div>
    );
  }
  if (when.kind === "unknown") {
    return (
      <div className={`family-card__date family-card__date--unknown ${big ? "family-card__date--lg" : ""}`}>
        <span className="family-card__day">?</span>
        <span className="sr-only">{tr.t("card.dateUnknown")}</span>
      </div>
    );
  }
  return (
    <div
      className={`family-card__date ${when.kind === "fromNote" ? "family-card__date--note" : ""} ${big ? "family-card__date--lg" : ""}`}
    >
      <span className="family-card__month">{monthName(when.month, language)}</span>
      <span className="family-card__day">{when.day}</span>
      <span className="family-card__weekday">{weekdayName(when.weekday, language)}</span>
    </div>
  );
}

export function timeText(when: CardWhen): string | null {
  if (when.kind === "unknown" || when.hour === null || when.minute === null) return null;
  return `${when.hour}:${pad(when.minute)}`;
}

