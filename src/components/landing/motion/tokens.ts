/**
 * One motion vocabulary for the whole landing page. CSS mirrors these values
 * as custom properties in landing.css (--dur-*, --ease, --stagger).
 */
export const EASE = [0.22, 1, 0.36, 1] as const;
export const EASE_CSS = "cubic-bezier(0.22, 1, 0.36, 1)";
/** GSAP has no cubic-bezier string parser in core; this curve is close to EASE. */
export const EASE_GSAP = "expo.out";

export const SPRING = { type: "spring", stiffness: 120, damping: 18 } as const;

export const DURATION = {
  small: 0.3,
  base: 0.5,
  large: 0.7,
  title: 0.9,
} as const;

export const STAGGER = 0.07;

/** Distances, in pixels. */
export const DISTANCE = {
  reveal: 24,
  lift: 4,
  magnet: 6,
  magnetReach: 40,
} as const;

/** Fired after an in-page link is followed (in-page-links.tsx). */
export const ANCHOR_EVENT = "landing:anchor";
