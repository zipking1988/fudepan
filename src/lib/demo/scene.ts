/**
 * Timeline and geometry for the "note to task" scene on the landing and example pages.
 * `p` is progress from 0 to 1. On the landing page native scrolling drives it; on the example page
 * a slider does. Pure functions only, so the motion can be unit-tested.
 *
 *   0.00–0.20  aim     the note, lying on a table, is lifted flat and framed like a photo
 *   0.20–0.26  flash   the photo is taken
 *   0.24–0.42  scan    Fudepan reads the note line by line
 *   0.44–0.56  split   the note moves aside and the draft task appears
 *   0.56–0.84  fly     each phrase travels into the field it became
 *   0.86–1.00  review  the draft shows what still needs a person
 */

export const PHASE = {
  aimEnd: 0.2,
  flash: [0.2, 0.26],
  scan: [0.24, 0.42],
  split: [0.44, 0.56],
  fly: [0.56, 0.84],
  review: 0.86,
} as const;

export type SceneStep = 0 | 1 | 2 | 3 | 4;

/** Progress at which each step is fully shown (used by the step buttons). */
export const STEP_AT: Record<Exclude<SceneStep, 0>, number> = { 1: 0.23, 2: 0.43, 3: 0.85, 4: 1 };

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
/** Progress of `p` between `a` and `b`, clamped to 0–1. */
export const segment = (p: number, a: number, b: number) => clamp((p - a) / (b - a), 0, 1);
const safe = (p: number) => clamp(Number.isFinite(p) ? p : 0, 0, 1);

export function sceneStep(raw: number): SceneStep {
  const p = safe(raw);
  if (p < 0.06) return 0;
  if (p < 0.26) return 1;
  if (p < 0.44) return 2;
  if (p < PHASE.review) return 3;
  return 4;
}

/** Where the reading line is on the note, 0 (top) to 1 (bottom). */
export function scanY(p: number): number {
  return segment(safe(p), PHASE.scan[0], PHASE.scan[1]);
}

/** How many phrases have been read, given each phrase's vertical centre (0–1) on the note. */
export function readCount(p: number, ys: readonly number[]): number {
  if (safe(p) >= PHASE.scan[1]) return ys.length;
  const y = scanY(p);
  if (y <= 0) return 0;
  return ys.filter((v) => v <= y + 0.02).length;
}

const FLY_EACH = 0.12;

/** The flight window of phrase `i` of `n`; windows overlap so the phrases move as a wave. */
export function chipWindow(i: number, n: number): [number, number] {
  const [a, b] = PHASE.fly;
  const gap = n > 1 ? (b - a - FLY_EACH) / (n - 1) : 0;
  const start = a + gap * i;
  return [start, start + FLY_EACH];
}

export function chipT(p: number, i: number, n: number): number {
  const [a, b] = chipWindow(i, n);
  return segment(safe(p), a, b);
}

/** Fields whose phrase has landed. */
export function filledCount(p: number, n: number): number {
  let count = 0;
  for (let i = 0; i < n; i++) if (chipT(p, i, n) >= 0.92) count++;
  return count;
}

export interface Stop<T> {
  p: number;
  v: T;
}

/** Eased piecewise interpolation of numeric records between stops (sorted by `p`). */
export function interpolate<T extends Record<string, number>>(
  stops: readonly Stop<T>[],
  raw: number,
): T {
  const first = stops[0];
  if (!first) throw new Error("No stops");
  const p = safe(raw);
  if (p <= first.p) return first.v;
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (p <= b.p) {
      const k = b.p === a.p ? 1 : ease((p - a.p) / (b.p - a.p));
      const out: Record<string, number> = {};
      for (const key of Object.keys(a.v)) out[key] = a.v[key]! + (b.v[key]! - a.v[key]!) * k;
      return out as T;
    }
  }
  return stops[stops.length - 1]!.v;
}

export interface Size {
  w: number;
  h: number;
}

/** Note pose: centre (x, y) in the stage, scale, and tilt (rx: lying back, rz: turned). */
export interface NotePose extends Record<string, number> {
  x: number;
  y: number;
  s: number;
  rx: number;
  rz: number;
}

/** Card pose: centre, scale, opacity, and slide-in offset (1 = fully off, 0 = in place). */
export interface CardPose extends Record<string, number> {
  x: number;
  y: number;
  s: number;
  o: number;
  d: number;
}

export type Variant = "hero" | "box";

export const isWide = (W: number, H: number) => W >= 900 && H >= 540;

export interface SceneKeys {
  wide: boolean;
  note: Stop<NotePose>[];
  card: Stop<CardPose>[];
}

export interface SceneSpace {
  /** Bottom edge of content above the scene in the first frame (the hero copy), in stage px. */
  copyBottom?: number;
}

/** Room kept clear for the step controls: below the scene on wide screens, above it on narrow. */
export function sceneInsets(
  W: number,
  H: number,
  variant: Variant,
): { top: number; bottom: number } {
  const wide = isWide(W, H);
  if (variant === "box") return wide ? { top: 16, bottom: 16 } : { top: 12, bottom: 12 };
  return wide ? { top: 28, bottom: 150 } : { top: 96, bottom: 12 };
}

/**
 * Key poses for a stage of size W×H. `hero` starts with the note lying on a table below the
 * headline; `box` is the self-contained scene on the example page.
 */
export function sceneKeys(
  W: number,
  H: number,
  note: Size,
  card: Size,
  variant: Variant,
  space: SceneSpace = {},
): SceneKeys {
  const wide = isWide(W, H);
  const tilt = { rx: 34, rz: -5 };
  const flat = { rx: 0, rz: 0 };
  const { top, bottom } = sceneInsets(W, H, variant);
  const availH = H - top - bottom;
  const midY = top + availH / 2;
  /** Half of the visible height of the note while it lies tilted back. */
  const lyingHalf = (s: number) => note.h * s * Math.cos((tilt.rx * Math.PI) / 180) * 0.5;

  let start: NotePose;
  let framed: NotePose;
  let besideNote: NotePose;
  let cardAt: { x: number; y: number; s: number };

  if (wide) {
    if (variant === "hero") {
      const s0 = Math.min(0.84, (0.56 * H) / note.h, (0.5 * W) / note.w);
      const minY = (space.copyBottom ?? H * 0.5) + lyingHalf(s0) + 28;
      start = { x: W / 2, y: clamp(Math.max(H * 0.74, minY), H * 0.5, H * 0.92), s: s0, ...tilt };
    } else {
      start = { x: W / 2, y: H / 2, s: Math.min(0.8, (0.7 * H) / note.h), ...tilt };
    }
    const s1 = Math.min(1.22, (0.94 * availH) / note.h, (0.62 * W) / note.w);
    framed = { x: W / 2, y: midY, s: s1, ...flat };

    const gap = Math.max(40, W * 0.045);
    const cs = Math.min(1, availH / card.h, (0.6 * W) / card.w);
    const ns = Math.max(
      0.45,
      Math.min(0.98, (0.94 * availH) / note.h, (0.92 * W - gap - card.w * cs) / note.w),
    );
    const total = note.w * ns + gap + card.w * cs;
    const left = (W - total) / 2;
    besideNote = { x: left + (note.w * ns) / 2, y: midY, s: ns, ...flat };
    cardAt = { x: left + note.w * ns + gap + (card.w * cs) / 2, y: midY, s: cs };
  } else {
    if (variant === "hero") {
      const s0 = Math.min(0.72, (0.86 * W) / note.w);
      const minY = (space.copyBottom ?? H * 0.6) + lyingHalf(s0) + 20;
      start = { x: W / 2, y: clamp(Math.max(H * 0.78, minY), H * 0.5, H * 0.94), s: s0, ...tilt };
    } else {
      start = { x: W / 2, y: H * 0.42, s: Math.min(0.7, (0.86 * W) / note.w), ...tilt };
    }
    const s1 = Math.min((0.9 * W) / note.w, (0.62 * availH) / note.h);
    framed = { x: W / 2, y: top + availH * 0.46, s: s1, ...flat };

    const ns = Math.min((0.44 * W) / note.w, (0.18 * availH) / note.h);
    besideNote = { x: W / 2, y: top + (note.h * ns) / 2, s: ns, ...flat };
    const cardTop = top + note.h * ns + 14;
    const cs = Math.min(1, (0.96 * W) / card.w, (H - bottom - cardTop) / card.h);
    cardAt = { x: W / 2, y: cardTop + (card.h * cs) / 2, s: cs };
  }

  const hidden: CardPose = { ...cardAt, o: 0, d: 1 };
  const shown: CardPose = { ...cardAt, o: 1, d: 0 };

  return {
    wide,
    note: [
      { p: 0, v: start },
      { p: PHASE.aimEnd, v: framed },
      { p: PHASE.split[0], v: framed },
      { p: PHASE.split[1], v: besideNote },
      { p: 1, v: besideNote },
    ],
    card: [
      { p: 0, v: hidden },
      { p: PHASE.split[0], v: hidden },
      { p: PHASE.split[1], v: shown },
      { p: 1, v: shown },
    ],
  };
}

/** Maps a point inside an element (unscaled local px) to stage px, for a flat pose. */
export function toStage(
  pose: { x: number; y: number; s: number },
  size: Size,
  local: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: pose.x + (local.x - size.w / 2) * pose.s,
    y: pose.y + (local.y - size.h / 2) * pose.s,
  };
}
