"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { IconPause, IconPlay, IconReplay } from "@/components/landing/Icons";
import { NoteScene, type SceneApi, type SceneMode } from "@/components/landing/NoteScene";
import { STEP_AT, clamp, easeOut, sceneStep, type SceneStep } from "@/lib/demo/scene";
import { t } from "@/lib/i18n/messages";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
const PLAY_MS = 7000;

/**
 * The example page's scene, driven by the visitor: drag the slider (or use the arrow keys), press
 * Play, or pick a step. Nothing moves until the visitor asks. Reduced motion shows the still layout.
 */
export function DemoScene({
  referenceLabel,
  thursdayLabel,
}: {
  referenceLabel: string;
  thursdayLabel: string;
}) {
  const [mode, setMode] = useState<SceneMode>("auto");
  const [value, setValue] = useState(100);
  const [playing, setPlaying] = useState(false);
  const scene = useRef<SceneApi>(null);
  const raf = useRef(0);
  const valueRef = useRef(100);

  useIso(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMode(mq.matches ? "static" : "motion");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const show = useCallback((v: number) => {
    valueRef.current = v;
    setValue(v);
    scene.current?.apply(v / 100);
  }, []);

  useIso(() => {
    if (mode === "motion") scene.current?.apply(valueRef.current / 100);
  }, [mode]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
    setPlaying(false);
  }, []);
  useEffect(() => stop, [stop]);

  const animateTo = useCallback(
    (to: number, ms: number) => {
      cancelAnimationFrame(raf.current);
      const from = valueRef.current;
      const start = performance.now();
      const frame = (now: number) => {
        const k = clamp((now - start) / ms, 0, 1);
        show(from + (to - from) * (ms > 1500 ? k : easeOut(k)));
        if (k < 1) raf.current = requestAnimationFrame(frame);
        else stop();
      };
      raf.current = requestAnimationFrame(frame);
    },
    [show, stop],
  );

  const play = () => {
    if (playing) return stop();
    const from = valueRef.current >= 99.5 ? 0 : valueRef.current;
    if (from === 0) show(0);
    setPlaying(true);
    animateTo(100, PLAY_MS * (1 - from / 100));
  };

  const step: SceneStep = sceneStep(value / 100);
  const steps = t.landing.steps;
  const label = step === 0 ? t.demo.sceneStart : steps[step - 1]!.label;

  return (
    <div className="lp-demo" data-mode={mode}>
      <div className="lp-demo-stage">
        <NoteScene
          variant="box"
          mode={mode}
          apiRef={scene}
          referenceLabel={referenceLabel}
          thursdayLabel={thursdayLabel}
        />
      </div>

      {mode === "static" ? null : (
        <div className="lp-demo-controls">
          <button
            type="button"
            className="lp-btn lp-btn--primary lp-btn--round"
            onClick={play}
            aria-label={playing ? t.demo.pause : value >= 99.5 ? t.demo.replay : t.demo.play}
          >
            {playing ? <IconPause /> : value >= 99.5 ? <IconReplay /> : <IconPlay />}
          </button>
          <div className="lp-demo-track">
            <label htmlFor="demo-scrub" className="sr-only">
              {t.demo.scrubLabel}
            </label>
            <input
              id="demo-scrub"
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(value)}
              aria-valuetext={`${label}`}
              onChange={(e) => {
                stop();
                show(Number(e.target.value));
              }}
              className="lp-range"
              style={{ "--v": `${value}%` } as React.CSSProperties}
              data-testid="demo-scrub"
            />
            <div className="lp-demo-steps" role="group" aria-label={t.landing.stepsLabel}>
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
                    onClick={() => {
                      stop();
                      animateTo(STEP_AT[n] * 100, 900);
                    }}
                  >
                    <span className="lp-step-num" aria-hidden="true">
                      0{n}
                    </span>
                    {s.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      <p className="lp-demo-caption" data-testid="demo-caption" aria-live="polite">
        {step === 0 ? t.demo.sceneStartBody : steps[step - 1]!.body}
      </p>
    </div>
  );
}
