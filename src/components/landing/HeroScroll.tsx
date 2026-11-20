"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconArrow, IconArrowDown } from "@/components/landing/Icons";
import { NoteScene, type SceneApi, type SceneMode } from "@/components/landing/NoteScene";
import { STEP_AT, clamp, ease, segment, type SceneStep } from "@/lib/demo/scene";
import { t } from "@/lib/i18n/messages";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The landing-page hero. Native scrolling drives the note-to-task scene: the page is never
 * scroll-jacked, nothing plays on its own, and the step buttons only scroll the page. With reduced
 * motion, or without JavaScript, the same content is shown as a still layout.
 */
export function HeroScroll({
  referenceLabel,
  thursdayLabel,
}: {
  referenceLabel: string;
  thursdayLabel: string;
}) {
  const [mode, setMode] = useState<SceneMode>("auto");
  const [step, setStep] = useState<SceneStep>(0);
  const rootRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  const stepsRef = useRef<HTMLDivElement>(null);
  const scene = useRef<SceneApi>(null);

  useIso(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMode(mq.matches ? "static" : "motion");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useIso(() => {
    const root = rootRef.current;
    const copy = copyRef.current;
    const steps = stepsRef.current;
    if (!root || !copy || !steps) return;
    if (mode !== "motion") {
      copy.removeAttribute("style");
      steps.removeAttribute("style");
      return;
    }

    const progress = () => {
      const r = root.getBoundingClientRect();
      const range = r.height - window.innerHeight;
      return range > 0 ? clamp(-r.top / range, 0, 1) : 0;
    };
    const paint = (p: number) => {
      scene.current?.apply(p);
      const h = ease(segment(p, 0, 0.09));
      copy.style.opacity = (1 - h).toFixed(3);
      copy.style.transform = `translate3d(0, ${(-56 * h).toFixed(1)}px, 0) scale(${(1 - 0.03 * h).toFixed(4)})`;
      copy.style.visibility = p > 0.1 ? "hidden" : "visible";
      const so = segment(p, 0.05, 0.1);
      steps.style.opacity = so.toFixed(3);
      steps.style.visibility = so < 0.01 ? "hidden" : "visible";
      root.style.setProperty("--hero-p", p.toFixed(4));
    };

    // Follow the scroll position with gentle easing so the camera glides instead of jumping.
    let target = progress();
    let current = target;
    let raf = 0;
    const frame = () => {
      current += (target - current) * 0.14;
      if (Math.abs(target - current) < 0.0004) current = target;
      paint(current);
      raf = current === target ? 0 : requestAnimationFrame(frame);
    };
    const onScroll = () => {
      target = progress();
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onResize = () => {
      scene.current?.measure();
      target = progress();
      current = target;
      paint(current);
    };
    paint(current);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [mode]);

  const jump = useCallback((n: Exclude<SceneStep, 0>) => {
    const root = rootRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top + window.scrollY;
    const range = root.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + STEP_AT[n] * range, behavior: "smooth" });
  }, []);

  const steps = t.landing.steps;
  const active = step === 0 ? null : steps[step - 1]!;

  return (
    <section
      ref={rootRef}
      aria-labelledby="hero-title"
      className="lp-hero full-bleed"
      data-mode={mode}
    >
      <div className="lp-hero-stage">
        <div ref={copyRef} className="lp-hero-copy" data-scene-above>
          <p className="lp-kicker lp-in" style={{ animationDelay: "40ms" }}>
            {t.landing.eyebrow}
          </p>
          <h1 id="hero-title" className="lp-display">
            <span className="lp-in block" style={{ animationDelay: "120ms" }}>
              {t.landing.title}
            </span>{" "}
            <span className="lp-in block text-sumi-2" style={{ animationDelay: "220ms" }}>
              {t.landing.titleLine2}
            </span>
          </h1>
          <p className="lp-lead lp-in" style={{ animationDelay: "320ms" }}>
            {t.landing.lead}
          </p>
          <div className="lp-actions lp-in" style={{ animationDelay: "420ms" }}>
            <Link href="/demo" className="lp-btn lp-btn--primary">
              {t.landing.tryExample}
              <IconArrow />
            </Link>
            <Link href="/login?next=%2F%23add-note" className="lp-btn lp-btn--ghost">
              {t.landing.upload}
            </Link>
          </div>
          {mode !== "static" ? (
            <p className="lp-scroll-hint lp-in" style={{ animationDelay: "900ms" }}>
              <span className="lp-scroll-line" aria-hidden="true" />
              {t.landing.scrollHint}
            </p>
          ) : null}
        </div>

        <NoteScene
          variant="hero"
          mode={mode}
          apiRef={scene}
          referenceLabel={referenceLabel}
          thursdayLabel={thursdayLabel}
          onStep={setStep}
        />

        {/* Step controls (motion) or the four steps written out (still layout). Before hydration
            both are rendered and CSS picks one, so the page also works without JavaScript. */}
        <div ref={stepsRef} className="lp-steps">
          {mode !== "motion" ? (
            <ol className="lp-steps-static">
              {steps.map((s, i) => (
                <li key={s.label}>
                  <span className="lp-step-num">0{i + 1}</span>
                  <strong>{s.label}</strong>
                  <span>{s.body}</span>
                </li>
              ))}
            </ol>
          ) : null}
          {mode !== "static" ? (
            <div className="lp-step-controls">
              <p className="lp-step-caption" data-testid="hero-caption">
                {active ? active.body : "\u00a0"}
              </p>
              <nav aria-label={t.landing.stepsLabel} className="lp-step-nav">
                {steps.map((s, i) => {
                  const n = (i + 1) as Exclude<SceneStep, 0>;
                  return (
                    <button
                      key={s.label}
                      type="button"
                      className="lp-step-btn"
                      data-on={step === n}
                      data-done={step > n}
                      aria-current={step === n ? "step" : undefined}
                      onClick={() => jump(n)}
                    >
                      <span className="lp-step-num" aria-hidden="true">
                        0{n}
                      </span>
                      {s.label}
                    </button>
                  );
                })}
                <span className="lp-step-track" aria-hidden="true">
                  <span className="lp-step-fill" />
                </span>
              </nav>
              <a href="#after-hero" className="lp-skip">
                {t.landing.skip}
                <IconArrowDown />
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
