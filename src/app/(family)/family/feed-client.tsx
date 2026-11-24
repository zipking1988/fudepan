"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { markFeedSeen } from "./actions";

const POLL_MS = 30_000;

/**
 * Refreshes the page every 30 seconds while it is visible and announces the number of new
 * updates in a polite live region (Requirement 4.7). `message` is already translated.
 */
export function FeedPoller({ message }: { message: string }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [router]);
  return (
    <p role="status" aria-live="polite" className="app-hint">
      {message}
    </p>
  );
}

type ButtonText = { label: string; failedText: string };

export function MarkSeenButton({ householdId, label, failedText }: ButtonText & { householdId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <div className="grid gap-2">
      <button
        type="button"
        className="app-button app-button--quiet"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await markFeedSeen({ householdId });
            setFailed(!result.ok);
            if (result.ok) router.refresh();
          })
        }
      >
        {label}
      </button>
      {failed && (
        <p role="alert" className="app-field-error">
          {failedText}
        </p>
      )}
    </div>
  );
}
