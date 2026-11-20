"use client";

import { useId, useMemo, useState } from "react";
import { IconAlert, IconCheck, IconHand, IconLock } from "@/components/landing/Icons";
import { MAX_SANDBOX_LENGTH, NEXT_STEP_TEXT, checkNote } from "@/lib/demo/check-note";
import { t } from "@/lib/i18n/messages";
import { MASK, type SensitiveKind } from "@/lib/safety/mask-sensitive";

const EXAMPLES: { label: string; text: string }[] = [
  {
    label: "Fake police call",
    text: "警察の人から電話。キャッシュカードを封筒に入れて渡す。今日中。",
  },
  { label: "Card number", text: "カード番号 4242 4242 4242 4242 で払う" },
  { label: "Shopping", text: "買い物 たまご・牛乳" },
  { label: "Medicine", text: "夜 血圧の薬をのむ" },
];

const KIND_LABELS: Record<SensitiveKind, string> = {
  card_number: "card number",
  id_number: "ID number",
  bank_account: "bank account number",
  insurance_number: "insurance number",
  password: "password",
  one_time_code: "one-time code",
};

function MaskedText({ text }: { text: string }) {
  const parts = text.split(MASK);
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? <mark className="lp-mask">{MASK}</mark> : null}
        </span>
      ))}
    </>
  );
}

/**
 * Runs Fudepan's real masking, category, risk and scam rules in the browser. Nothing is sent or
 * saved. Reading dates, places and names needs the AI step, which runs only in a signed-in household.
 */
export function TrySection() {
  const id = useId();
  const [text, setText] = useState("");
  const result = useMemo(() => checkNote(text), [text]);

  return (
    <section aria-labelledby={`${id}-title`} className="lp-light lp-light--2 full-bleed" data-try>
      <div className="lp-wrap">
        <div className="lp-section-head">
          <p className="lp-kicker">{t.sandbox.eyebrow}</p>
          <h2 id={`${id}-title`} className="lp-h2">
            {t.sandbox.title}
          </h2>
          <p className="lp-body">{t.sandbox.intro}</p>
        </div>

        <div className="lp-try">
          <div className="lp-try-input">
            <label htmlFor={`${id}-input`} className="lp-label">
              {t.sandbox.label}
            </label>
            <div className="lp-paper lp-paper--input">
              <textarea
                id={`${id}-input`}
                lang="ja"
                rows={5}
                maxLength={MAX_SANDBOX_LENGTH}
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-describedby={`${id}-help`}
                className="lp-textarea hand-ja"
                placeholder="例：金曜 水道代を払う"
              />
            </div>
            <p id={`${id}-help`} className="lp-help">
              {t.sandbox.help}
            </p>
            <div className="lp-chips" role="group" aria-label={t.sandbox.examples}>
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.label}
                  type="button"
                  className="lp-chip"
                  onClick={() => setText(ex.text)}
                >
                  {t.sandbox.try}: {ex.label}
                </button>
              ))}
            </div>
          </div>

          <div aria-live="polite" className="lp-result" data-testid="sandbox-result">
            <p className="lp-result-title">{t.sandbox.resultTitle}</p>
            {result.empty ? (
              <p className="lp-result-empty">{t.sandbox.empty}</p>
            ) : (
              <div className="grid gap-5">
                <div>
                  <p className="lp-result-label">{t.sandbox.stored}</p>
                  <p lang="ja" className="lp-result-text">
                    <MaskedText text={result.masked} />
                  </p>
                  {result.maskedKinds.length > 0 ? (
                    <p className="lp-result-note">
                      <IconLock />
                      <span>
                        {t.sandbox.hidden}:{" "}
                        {result.maskedKinds.map((k) => KIND_LABELS[k]).join(", ")}
                      </span>
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="lp-risk" data-level={result.risk}>
                    {result.risk === "low" ? <IconCheck /> : <IconAlert />}
                    {t.risk[result.risk]}
                  </span>
                  <span className="lp-tag lp-tag--lg">{t.review.categories[result.category]}</span>
                </div>
                {result.possibleFraud ? (
                  <p role="alert" className="lp-result-scam">
                    <IconHand />
                    <span>{t.sandbox.scam}</span>
                  </p>
                ) : null}
                <p className="lp-result-next">
                  <strong>{t.sandbox.next}:</strong> {NEXT_STEP_TEXT[result.nextStep]}
                </p>
              </div>
            )}
            <p className="lp-result-honesty">{t.sandbox.honesty}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
