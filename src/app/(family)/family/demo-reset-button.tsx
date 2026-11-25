"use client";
import { useState, useTransition } from "react";
import { resetDemoNote } from "./demo-reset-action";

export function DemoResetButton({ label, resetLabel, doneLabel }: {
  label: string;
  resetLabel: string;
  doneLabel: string;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function handleClick() {
    setDone(false);
    startTransition(async () => {
      const result = await resetDemoNote();
      if (result.ok) setDone(true);
    });
  }

  return (
    <button
      type="button"
      className="nx-demo-reset"
      onClick={handleClick}
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? (
        <><span className="nx-spinner" aria-hidden="true" /> {resetLabel}</>
      ) : done ? (
        doneLabel
      ) : (
        label
      )}
    </button>
  );
}
