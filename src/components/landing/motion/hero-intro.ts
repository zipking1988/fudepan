import { animate, type AnimationPlaybackControls, type AnimationSequence } from "motion";

import { ANCHOR_EVENT, DURATION, EASE, SPRING, STAGGER } from "./tokens";

type Options = { onLayout: () => void };

const SELECTORS = [
  "[data-intro-scan]",
  "[data-intro-mark]",
  "[data-intro-connector]",
  "[data-intro-connector] path",
  "[data-intro-card]",
  "[data-intro-ask]",
  "[data-intro-foot]",
  "[data-intro-down]",
].join(", ");

/** Time between one note line and the next becoming a task. */
const PER_TASK = 0.18;

/**
 * The hero entrance, played once per page load (and again only on Replay):
 * a scan reads Grandma's note, and each line in turn is marked and becomes
 * its task card, joined to it by a line on wide layouts. About two seconds,
 * so the sample is ready to use almost at once. The note itself is never
 * hidden. Nothing here is tied to scrolling.
 *
 * Hidden start states are set in CSS under `html.intro`, a class added by an
 * inline script, so without JavaScript nothing is ever hidden. If this module
 * never loads, a CSS fallback reveals everything after a few seconds.
 */
export function startIntro(demo: HTMLElement, { onLayout }: Options) {
  const html = document.documentElement;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  let current: AnimationPlaybackControls | null = null;
  let run = 0;

  const all = () => [...demo.querySelectorAll<HTMLElement | SVGElement>(SELECTORS)];
  const clearInline = () => {
    for (const el of all()) {
      el.style.removeProperty("opacity");
      el.style.removeProperty("transform");
      el.style.removeProperty("stroke-dashoffset");
      // On SVG, Motion writes presentation attributes rather than styles.
      if (el instanceof SVGElement) {
        el.removeAttribute("opacity");
        el.removeAttribute("stroke-dashoffset");
      }
    }
  };
  // Stopping a sequence midway can leave delayed native animations holding
  // their first keyframe (opacity 0), or let the JS loop write one more frame
  // after the stop. Cancel what is left and clear again on the next frame.
  const settle = () => {
    for (const el of all()) for (const a of el.getAnimations?.() ?? []) a.cancel();
    clearInline();
  };
  let pending = 0;
  const finish = () => {
    html.classList.add("intro-done");
    settle();
    onLayout();
    requestAnimationFrame(() => {
      if (html.classList.contains("intro-done")) settle();
    });
  };

  const play = () => {
    const id = ++run;
    html.classList.add("intro-live");
    onLayout();
    const sequence = reduce ? reducedSequence(demo) : fullSequence(demo);
    try {
      current = animate(sequence);
      void current.finished.then(() => {
        if (id === run) finish();
      });
    } catch {
      finish();
    }
  };

  const replay = () => {
    run++;
    current?.stop();
    current = null;
    cancelAnimationFrame(pending);
    settle();
    html.classList.remove("intro-done");
    html.classList.add("intro");
    // Let the hidden start state apply before playing again.
    pending = requestAnimationFrame(() => {
      pending = requestAnimationFrame(play);
    });
  };

  // Someone who goes straight to the sample should see it ready to use, not
  // mid-animation: jump to the end of the entrance.
  const skip = () => {
    run++;
    cancelAnimationFrame(pending);
    current?.stop();
    current = null;
    finish();
  };
  const onAnchor = (event: Event) => {
    const id = (event as CustomEvent<{ id?: string }>).detail?.id;
    if (id === "sample-draft") skip();
  };
  window.addEventListener(ANCHOR_EVENT, onAnchor);

  // Only the first visit to the page plays the entrance automatically.
  if (location.hash === "#sample-draft" || html.classList.contains("intro-done")) finish();
  else if (html.classList.contains("intro") && !html.classList.contains("intro-done")) play();
  else finish();

  const stopTilt = finePointer && !reduce ? tilt(demo) : () => {};
  return {
    replay,
    stop: () => {
      run++;
      current?.stop();
      stopTilt();
      window.removeEventListener(ANCHOR_EVENT, onAnchor);
    },
  };
}

function sideBySide(demo: HTMLElement) {
  return getComputedStyle(demo).getPropertyValue("--connectors").trim() === "1";
}

function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

function fullSequence(demo: HTMLElement): AnimationSequence {
  const wide = sideBySide(demo);
  const paper = demo.querySelector<HTMLElement>(".demo-note__paper");
  const scan = demo.querySelector<HTMLElement>("[data-intro-scan]");
  const down = demo.querySelector<HTMLElement>("[data-intro-down]");
  const foot = demo.querySelector<HTMLElement>("[data-intro-foot]");
  const cards = q(demo, "[data-intro-card]");
  const asks = q(demo, "[data-intro-ask]");
  const seq: AnimationSequence = [];
  const ease = [...EASE] as [number, number, number, number];

  // 1. A quick scan reads the note from top to bottom.
  if (scan) {
    seq.push([
      scan,
      {
        opacity: [0, 1, 1, 0],
        transform: ["translateY(-48px)", `translateY(${paper?.offsetHeight ?? 260}px)`],
      },
      { duration: 0.6, ease: "linear", at: 0 },
    ]);
  }
  if (down && !wide) {
    seq.push([down, { opacity: [0, 1], y: [-6, 0] }, { duration: DURATION.small, ease, at: 0.2 }]);
  }

  // 2. Line by line, the words are marked and their task comes out of the note:
  //    to the right beside it, downward below it.
  const tasksAt = 0.2;
  cards.forEach((card, i) => {
    const id = card.dataset.introCard;
    const at = tasksAt + i * PER_TASK;
    const mark = demo.querySelector<HTMLElement>(`[data-line="${id}"] [data-intro-mark]`);
    const group = demo.querySelector<SVGGElement>(`[data-intro-connector="${id}"]`);
    const path = group?.querySelector("path");
    if (mark) {
      seq.push([
        mark,
        { opacity: [0, 1], transform: ["scaleX(0.4)", "scaleX(1)"] },
        { duration: DURATION.small, ease, at },
      ]);
      seq.push([mark, { opacity: [1, 0] }, { duration: DURATION.small, at: at + 0.55 }]);
    }
    if (wide && group && path) {
      seq.push([group, { opacity: [0, 1] }, { duration: 0.12, at: at + 0.05 }]);
      seq.push([path, { strokeDashoffset: [1, 0] }, { duration: 0.4, ease, at: at + 0.05 }]);
      seq.push([group, { opacity: [1, 0.3] }, { duration: DURATION.small, at: at + 0.7 }]);
    }
    seq.push([
      card,
      wide ? { opacity: [0, 1], x: [-20, 0] } : { opacity: [0, 1], y: [-10, 0] },
      { duration: 0.45, ease, at: at + (wide ? 0.2 : 0.08) },
    ]);
  });

  // 3. The footer settles, and what is missing gets one gentle nudge.
  const endAt = tasksAt + Math.max(0, cards.length - 1) * PER_TASK + 0.45;
  if (foot) {
    seq.push([foot, { opacity: [0, 1], y: [6, 0] }, { duration: DURATION.small, ease, at: endAt }]);
  }
  if (asks.length) {
    seq.push([
      asks,
      { scale: [1, 1.04, 1] },
      { duration: DURATION.base, ease: "easeInOut", at: endAt + 0.1 },
    ]);
  }
  return seq;
}

/** Reduced motion: the same order, fades only, and no movement. */
function reducedSequence(demo: HTMLElement): AnimationSequence {
  const seq: AnimationSequence = [];
  const fade = (el: Element | Element[] | null, at: number) => {
    if (el && (!Array.isArray(el) || el.length)) {
      seq.push([el, { opacity: [0, 1] }, { duration: DURATION.small, at }]);
    }
  };
  const groups = q(demo, "[data-intro-connector]");
  if (groups.length && sideBySide(demo)) {
    seq.push([groups, { opacity: [0, 0.3] }, { duration: DURATION.small, at: 0.1 }]);
  }
  q(demo, "[data-intro-card]").forEach((card, i) => fade(card, 0.1 + i * STAGGER));
  fade(demo.querySelector("[data-intro-foot]"), 0.4);
  if (!sideBySide(demo)) fade(demo.querySelector("[data-intro-down]"), 0.1);
  return seq;
}

/** The whole panel leans toward the pointer, four degrees at most. */
function tilt(demo: HTMLElement) {
  const plate = demo.closest<HTMLElement>("[data-demo-tilt]");
  const area = plate?.parentElement;
  if (!plate || !area) return () => {};
  let frame = 0;
  let nx = 0;
  let ny = 0;
  const apply = () => {
    frame = 0;
    if (!sideBySide(demo)) return;
    animate(plate, { rotateX: -ny * 4, rotateY: nx * 4 }, SPRING);
  };
  const onMove = (event: PointerEvent) => {
    const r = area.getBoundingClientRect();
    nx = Math.max(-1, Math.min(1, ((event.clientX - r.left) / r.width - 0.5) * 2));
    ny = Math.max(-1, Math.min(1, ((event.clientY - r.top) / r.height - 0.5) * 2));
    if (!frame) frame = requestAnimationFrame(apply);
  };
  const onLeave = () => {
    nx = 0;
    ny = 0;
    if (!frame) frame = requestAnimationFrame(apply);
  };
  area.addEventListener("pointermove", onMove, { passive: true });
  area.addEventListener("pointerleave", onLeave);
  return () => {
    cancelAnimationFrame(frame);
    area.removeEventListener("pointermove", onMove);
    area.removeEventListener("pointerleave", onLeave);
    plate.style.removeProperty("transform");
  };
}
