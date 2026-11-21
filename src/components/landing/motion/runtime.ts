import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

import { DISTANCE, DURATION, EASE_GSAP } from "./tokens";

type Cleanup = () => void;

const QUERIES = {
  motion: "(prefers-reduced-motion: no-preference)",
  finePointer: "(hover: hover) and (pointer: fine)",
  desktop: "(min-width: 1024px)",
};

/**
 * Starts every page-wide behavior: the navigation capsule, smooth scrolling,
 * magnetic buttons, and the cursor follower. Each one is set up only where it
 * helps (fine pointer, motion allowed) and torn down when that changes.
 */
export function startMotion(root: HTMLElement): Cleanup {
  gsap.registerPlugin(ScrollTrigger);
  const mm = gsap.matchMedia();
  const stopNav = navigation(root);

  mm.add(QUERIES, (context) => {
    const { motion, finePointer, desktop } = context.conditions ?? {};
    const cleanups: Cleanup[] = [];
    if (motion && desktop) cleanups.push(howItWorks(root));
    if (motion && finePointer) {
      cleanups.push(smoothScroll());
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
/* How it works: pinned, one picture through three steps, tied to scroll.    */
/* ------------------------------------------------------------------------ */
function howItWorks(root: HTMLElement): Cleanup {
  const section = root.querySelector<HTMLElement>("[data-how]");
  const pin = section?.querySelector<HTMLElement>("[data-how-pin]");
  const scene = section?.querySelector<HTMLElement>(".how__stage [data-scene]");
  if (!section || !pin || !scene) return () => {};
  const q = <T extends Element = HTMLElement>(sel: string) => [...scene.querySelectorAll<T>(sel)];
  const one = (sel: string) => scene.querySelector<HTMLElement>(sel);
  const steps = [...section.querySelectorAll<HTMLElement>("[data-how-step]")];
  const fill = section.querySelector<HTMLElement>("[data-how-fill]");

  section.classList.add("how--pinned");
  const phone = one("[data-scene-phone]");
  const screens = [1, 2, 3].map((n) => one(`[data-screen="${n}"]`));
  const flash = one("[data-scene-flash]");
  const scan = one("[data-scene-scan]");
  const hits = q("[data-scene-hit]");
  const asks = q("[data-scene-ask]");
  const rows = q("[data-scene-row]");
  const people = q("[data-scene-person]");
  const approved = one("[data-scene-approved]");
  const check = scene.querySelector<SVGPathElement>("[data-scene-check]");
  const ease = EASE_GSAP;

  let current = -1;
  const setStep = (index: number) => {
    if (index === current) return;
    current = index;
    steps.forEach((el, i) => el.classList.toggle("is-current", i === index));
  };

  const tl = gsap.timeline({
    defaults: { ease, duration: 0.5 },
    scrollTrigger: {
      trigger: pin,
      start: "top top",
      end: "+=210%",
      pin: true,
      scrub: true,
      onUpdate: (self) => {
        setStep(self.progress < 0.34 ? 0 : self.progress < 0.67 ? 1 : 2);
        fill?.style.setProperty("--p", self.progress.toFixed(4));
      },
    },
  });
  // Step 1: the phone comes up in front of the fridge and takes the picture.
  tl.fromTo(
    phone,
    { yPercent: 70, rotate: 7, opacity: 0 },
    { yPercent: 0, rotate: 0, opacity: 1, duration: 0.6 },
    0,
  )
    .fromTo(screens[0], { opacity: 1 }, { opacity: 1, duration: 0.01 }, 0)
    .fromTo(screens.slice(1), { opacity: 0 }, { opacity: 0, duration: 0.01 }, 0)
    .fromTo(flash, { opacity: 0 }, { opacity: 0.9, duration: 0.08, ease: "none" }, 0.72)
    .to(flash, { opacity: 0, duration: 0.2, ease: "none" }, 0.8)
    // Step 2: the screen shows Fudepan reading the note and asking.
    .to(screens[0], { opacity: 0, duration: 0.25 }, 1.0)
    .to(screens[1], { opacity: 1, duration: 0.25 }, 1.05)
    .fromTo(
      scan,
      { yPercent: -100, opacity: 0 },
      { yPercent: 900, opacity: 1, duration: 0.6, ease: "none" },
      1.15,
    )
    .to(scan, { opacity: 0, duration: 0.1 }, 1.7)
    .fromTo(hits, { "--hit": 0 }, { "--hit": 1, duration: 0.2, stagger: 0.15 }, 1.3)
    .fromTo(
      asks,
      { opacity: 0, scale: 0.6, y: 12 },
      { opacity: 1, scale: 1, y: 0, duration: 0.35, stagger: 0.12 },
      1.55,
    )
    // Step 3: a plan with people and times, then the family approves.
    .to(asks, { opacity: 0, y: -8, duration: 0.25 }, 2.0)
    .to(screens[1], { opacity: 0, duration: 0.25 }, 2.0)
    .to(screens[2], { opacity: 1, duration: 0.25 }, 2.05)
    .fromTo(rows, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.07 }, 2.15)
    .fromTo(
      people,
      { opacity: 0, y: 12, scale: 0.8 },
      { opacity: 1, y: 0, scale: 1, duration: 0.35, stagger: 0.07 },
      2.4,
    )
    .fromTo(
      approved,
      { opacity: 0, scale: 1.5 },
      { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" },
      2.65,
    )
    .fromTo(check, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.25 }, 2.75)
    .to({}, { duration: 0.25 }, 3.0);

  return () => {
    tl.scrollTrigger?.kill();
    tl.kill();
    section.classList.remove("how--pinned");
    for (const el of steps) el.classList.toggle("is-current", el === steps[0]);
    fill?.style.removeProperty("--p");
    gsap.set(
      [phone, flash, scan, ...hits, ...asks, ...rows, ...people, approved, check, ...screens],
      {
        clearProps: "all",
      },
    );
  };
}

/* ------------------------------------------------------------------------ */
/* Smooth scrolling, driven by the GSAP ticker so ScrollTrigger stays in sync */
/* ------------------------------------------------------------------------ */
function smoothScroll(): Cleanup {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const lenis = new Lenis({
    lerp: 0.12,
    anchors: { offset: -((header?.offsetHeight ?? 72) + 16) },
  });
  lenis.on("scroll", ScrollTrigger.update);
  const tick = (time: number) => lenis.raf(time * 1000);
  gsap.ticker.add(tick);
  gsap.ticker.lagSmoothing(0);
  return () => {
    gsap.ticker.remove(tick);
    gsap.ticker.lagSmoothing(500, 33);
    lenis.destroy();
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
