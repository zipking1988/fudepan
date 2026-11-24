"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { createTranslator, type Language } from "@/lib/i18n/messages";
import { MAX_PORTRAIT_BYTES } from "@/lib/portraits/rules";
import { setPortraitAction } from "./actions";
/** Add or change the care recipient's photo. The server checks the role, membership, type and size again. */
export function PortraitButton({
  memberId,
  name,
  hasPhoto,
  language,
  onSaved,
}: {
  memberId: string;
  name: string;
  hasPhoto: boolean;
  language: Language;
  /** Called with a cache-busting version as soon as the server confirms the save. */
  onSaved?: (version: string) => void;
}) {
  const tr = createTranslator(language);
  const router = useRouter();
  const id = useId();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  function onPick(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (file.size > MAX_PORTRAIT_BYTES) {
      setMessage({ kind: "error", text: tr.t("pb.portrait.err.tooLarge") });
      return;
    }
    const form = new FormData();
    form.set("memberId", memberId);
    form.set("photo", file);
    setMessage(null);
    start(async () => {
      try {
        const result = await setPortraitAction(form);
        if (result.ok) {
          if (result.version) onSaved?.(result.version);
          setMessage({ kind: "ok", text: tr.t("pb.portrait.saved") });
          router.refresh();
        } else setMessage({ kind: "error", text: tr.t(result.messageKey) });
      } catch {
        setMessage({ kind: "error", text: tr.t("pb.portrait.err.failed") });
      }
    });
  }
  return (
    <div className="pb-portrait">
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        disabled={pending}
        aria-describedby={`${id}-help`}
        onChange={(e) => onPick(e.currentTarget)}
      />
      <label htmlFor={id} className="pb-btn pb-btn--outline pb-portrait__btn">
        {pending ? tr.t("pb.portrait.saving") : hasPhoto ? tr.t("pb.portrait.change") : tr.t("pb.portrait.add")}
        <span className="sr-only"> {tr.t("pb.portrait.label", { name })}</span>
      </label>
      <p id={`${id}-help`} className="pb-hint">
        {tr.t("pb.portrait.help")}
      </p>
      <div role="status" aria-live="polite">
        {message?.kind === "ok" && <p>{message.text}</p>}
      </div>
      {message?.kind === "error" && <p role="alert">{message.text}</p>}
    </div>
  );
}
