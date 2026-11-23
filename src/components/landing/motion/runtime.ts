import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { DISTANCE, DURATION, EASE_GSAP } from "./tokens";

type Cleanup = () => void;

const QUERIES = {
  motion: "(prefers-reduced-motion: no-preference)",
  finePointer: "(hover: hover) and (pointer: fine)",
};

/**
 * Starts every page-wide behavior: the navigation capsule, magnetic buttons,
 * and the cursor follower. Each one is set up only where it helps (fine
 * pointer, motion allowed) and torn down when that changes.
 *
 * Scrolling is left entirely to the browser: nothing here pins a section,
 * smooths or redirects the wheel, or listens to scroll except passively.
 */
export function startMotion(root: HTMLElement): Cleanup {
  gsap.registerPlugin(ScrollTrigger);
  const mm = gsap.matchMedia();
  const stopNav = navigation(root);

  mm.add(QUERIES, (context) => {
    const { motion, finePointer } = context.conditions ?? {};
    const cleanups: Cleanup[] = [];
    if (motion && finePointer) {
      cleanups.push(magneticButtons(root));
      cleanups.push(cursorFollower(root));
    }
    ScrollTrigger.refresh();
    return () => {
      for (const fn of cleanups.reverse()) fn();
    };
  });

  return () => {
    stopNav();
    mm.revert();
  };
}

/* ------------------------------------------------------------------------ */
/* Navigation: full-width bar at the top, a floating capsule once scrolled.  */
/* ------------------------------------------------------------------------ */
function navigation(root: HTMLElement): Cleanup {
  const header = root.querySelector<HTMLElement>("[data-site-header]");
  if (!header) return () => {};
  const COMPACT_AT = 80;
  const TUCK_AFTER = 480;
  const trigger = ScrollTrigger.create({
    start: 0,
    end: "max",
    onUpdate: (self) => {
      const y = self.scroll();
      header.classList.toggle("is-compact", y > COMPACT_AT);
      header.classList.toggle("is-top", y <= COMPACT_AT);
      header.classList.toggle("is-tucked", y > TUCK_AFTER && self.direction === 1);
    },
  });
  header.classList.toggle("is-compact", window.scrollY > COMPACT_AT);
  header.classList.toggle("is-top", window.scrollY <= COMPACT_AT);
  // Keyboard users always get the full capsule back.
  const onFocus = () => header.classList.remove("is-tucked");
  header.addEventListener("focusin", onFocus);
  return () => {
    trigger.kill();
    header.removeEventListener("focusin", onFocus);
    header.classList.remove("is-compact", "is-tucked", "is-top");
  };
}

/* ------------------------------------------------------------------------ */
/* Buttons lean toward a nearby pointer, a few pixels at most.               */
/* ------------------------------------------------------------------------ */
function magneticButtons(root: HTMLElement): Cleanup {
  const buttons = [...root.querySelectorAll<HTMLElement>("[data-magnetic]")].map((el) => ({
    el,
    // Custom properties, not x/y: GSAP would otherwise pin `scale: none` inline
    // and cancel the CSS press effect.
    x: gsap.quickTo(el, "--mx", { duration: DURATION.base, ease: EASE_GSAP }),
    y: gsap.quickTo(el, "--my", { duration: DURATION.base, ease: EASE_GSAP }),
    ox: 0,
    oy: 0,
  }));
  if (!buttons.length) return () => {};
  let frame = 0;
  let px = -1e4;
  let py = -1e4;
  const update = () => {
    frame = 0;
    // Read every rect first, then write, so the browser lays out once.
    const rects = buttons.map((b) => b.el.getBoundingClientRect());
    buttons.forEach((b, i) => {
      const r = rects[i];
      const cx = r.left + r.width / 2 - b.ox;
      const cy = r.top + r.height / 2 - b.oy;
      const dx = px - cx;
      const dy = py - cy;
      const reachX = r.width / 2 + DISTANCE.magnetReach;
      const reachY = r.height / 2 + DISTANCE.magnetReach;
      const near = Math.abs(dx) < reachX && Math.abs(dy) < reachY;
      b.ox = near ? (dx / reachX) * DISTANCE.magnet : 0;
      b.oy = near ? (dy / reachY) * DISTANCE.magnet : 0;
      b.x(b.ox);
      b.y(b.oy);
    });
  };
  const onMove = (event: PointerEvent) => {
    px = event.clientX;
    py = event.clientY;
    if (!frame) frame = requestAnimationFrame(update);
  };
  const onLeave = () => {
    px = py = -1e4;
    if (!frame) frame = requestAnimationFrame(update);
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  return () => {
    cancelAnimationFrame(frame);
    window.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    for (const b of buttons) {
      b.el.style.removeProperty("--mx");
      b.el.style.removeProperty("--my");
    }
  };
}

/* ------------------------------------------------------------------------ */
/* A soft dot that trails the system cursor and grows over controls.        */
/* The system cursor always stays visible.                                   */
/* ------------------------------------------------------------------------ */
function cursorFollower(root: HTMLElement): Cleanup {
  const dot = document.createElement("span");
  dot.className = "cursor-dot";
  dot.setAttribute("aria-hidden", "true");
  root.append(dot);
  const x = gsap.quickTo(dot, "--cx", { duration: 0.35, ease: "power3" });
  const y = gsap.quickTo(dot, "--cy", { duration: 0.35, ease: "power3" });
  const INTERACTIVE = "a, button, summary, [role='button'], input, select, textarea, label";
  const onMove = (event: PointerEvent) => {
    x(event.clientX);
    y(event.clientY);
    dot.classList.add("is-visible");
    const target = event.target instanceof Element ? event.target : null;
    dot.classList.toggle("is-over-control", Boolean(target?.closest(INTERACTIVE)));
  };
  const onLeave = () => dot.classList.remove("is-visible");
  const onDown = () => dot.classList.add("is-pressed");
  const onUp = () => dot.classList.remove("is-pressed");
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("pointerdown", onDown, { passive: true });
  window.addEventListener("pointerup", onUp, { passive: true });
  document.documentElement.addEventListener("pointerleave", onLeave);
  return () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerdown", onDown);
    window.removeEventListener("pointerup", onUp);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    dot.remove();
  };
}
