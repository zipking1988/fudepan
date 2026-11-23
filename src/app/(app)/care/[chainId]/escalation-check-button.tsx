"use client";

import { useState, useTransition } from "react";

import { runEscalationCheck } from "../actions";

export function EscalationCheckButton({ householdId }: { householdId: string }) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleCheck() {
    setMessage(null);
    startTransition(async () => {
      const result = await runEscalationCheck(householdId);
      if (result.ok) {
        setMessage(
          result.count === 0
            ? "No overdue steps found."
            : `${result.count} overdue step${result.count > 1 ? "s" : ""} escalated. See the timeline for details.`,
        );
      } else {
        setMessage(`Could not check: ${result.error}`);
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleCheck}
        disabled={isPending}
        className="app-button app-button--quiet"
        aria-describedby="escalation-hint"
      >
        {isPending ? "Checking…" : "Check for overdue steps"}
      </button>
      <p id="escalation-hint" className="app-hint text-sm">
        Marks any steps that have passed their deadline as escalated and records it in the timeline.
        {" "}In a production setup this runs automatically on a schedule.
      </p>
      {message && (
        <p role="status" className="w-full app-hint font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
