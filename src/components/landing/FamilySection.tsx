"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Stat } from "@/components/landing/Stat";
import { clamp } from "@/lib/demo/scene";
import { t } from "@/lib/i18n/messages";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Who does what. A line draws through the five steps as the section scrolls past (native scroll,
 * nothing pinned). All steps are shown with reduced motion or without JavaScript.
 */
export function FamilySection() {
  const steps = t.landing.family.steps;
  const [lit, setLit] = useState<number>(steps.length);
  const listRef = useRef<HTMLOListElement>(null);

  useIso(() => {
    const list = listRef.current;
    if (!list || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const r = list.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = clamp((vh * 0.82 - r.top) / (r.height + vh * 0.25), 0, 1);
      list.style.setProperty("--line", p.toFixed(4));
      setLit(Math.min(steps.length, Math.floor(p * steps.length + 0.35)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [steps.length]);

  return (
    <section aria-labelledby="family-title" className="lp-light full-bleed" data-family>
      <div className="lp-wrap">
        <div className="lp-section-head">
          <p className="lp-kicker">{t.landing.family.kicker}</p>
          <h2 id="family-title" className="lp-h2">
            {t.landing.family.title}
          </h2>
          <p className="lp-body">{t.landing.family.body}</p>
        </div>

        <ol ref={listRef} className="lp-flow" data-lit={lit}>
          {steps.map((s, i) => (
            <li key={s.who} className="lp-flow-step" data-on={i < lit}>
              <span className="lp-flow-avatar" data-kind={s.kind} aria-hidden="true">
                <span lang={s.kind === "grandma" ? "ja" : undefined}>{s.mark}</span>
              </span>
              <p className="lp-flow-who">{s.who}</p>
              <p className="lp-flow-what">{s.what}</p>
            </li>
          ))}
        </ol>

        <div className="lp-family-foot">
          <p className="lp-promise">{t.landing.family.promise}</p>
          <Stat id="intervention" />
        </div>
      </div>
    </section>
  );
}
