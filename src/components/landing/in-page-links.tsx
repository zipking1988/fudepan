"use client";

import { useEffect } from "react";

import { ANCHOR_EVENT } from "./motion/tokens";

/**
 * Keeps in-page links (#sample-draft, #how-it-works, ...) usable from the
 * keyboard: after the jump, focus moves to the target so Tab continues from
 * there. Scrolling itself stays native and is never intercepted, and the fixed header is
 * cleared by `scroll-margin-top` in landing.css. Without JavaScript the links
 * still scroll to the right place.
 */
export function InPageLinks() {
  useEffect(() => {
    const land = (id: string) => {
      const target = document.getElementById(id);
      if (!target) return;
      // The sample must be ready to use on arrival, even if the hero entrance
      // has not loaded or finished yet (hero-intro.ts honors this class).
      if (id === "sample-draft") document.documentElement.classList.add("intro-done");
      window.dispatchEvent(new CustomEvent(ANCHOR_EVENT, { detail: { id } }));
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      // The scroll is already handled; focusing must not jump again.
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    };
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const link = event.target instanceof Element ? event.target.closest("a[href^='#']") : null;
      const id = link?.getAttribute("href")?.slice(1);
      if (id) land(decodeURIComponent(id));
    };
    document.addEventListener("click", onClick);
    // Arriving with a hash (for example a shared link to #sample-draft).
    if (location.hash.length > 1) land(decodeURIComponent(location.hash.slice(1)));
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
