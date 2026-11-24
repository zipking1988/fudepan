"use client";
import Link from "next/link";
import { useCallback, useSyncExternalStore } from "react";

import type { DismissiblePrompt, FirstRunPrompt } from "@/lib/membership/first-run";
import { createTranslator, type Language } from "@/lib/i18n/messages";

const DISMISSIBLE: readonly DismissiblePrompt[] = ["invite_family", "invite_recipient"];
const EVENT = "fudepan:first-run-dismissed";

export function dismissedStorageKey(householdId: string): string {
  return `fudepan.firstRun.dismissed.${householdId}`;
}

function read(householdId: string): string {
  try {
    return window.localStorage.getItem(dismissedStorageKey(householdId)) ?? "";
  } catch {
    return "";
  }
}

export function parseDismissed(raw: string): Set<DismissiblePrompt> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return new Set();
    return new Set(value.filter((v): v is DismissiblePrompt => DISMISSIBLE.includes(v as DismissiblePrompt)));
  } catch {
    return new Set();
  }
}

const COPY = {
  take_photo: { title: "firstRun.takePhoto.title", body: "firstRun.takePhoto.body", action: "firstRun.takePhoto.action", href: "/family/capture" },
  invite_family: { title: "firstRun.inviteFamily.title", body: "firstRun.inviteFamily.body", action: "firstRun.inviteFamily.action", href: "/family/invites" },
  invite_recipient: { title: "firstRun.inviteRecipient.title", body: "firstRun.inviteRecipient.body", action: "firstRun.inviteRecipient.action", href: "/family/invites?role=care_recipient" },
} as const;

/**
 * `all` is the prompts computed with nothing dismissed. Dismissed invite prompts are read from
 * localStorage after mount (server snapshot: none dismissed), so server and first client render match.
 */
export function FirstRunPrompts({
  householdId,
  language,
  prompts,
}: {
  householdId: string;
  language: Language;
  prompts: FirstRunPrompt[];
}) {
  const tr = createTranslator(language);
  const subscribe = useCallback((cb: () => void) => {
    window.addEventListener(EVENT, cb);
    window.addEventListener("storage", cb);
    return () => {
      window.removeEventListener(EVENT, cb);
      window.removeEventListener("storage", cb);
    };
  }, []);
  const raw = useSyncExternalStore(
    subscribe,
    () => read(householdId),
    () => "",
  );
  const dismissed = parseDismissed(raw);

  function dismiss(prompt: DismissiblePrompt) {
    const next = [...new Set([...dismissed, prompt])];
    try {
      window.localStorage.setItem(dismissedStorageKey(householdId), JSON.stringify(next));
    } catch {
      /* storage unavailable: the prompt stays */
    }
    window.dispatchEvent(new Event(EVENT));
  }

  const shown = prompts.filter(
    (p): p is keyof typeof COPY => p in COPY && !(DISMISSIBLE.includes(p as DismissiblePrompt) && dismissed.has(p as DismissiblePrompt)),
  );
  if (shown.length === 0) return null;
  return (
    <section aria-label={tr.t("firstRun.takePhoto.title")} className="grid gap-4">
      {shown.map((p) => {
        const c = COPY[p];
        return (
          <article key={p} className="app-panel grid gap-3">
            <h2 className="app-subtitle">{tr.t(c.title)}</h2>
            <p>{tr.t(c.body)}</p>
            <div className="flex flex-wrap gap-3">
              <Link href={c.href} className="app-button">
                {tr.t(c.action)}
              </Link>
              {p !== "take_photo" && (
                <button type="button" className="app-button app-button--quiet" onClick={() => dismiss(p)}>
                  {tr.t("firstRun.dismiss")}
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
