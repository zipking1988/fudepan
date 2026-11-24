import type { ReactNode } from "react";
import { initialOf, portraitFor } from "@/lib/family/playful";

/**
 * Small picture pieces of the Playful Dashboard: icons, photo avatars, ink stamps, tape and the
 * progress bar. No hooks and no browser APIs, so server and client components can both use them.
 */
const PATHS = {
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  camera: "M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  card: "M3 6h18v12H3zM8.5 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 15.5c.5-2 5-2 6 0M14 9h4M14 13h4",
  clinic: "M5 21V8h14v13M3 21h18M12 11v4M10 13h4M9 8V5h6v3M9 21v-3h6v3",
  glasses: "M2 14a4 4 0 1 0 8 0 4 4 0 0 0-8 0zM14 14a4 4 0 1 0 8 0 4 4 0 0 0-8 0zM10 13c1-1 3-1 4 0",
  people: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c0-4 3-6 6.5-6s6.5 2 6.5 6M16 4.5a3.2 3.2 0 0 1 0 6.3M18 14.3c2 .7 3.5 2.4 3.5 5.2",
  pin: "M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  heart: "M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  refresh: "M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5",
  userPlus: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M19 8v6M16 11h6",
  pencil: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-6 8-6s8 2 8 6",
  car: "M4 16V11l2-5h12l2 5v5M4 16h16M4 16v3h3v-3M17 16v3h3v-3M7 12.5h.01M17 12.5h.01",
  pill: "M8 21a5 5 0 0 1-3.5-8.5l8-8a5 5 0 0 1 7 7l-8 8A5 5 0 0 1 8 21zM9 8l7 7",
  money: "M3 6h18v12H3zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 3 6a2 2 0 0 1 2-2z",
  home: "M4 11l8-7 8 7v9H4zM10 20v-6h4v6",
  health: "M12 20s-8-4.8-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 15.2 12 20 12 20zM12 10v5M9.5 12.5h5",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  chevronLeft: "M15 6l-6 6 6 6",
  close: "M6 6l12 12M18 6L6 18",
  sparkle: "M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3",
  note: "M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`pb-icon ${className}`}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The icon of a task kind (`CardIcon` from the event card). */
export const KIND_ICON = {
  clinic: "clinic",
  medicine: "pill",
  car: "car",
  card: "card",
  money: "money",
  phone: "phone",
  home: "glasses",
  health: "health",
} as const satisfies Record<string, IconName>;

/**
 * A round photo of a member. The portrait exists only for the seeded fictional demo family;
 * every other member shows their first letter. The name is always written next to it, so the
 * picture itself is decoration.
 */
export function Avatar({
  name,
  householdId,
  memberId,
  size = 44,
  ring = false,
  className = "",
  src: srcOverride = null,
}: {
  src?: string | null;
  name: string | null;
  householdId?: string | null;
  memberId?: string | null;
  size?: number;
  ring?: boolean;
  className?: string;
}) {
  const src = srcOverride ?? portraitFor(householdId, memberId);
  return (
    <span
      aria-hidden="true"
      className={`pb-avatar ${ring ? "pb-avatar--ring" : ""} ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.44) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- small static portraits from /public
        <img src={src} alt="" width={size} height={size} draggable={false} />
      ) : (
        initialOf(name)
      )}
    </span>
  );
}

/** A clean ink stamp. The text is real, so the meaning never depends on the colour. */
export function Stamp({ children, tone = "green", className = "" }: { children: ReactNode; tone?: "green" | "orange"; className?: string }) {
  return (
    <span className={`pb-stamp pb-stamp--${tone} ${className}`} data-stamp>
      <Icon name="check" size={18} />
      <span>{children}</span>
    </span>
  );
}

export function Chip({ children, tone = "lavender" }: { children: ReactNode; tone?: "lavender" | "grey" | "mint" | "butter" }) {
  return <span className={`pb-chip pb-chip--${tone}`}>{children}</span>;
}

/** A piece of washi tape. Decoration only, always outside the content it holds. */
export function Tape({ tone = "apricot", className = "" }: { tone?: "apricot" | "mint" | "butter" | "check"; className?: string }) {
  return <span aria-hidden="true" className={`pb-tape pb-tape--${tone} ${className}`} />;
}

/** Segmented progress with a text label. One segment per counted task, so any number works. */
export function ProgressBar({ done, total, label, aria }: { done: number; total: number; label: string; aria: string }) {
  return (
    <div className="pb-progress">
      <p className="pb-progress__text">{label}</p>
      <div role="img" aria-label={aria} className="pb-progress__bar" data-complete={total > 0 && done >= total ? "" : undefined}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} data-on={i < done ? "" : undefined} />
        ))}
      </div>
    </div>
  );
}
