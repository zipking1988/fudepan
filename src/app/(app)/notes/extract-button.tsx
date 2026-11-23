"use client";

import { ReadingFailed, ReadingInProgress, useReadNote } from "./read-note";

/** Starts reading a saved note (first time or retry). */
export function ExtractButton({ noteId, retry = false }: { noteId: string; retry?: boolean }) {
  const { state, read } = useReadNote();

  if (state.phase === "reading") return <ReadingInProgress startedAt={state.startedAt} />;

  return (
    <div className="grid gap-4">
      {state.phase === "failed" && <ReadingFailed message={state.message} />}
      <div>
        <button type="button" onClick={() => read(noteId)} className="app-button">
          {state.phase === "failed" || retry ? "Try reading again" : "Read this note"}
        </button>
      </div>
    </div>
  );
}
