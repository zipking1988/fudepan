"use client";

import { useEffect } from "react";

/**
 * Loads the motion runtime (GSAP, ScrollTrigger, Lenis) after the page is
 * interactive, in its own chunk. The page is complete and usable without it.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-landing]");
    if (!root) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    const load = () =>
      import("./runtime").then(({ startMotion }) => {
        if (!cancelled) stop = startMotion(root);
      });
    // Keep the main thread free for the first paint and hydration.
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(() => void load(), { timeout: 1200 })
      : window.setTimeout(() => void load(), 200);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
      stop?.();
    };
  }, []);
  return null;
}
