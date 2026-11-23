"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { createTranslator, isMessageKey, type Language } from "@/lib/i18n/messages";
import { sendRecipientReply } from "./actions";

const subscribeNever = () => () => {};

/** True only in a browser that has speech synthesis. False while rendering on the server. */
function useCanSpeak(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => typeof window !== "undefined" && "speechSynthesis" in window,
    () => false,
  );
}

/**
 * Reads the shown sentences aloud with the device's own speech (Requirement 13.12).
 * Nothing is sent anywhere: the browser speaks the text it already shows.
 */
export function ReadAloudButton({ text, language }: { text: string; language: Language }) {
  const tr = createTranslator(language);
  const canSpeak = useCanSpeak();
  const [speaking, setSpeaking] = useState(false);
  if (!canSpeak || !text.trim()) return null;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language === "ja" ? "ja-JP" : "en-US";
    utterance.rate = 0.9;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(utterance);
  }

  return (
    <button type="button" className="family-assistant__speak" onClick={toggle} aria-pressed={speaking}>
      <span aria-hidden="true">🔊</span> {speaking ? tr.t("assistant.stopReading") : tr.t("assistant.readAloud")}
    </button>
  );
}

/** The two fixed replies. No free text (Requirement 13.8). */
export function ReplyButtons({ noteId, language }: { noteId: string; language: Language }) {
  const tr = createTranslator(language);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "status" | "alert"; text: string } | null>(null);

  function send(reply: "thanks" | "question") {
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await sendRecipientReply({ noteId, reply });
        const key = result.ok ? result.messageKey : result.messageKey;
        const text = key && isMessageKey(key) ? tr.t(key) : tr.t("refusal.error");
        setMessage({ kind: result.ok ? "status" : "alert", text });
      } catch {
        setMessage({ kind: "alert", text: tr.t("refusal.error") });
      }
    });
  }

  return (
    <section className="grid gap-3" aria-labelledby={`reply-${noteId}`}>
      <h3 id={`reply-${noteId}`} className="text-xl font-semibold">
        {tr.t("assistant.reply.heading")}
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          className="family-assistant__reply"
          disabled={pending}
          onClick={() => send("thanks")}
        >
          <span aria-hidden="true">👍</span> {tr.t("assistant.reply.thanks")}
        </button>
        <button
          type="button"
          className="family-assistant__reply"
          disabled={pending}
          onClick={() => send("question")}
        >
          <span aria-hidden="true">🙋</span> {tr.t("assistant.reply.question")}
        </button>
      </div>
      <p className="text-lg text-stone-700">{tr.t("assistant.reply.hint")}</p>
      <div role="status" aria-live="polite">
        {message?.kind === "status" && <p className="app-success text-xl">{message.text}</p>}
      </div>
      <div role="alert">{message?.kind === "alert" && <p className="app-alert text-xl">{message.text}</p>}</div>
    </section>
  );
}
