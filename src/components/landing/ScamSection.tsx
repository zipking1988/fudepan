"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { HandChars } from "@/components/landing/Hand";
import { IconHand, IconReplay } from "@/components/landing/Icons";
import { Stat } from "@/components/landing/Stat";
import { SCAM_LINES, SCAM_SIGNALS, SCAM_TEXT, assess } from "@/lib/demo/landing";
import { t } from "@/lib/i18n/messages";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Splits a line so each warning sign is its own segment. */
function segments(line: string): { text: string; signal?: number }[] {
  let parts: { text: string; signal?: number }[] = [{ text: line }];
  SCAM_SIGNALS.forEach((sig, i) => {
    parts = parts.flatMap((p) => {
      if (p.signal !== undefined) return [p];
      const at = p.text.indexOf(sig.text);
      if (at < 0) return [p];
      return [
        ...(at > 0 ? [{ text: p.text.slice(0, at) }] : []),
        { text: sig.text, signal: i },
        ...(at + sig.text.length < p.text.length
          ? [{ text: p.text.slice(at + sig.text.length) }]
          : []),
      ];
    });
  });
  return parts;
}

/**
 * The scam check. When the section scrolls into view, the warning signs are marked one by one and
 * the note is stamped "check first". It plays once per visit and can be replayed. With reduced
 * motion, or without JavaScript, the finished state is shown.
 */
export function ScamSection() {
  // 0 = nothing marked … 3 = all signs marked, 4 = stamped, 5 = guidance shown.
  const [stage, setStage] = useState(5);
  const rootRef = useRef<HTMLElement>(null);
  const timers = useRef<number[]>([]);
  const a = assess(SCAM_TEXT);

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStage(5);
      return;
    }
    setStage(0);
    timers.current = [450, 900, 1350, 2000, 2500].map((ms, i) =>
      window.setTimeout(() => setStage(i + 1), ms),
    );
  }, []);

  useIso(() => {
    const el = rootRef.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setStage(0);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          play();
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el.querySelector("[data-scam-note]") ?? el);
    return () => {
      io.disconnect();
      timers.current.forEach(clearTimeout);
    };
  }, [play]);

  return (
    <section
      ref={rootRef}
      aria-labelledby="scam-title"
      className="lp-dark full-bleed"
      data-scam
      data-stage={stage}
    >
      <div className="lp-wrap lp-split">
        <div className="lp-split-text">
          <p className="lp-kicker lp-kicker--shu">{t.landing.scam.kicker}</p>
          <h2 id="scam-title" className="lp-h2">
            {t.landing.scam.title}
          </h2>
          <p className="lp-body">{t.landing.scam.body}</p>
          <Stat id="scamLosses" tone="dark" />
        </div>

        <div className="lp-scam-visual">
          <figure
            className="lp-paper lp-paper--scam"
            data-scam-note
            aria-label={t.landing.scam.noteLabel}
          >
            <p className="sr-only" lang="ja">
              {SCAM_LINES.join(" ")}
            </p>
            <div className="lp-paper-hand hand-ja" lang="ja" aria-hidden="true">
              {SCAM_LINES.map((line, li) => (
                <span key={li} className="block">
                  {segments(line).map((seg, si) =>
                    seg.signal !== undefined ? (
                      <span key={si} className="lp-signal" data-on={stage > seg.signal}>
                        <HandChars text={seg.text} seed={li * 13 + si} />
                      </span>
                    ) : (
                      <HandChars key={si} text={seg.text} seed={li * 7 + si} />
                    ),
                  )}
                </span>
              ))}
            </div>
            <span className="lp-seal" data-on={stage >= 4} data-scam-stamp aria-hidden="true">
              <span lang="ja">要確認</span>
              <small>{t.landing.scam.seal}</small>
            </span>
          </figure>

          <div className="lp-held" data-on={stage >= 5} data-scam-card>
            <p className="lp-held-head">
              <span className="lp-held-icon" aria-hidden="true">
                <IconHand />
              </span>
              <span>{t.landing.scam.held}</span>
              <span className="lp-risk" data-level={a.risk}>
                {t.risk[a.risk]}
              </span>
            </p>
            <p className="lp-held-title">{t.landing.scam.cardTitle}</p>
            <ul className="lp-held-list">
              {SCAM_SIGNALS.map((s) => (
                <li key={s.text}>
                  <q lang="ja" className="hand-ja">
                    {s.text}
                  </q>
                  <span>{s.label}</span>
                </li>
              ))}
            </ul>
            <p className="lp-held-guide">{t.landing.scam.guide}</p>
          </div>

          <button type="button" className="lp-replay" onClick={play}>
            <IconReplay />
            {t.landing.scam.replay}
          </button>
        </div>
      </div>
    </section>
  );
}
