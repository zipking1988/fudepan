"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type Ref,
} from "react";
import { HandChars } from "@/components/landing/Hand";
import { IconAlert, IconLock, IconQuestion } from "@/components/landing/Icons";
import { LIVING_FIELDS, LIVING_NOTE, type LivingFieldId } from "@/lib/demo/fixtures";
import { MEDICINE_TEXT, assess } from "@/lib/demo/landing";
import {
  PHASE,
  chipT,
  clamp,
  ease,
  interpolate,
  readCount,
  scanY,
  sceneKeys,
  sceneStep,
  segment,
  toStage,
  type SceneKeys,
  type SceneStep,
  type Size,
  type Variant,
} from "@/lib/demo/scene";
import { t } from "@/lib/i18n/messages";

/**
 * Grandma's note and the draft task Fudepan makes from it. Fictional example data only.
 *
 * - "static" mode (reduced motion, no JavaScript): note and finished draft side by side.
 * - "motion" mode: the parent calls `apply(p)` with progress 0–1 and this component poses the
 *   note, the draft card and the phrases flying between them. Nothing here starts on its own.
 */

export interface SceneApi {
  apply: (p: number) => void;
  measure: () => void;
}
export type SceneMode = "auto" | "motion" | "static";

const FIELD_IDS = LIVING_FIELDS.map((f) => f.id);
const N = FIELD_IDS.length;

interface Geometry {
  W: number;
  H: number;
  note: Size;
  card: Size;
  keys: SceneKeys;
  phrase: Record<LivingFieldId, { x: number; y: number }>;
  slot: Record<LivingFieldId, { x: number; y: number }>;
  chip: Record<LivingFieldId, Size>;
  ys: number[];
  /** Slot text size divided by note text size. */
  ratio: number;
}

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

const center = (r: DOMRect, base: DOMRect) => ({
  x: r.left - base.left + r.width / 2,
  y: r.top - base.top + r.height / 2,
});

export function NoteScene({
  variant,
  mode,
  apiRef,
  thursdayLabel,
  referenceLabel,
  onStep,
}: {
  variant: Variant;
  mode: SceneMode;
  apiRef?: Ref<SceneApi>;
  thursdayLabel: string;
  referenceLabel: string;
  onStep?: (step: SceneStep) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const finderRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  const calloutsRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<LivingFieldId, HTMLElement>());
  const geo = useRef<Geometry | null>(null);
  const last = useRef(0);
  const lastStep = useRef<SceneStep | null>(null);
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  }, [onStep]);

  const assessment = assess(MEDICINE_TEXT);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const note = noteRef.current;
    const card = cardRef.current;
    if (!stage || !note || !card || stage.dataset.mode !== "motion") return;
    const keepNote = note.style.transform;
    const keepCard = card.style.transform;
    note.style.transform = "none";
    card.style.transform = "none";

    const nb = note.getBoundingClientRect();
    const cb = card.getBoundingClientRect();
    const phrase = {} as Geometry["phrase"];
    const slot = {} as Geometry["slot"];
    const chip = {} as Geometry["chip"];
    for (const id of FIELD_IDS) {
      const ph = note.querySelector<HTMLElement>(`[data-phrase="${id}"]`);
      const sl = card.querySelector<HTMLElement>(`[data-slot="${id}"]`);
      const ch = chipRefs.current.get(id);
      phrase[id] = ph
        ? center(ph.getBoundingClientRect(), nb)
        : { x: nb.width / 2, y: nb.height / 2 };
      slot[id] = sl
        ? center(sl.getBoundingClientRect(), cb)
        : { x: cb.width / 2, y: cb.height / 2 };
      chip[id] = ch ? { w: ch.offsetWidth, h: ch.offsetHeight } : { w: 100, h: 40 };
    }
    const ys = Array.from(note.querySelectorAll<HTMLElement>("[data-phrase]")).map(
      (el) => (el.getBoundingClientRect().top - nb.top + el.offsetHeight / 2) / nb.height,
    );
    const noteSize =
      parseFloat(getComputedStyle(note.querySelector(".scene-hand")!).fontSize) || 30;
    const slotEl = card.querySelector<HTMLElement>("[data-slot] q");
    const slotSize = slotEl ? parseFloat(getComputedStyle(slotEl).fontSize) : 20;

    note.style.transform = keepNote;
    card.style.transform = keepCard;

    const W = stage.clientWidth;
    const H = stage.clientHeight;
    const noteBox = { w: note.offsetWidth, h: note.offsetHeight };
    const cardBox = { w: card.offsetWidth, h: card.offsetHeight };
    // In the hero, keep the lying note clear of the headline above it.
    const copy = stage.parentElement?.querySelector<HTMLElement>("[data-scene-above]");
    const copyBottom = copy ? copy.offsetTop + copy.offsetHeight : undefined;
    const keys = sceneKeys(W, H, noteBox, cardBox, variant, { copyBottom });
    const callouts = calloutsRef.current;
    if (callouts) {
      const n0 = keys.note[0]!.v;
      callouts.style.transform = `translate3d(${n0.x.toFixed(1)}px, ${n0.y.toFixed(1)}px, 0)`;
      callouts.style.setProperty("--nw", `${((noteBox.w * n0.s) / 2).toFixed(1)}px`);
      callouts.style.setProperty(
        "--nh",
        `${(noteBox.h * n0.s * Math.cos((n0.rx * Math.PI) / 180) * 0.5).toFixed(1)}px`,
      );
    }
    geo.current = {
      W,
      H,
      note: noteBox,
      card: cardBox,
      keys,
      phrase,
      slot,
      chip,
      ys,
      ratio: slotSize / noteSize,
    };
  }, [variant]);

  const apply = useCallback((raw: number) => {
    const stage = stageRef.current;
    const note = noteRef.current;
    const card = cardRef.current;
    const g = geo.current;
    const p = clamp(raw, 0, 1);
    last.current = p;
    if (!stage || !note || !card || !g || stage.dataset.mode !== "motion") return;

    // Note and card.
    const n = interpolate(g.keys.note, p);
    note.style.transform = `translate3d(${(n.x - g.note.w / 2).toFixed(2)}px, ${(n.y - g.note.h / 2).toFixed(2)}px, 0) perspective(1600px) rotateX(${n.rx.toFixed(2)}deg) rotateZ(${n.rz.toFixed(2)}deg) scale(${n.s.toFixed(4)})`;
    note.style.setProperty("--lift", String(clamp(n.rx / 34, 0, 1).toFixed(3)));
    const c = interpolate(g.keys.card, p);
    const slide = g.keys.wide ? { x: c.d * 90, y: 0 } : { x: 0, y: c.d * 70 };
    card.style.transform = `translate3d(${(c.x - g.card.w / 2 + slide.x).toFixed(2)}px, ${(c.y - g.card.h / 2 + slide.y).toFixed(2)}px, 0) scale(${c.s.toFixed(4)})`;
    card.style.opacity = c.o.toFixed(3);
    card.style.visibility = c.o < 0.01 ? "hidden" : "visible";

    // Reading line.
    const sy = scanY(p);
    const scanning = p > PHASE.scan[0] && p < PHASE.scan[1] + 0.01;
    note.style.setProperty("--scan", sy.toFixed(4));
    note.style.setProperty("--scan-o", scanning ? "1" : "0");
    const read = readCount(p, g.ys);
    note.querySelectorAll<HTMLElement>("[data-phrase]").forEach((el, i) => {
      el.dataset.on = String(i < read);
    });

    // Phrases flying into their fields.
    let filled = 0;
    FIELD_IDS.forEach((id, i) => {
      const chip = chipRefs.current.get(id);
      const k = chipT(p, i, N);
      const done = k >= 0.92;
      if (done) filled++;
      card
        .querySelector<HTMLElement>(`[data-row="${id}"]`)
        ?.setAttribute("data-filled", String(done));
      if (!chip) return;
      if (k <= 0 || k >= 1) {
        chip.style.opacity = "0";
        return;
      }
      const e = ease(k);
      const from = toStage(n, g.note, g.phrase[id]);
      const to = toStage(c, g.card, g.slot[id]);
      const arc = Math.sin(Math.PI * e) * (g.keys.wide ? 46 : 28);
      const x = from.x + (to.x - from.x) * e;
      const y = from.y + (to.y - from.y) * e - arc;
      const s = n.s + (c.s * g.ratio - n.s) * e;
      const size = g.chip[id];
      chip.style.transform = `translate3d(${(x - size.w / 2).toFixed(2)}px, ${(y - size.h / 2).toFixed(2)}px, 0) rotate(${(-Math.sin(Math.PI * e) * 5).toFixed(2)}deg) scale(${s.toFixed(4)})`;
      chip.style.opacity = (k < 0.06 ? k / 0.06 : k > 0.86 ? (1 - k) / 0.14 : 1).toFixed(3);
    });
    card.dataset.risk = String(filled > 0);
    card.dataset.review = String(p >= PHASE.review);

    // Camera finder: from the edges of the stage onto the note, then gone after the photo.
    const finder = finderRef.current;
    if (finder) {
      const f = interpolate(g.keys.note, PHASE.aimEnd);
      const pad = 18;
      const end = {
        l: f.x - (g.note.w * f.s) / 2 - pad,
        t: f.y - (g.note.h * f.s) / 2 - pad,
        r: f.x + (g.note.w * f.s) / 2 + pad,
        b: f.y + (g.note.h * f.s) / 2 + pad,
      };
      const inset = Math.min(g.W, g.H) * 0.06;
      const start = { l: inset, t: inset, r: g.W - inset, b: g.H - inset };
      const k = ease(segment(p, 0.04, PHASE.aimEnd));
      const lerp = (a: number, b: number) => a + (b - a) * k;
      const l = lerp(start.l, end.l);
      const tt = lerp(start.t, end.t);
      Object.assign(finder.style, {
        transform: `translate3d(${l.toFixed(1)}px, ${tt.toFixed(1)}px, 0)`,
        width: `${(lerp(start.r, end.r) - l).toFixed(1)}px`,
        height: `${(lerp(start.b, end.b) - tt).toFixed(1)}px`,
        opacity: (segment(p, 0.03, 0.09) * (1 - segment(p, 0.24, 0.32))).toFixed(3),
      });
      finder.dataset.locked = String(p >= PHASE.aimEnd - 0.005);
    }
    const flash = flashRef.current;
    if (flash) {
      flash.style.opacity = (
        segment(p, 0.196, 0.204) *
        (1 - segment(p, 0.204, 0.26)) *
        0.7
      ).toFixed(3);
    }
    const callouts = calloutsRef.current;
    if (callouts) {
      const o = 1 - segment(p, 0.012, 0.07);
      callouts.style.opacity = o.toFixed(3);
      callouts.style.visibility = o < 0.01 ? "hidden" : "visible";
    }

    const step = sceneStep(p);
    stage.dataset.step = String(step);
    stage.dataset.read = String(read);
    stage.dataset.filled = String(filled);
    if (step !== lastStep.current) {
      lastStep.current = step;
      onStepRef.current?.(step);
    }
  }, []);

  useImperativeHandle(apiRef, () => ({ apply, measure }), [apply, measure]);

  useIso(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (mode !== "motion") {
      Object.assign(stage.dataset, { step: "4", read: String(N), filled: String(N) });
      for (const el of [
        noteRef.current,
        cardRef.current,
        finderRef.current,
        flashRef.current,
        calloutsRef.current,
      ]) {
        el?.removeAttribute("style");
      }
      chipRefs.current.forEach((el) => el.removeAttribute("style"));
      noteRef.current
        ?.querySelectorAll<HTMLElement>("[data-phrase]")
        .forEach((el) => (el.dataset.on = "true"));
      cardRef.current
        ?.querySelectorAll<HTMLElement>("[data-row]")
        .forEach((el) => (el.dataset.filled = "true"));
      if (cardRef.current) {
        cardRef.current.dataset.risk = "true";
        cardRef.current.dataset.review = "true";
      }
      return;
    }
    const remeasure = () => {
      measure();
      apply(last.current);
    };
    remeasure();
    const ro = new ResizeObserver(remeasure);
    ro.observe(stage);
    void document.fonts?.ready.then(remeasure);
    return () => ro.disconnect();
  }, [mode, measure, apply]);

  const meaning = (id: LivingFieldId, fallback: string) =>
    id === "when" ? thursdayLabel : id === "who" ? "Aki" : fallback;

  let phraseSeed = 0;

  return (
    <div
      ref={stageRef}
      className="scene"
      data-scene
      data-variant={variant}
      data-mode={mode}
      data-step="4"
      data-read={N}
      data-filled={N}
    >
      <div ref={flashRef} className="scene-flash" aria-hidden="true" />
      <div ref={finderRef} className="scene-finder" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      {variant === "hero" ? (
        <div ref={calloutsRef} className="scene-callouts" aria-hidden="true">
          <span className="callout callout--a">
            <q lang="ja" className="hand-ja">
              血圧の薬
            </q>
            <span className="callout-arrow">→</span>
            <span>{t.landing.calloutMedicine}</span>
          </span>
          <span className="callout callout--b">
            <q lang="ja" className="hand-ja">
              5時までに
            </q>
            <span className="callout-arrow">→</span>
            <span>{t.landing.calloutDeadline}</span>
          </span>
          <span className="callout callout--c">
            <q lang="ja" className="hand-ja">
              アキにたのむ?
            </q>
            <span className="callout-arrow">→</span>
            <span>{t.landing.calloutHelper}</span>
          </span>
        </div>
      ) : null}

      {/* The note */}
      <figure ref={noteRef} className="scene-note" aria-label={t.landing.noteLabel} data-scene-note>
        <figcaption className="scene-note-tag">
          {t.landing.noteTag} {referenceLabel}
        </figcaption>
        <p className="sr-only" lang="ja">
          {LIVING_NOTE.map((line) => line.map((s) => s.text).join("")).join(" ")}
        </p>
        <div className="scene-hand hand-ja" lang="ja" aria-hidden="true">
          {LIVING_NOTE.map((line, li) => (
            <span key={li} className="scene-line">
              {line.map((seg, si) =>
                seg.field ? (
                  <span key={si} className="scene-phrase" data-phrase={seg.field} data-on="true">
                    <HandChars text={seg.text} seed={++phraseSeed * 11 + li} />
                  </span>
                ) : (
                  <HandChars key={si} text={seg.text} seed={li * 5 + si} />
                ),
              )}
            </span>
          ))}
        </div>
        <span className="scene-scan" aria-hidden="true" />
      </figure>

      {/* The draft task */}
      <section
        ref={cardRef}
        className="scene-card"
        aria-label={t.landing.cardLabel}
        data-scene-card
        data-risk="true"
        data-review="true"
      >
        <div className="scene-card-head">
          <p className="flex items-center gap-2 text-lg font-semibold text-sumi">
            <span className="scene-dot" aria-hidden="true" />
            {t.landing.cardTitle}
            <span className="lp-tag">{t.landing.exampleTag}</span>
          </p>
          <p className="scene-risk lp-risk" data-level={assessment.risk}>
            <IconAlert />
            {t.risk[assessment.risk]} · {t.review.categories[assessment.category]}
          </p>
        </div>
        <ol className="scene-rows">
          {LIVING_FIELDS.map((f) => {
            const check =
              f.id in t.landing.checks
                ? t.landing.checks[f.id as keyof typeof t.landing.checks]
                : null;
            return (
              <li key={f.id} className="scene-row" data-row={f.id} data-filled="true">
                <span className="scene-label">{f.label}</span>
                <div className="scene-value">
                  <span className="scene-main">
                    {meaning(f.id, f.meaning)}
                    {f.id === "who" ? (
                      <span className="scene-soft"> ({t.landing.suggested})</span>
                    ) : null}
                  </span>
                  {check ? (
                    <span className="scene-check">
                      <IconQuestion />
                      <span>{check}</span>
                    </span>
                  ) : null}
                </div>
                <span className="scene-slot" data-slot={f.id}>
                  <span className="sr-only">{t.landing.fromNote} </span>
                  <q lang="ja" className="hand-ja">
                    {f.source}
                  </q>
                </span>
              </li>
            );
          })}
        </ol>
        <p className="scene-foot">
          <IconLock />
          <span>{t.landing.cardFoot}</span>
        </p>
      </section>

      {/* Phrases in flight */}
      <div className="scene-chips" aria-hidden="true">
        {LIVING_FIELDS.map((f) => (
          <span
            key={f.id}
            className="scene-chip hand-ja"
            lang="ja"
            ref={(el) => {
              if (el) chipRefs.current.set(f.id, el);
              else chipRefs.current.delete(f.id);
            }}
          >
            {f.source}
          </span>
        ))}
      </div>
    </div>
  );
}
