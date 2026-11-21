"use client";

import { useEffect } from "react";

/**
 * Section entrances. Nothing is hidden by CSS alone: this component marks what
 * is already on screen as revealed, then adds `reveal-ready` so the rest waits
 * below the fold. Without JavaScript, or if this never runs, every section
 * stays visible.
 */
export function Reveal() {
  useEffect(() => {
    const html = document.documentElement;
    const targets = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (!("IntersectionObserver" in window)) return;

    const vh = window.innerHeight;
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.92 && r.bottom > 0) el.classList.add("is-in");
    }
    html.classList.add("reveal-ready");

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    for (const el of targets) if (!el.classList.contains("is-in")) observer.observe(el);
    return () => {
      observer.disconnect();
      html.classList.remove("reveal-ready");
    };
  }, []);
  return null;
}
