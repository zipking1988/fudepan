"use client";

import { useState, useTransition } from "react";
import { sendRecipientReply } from "@/app/(family)/family/actions";
import { createTranslator, isMessageKey, type Language } from "@/lib/i18n/messages";
import { Icon } from "./ui";

/**
 * The care recipient's two fixed replies (no free text). The heart and the sent sentence appear
 * only after the server has recorded the reply. The reply goes to the household record, so a
 * family member sees it in the recent activity.
 */
export function PostcardReplies({ noteId, language }: { noteId: string; language: Language }) {
  const tr = createTranslator(language);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ kind: "status" | "alert"; text: string; reply?: "thanks" | "question" } | null>(null);
  const [burst, setBurst] = useState(0);

  function send(reply: "thanks" | "question") {
    setResult(null);
    start(async () => {
      try {
        const res = await sendRecipientReply({ noteId, reply });
        const key = res.messageKey;
        const text = key && isMessageKey(key) ? tr.t(key) : tr.t("refusal.error");
        setResult({ kind: res.ok ? "status" : "alert", text, reply });
        if (res.ok && reply === "thanks") setBurst((n) => n + 1);
      } catch {
        setResult({ kind: "alert", text: tr.t("refusal.error") });
      }
    });
  }

  return (
    <section className="pb-replies" aria-label={tr.t("assistant.reply.heading")}>
      <button type="button" className="pb-thanks-btn" disabled={pending} onClick={() => send("thanks")}>
        <span className="pb-thanks-btn__heart" key={burst} data-burst={burst > 0 ? "" : undefined}>
          <Icon name="heart" size={44} />
        </span>
        <span>{tr.t("pb.card.thanks")}</span>
      </button>
      <button type="button" className="pb-linkbtn pb-linkbtn--center" disabled={pending} onClick={() => send("question")}>
        {tr.t("pb.card.question")}
      </button>
      <p className="pb-replies__hint">{tr.t("assistant.reply.hint")}</p>
      <div role="status" aria-live="polite">
        {result?.kind === "status" && (
          <p className="pb-live__ok pb-live__ok--big">
            <Icon name="check" size={22} /> {result.reply === "thanks" ? `${tr.t("pb.card.heart")}. ` : ""}
            {result.text}
          </p>
        )}
      </div>
      <div role="alert">{result?.kind === "alert" && <p className="pb-live__error">{result.text}</p>}</div>
    </section>
  );
}
