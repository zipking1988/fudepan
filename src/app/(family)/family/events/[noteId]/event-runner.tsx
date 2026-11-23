"use client";

import { useState, useTransition } from "react";

import { formatList } from "@/lib/i18n/format";
import { isMessageKey, type Translator } from "@/lib/i18n/messages";

/** What a family server action returns. Keys and params only, never English text from the server. */
export type ActionResult =
  | { ok: true; outcome?: string; messageKey?: string; missing?: string[] }
  | { ok: false; messageKey: string; params: { field?: string } };

export type PrepareResult =
  | { ok: true; objectPath: string; token: string }
  | { ok: false; messageKey: string; params: { field?: string } };

type Run<I> = (input: I) => Promise<ActionResult>;

/** The actions the Event_View can call. The connected view passes the real Server Actions. */
export type EventActions = {
  claimPart: Run<unknown>;
  releasePart: Run<unknown>;
  requestAssignment: Run<unknown>;
  requestHandover: Run<unknown>;
  requestBackup: Run<unknown>;
  volunteerBackup: Run<unknown>;
  respondToRequest: Run<unknown>;
  decideApproval: Run<unknown>;
  resubmitPart: Run<unknown>;
  completePart: Run<unknown>;
  reportPartFailed: Run<unknown>;
  reopenPart: Run<unknown>;
  confirmPartTime: Run<unknown>;
  resolveMissingDetail: Run<unknown>;
  addTextEvidence: Run<unknown>;
  prepareEvidenceUpload: (input: unknown) => Promise<PrepareResult>;
  completeEvidenceUpload: Run<unknown>;
  /** Uploads the file to private storage with the signed token. True when it arrived. */
  uploadEvidenceFile: (objectPath: string, token: string, file: File) => Promise<boolean>;
  saveAppointment: Run<unknown>;
  savePartAmount: Run<unknown>;
  retryRecognition: Run<unknown>;
};

export type Message = { kind: "status" | "alert"; text: string };

export type Runner = {
  pending: boolean;
  message: Message | null;
  /** Runs one action. Calls `onSuccess` and the page refresh when it worked. */
  run: (fn: () => Promise<ActionResult>, onSuccess?: () => void) => void;
  fail: (text: string) => void;
  clear: () => void;
  start: (fn: () => Promise<void>) => void;
  say: (message: Message) => void;
  /** Re-reads the page. */
  refresh: () => void;
};

/** Plain words for a result key. An unknown key never reaches the person as a code. */
export function resultText(tr: Translator, result: ActionResult): Message {
  if (result.ok) {
    if (result.messageKey && isMessageKey(result.messageKey)) {
      const missing = formatList(result.missing ?? [], tr.lang);
      return { kind: "status", text: tr.t(result.messageKey, { missing }) };
    }
    return { kind: "status", text: tr.t("event.result.saved") };
  }
  const key = isMessageKey(result.messageKey) ? result.messageKey : "refusal.error";
  return { kind: "alert", text: tr.t(key) };
}

export function useRunner(tr: Translator, onChanged: () => void): Runner {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<Message | null>(null);

  return {
    pending,
    message,
    run(fn, onSuccess) {
      setMessage(null);
      startTransition(async () => {
        try {
          const result = await fn();
          setMessage(resultText(tr, result));
          if (result.ok) {
            onSuccess?.();
            onChanged();
          }
        } catch {
          setMessage({ kind: "alert", text: tr.t("event.result.error") });
        }
      });
    },
    fail: (text) => setMessage({ kind: "alert", text }),
    clear: () => setMessage(null),
    start(fn) {
      setMessage(null);
      startTransition(async () => {
        try {
          await fn();
        } catch {
          setMessage({ kind: "alert", text: tr.t("event.result.error") });
        }
      });
    },
    say: (m) => setMessage(m),
    refresh: onChanged,
  };
}
