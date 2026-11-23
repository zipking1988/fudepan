"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getReadingStatus, triggerExtraction } from "@/app/(app)/care/actions";
import { retryRecognition } from "./actions";

export type ReadState =
  | { phase: "idle" }
  | { phase: "reading"; startedAt: number }
  | { phase: "failed"; message: string };

const POLL_EVERY_MS = 3000;
/** About three minutes: longer than a normal read, then the person is told plainly. */
const MAX_POLLS = 60;
const TOO_LONG =
  "Reading is taking longer than usual. The photo is saved. Open the note in a minute to see the result.";
const LOST =
  "The connection was lost while reading. The photo is saved. Try again.";

/**
 * Follows the automatic reading of a note and opens the drafted Care Chain.
 * `watch` polls the run's outcome (bounded, stops on success or failure);
 * `read` starts the old direct read and falls back to `watch` when the note is
 * already being read; `retry` starts a new run with retryRecognition.
 */
export function useReadNote() {
  const router = useRouter();
  const [state, setState] = useState<ReadState>({ phase: "idle" });
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const set = useCallback((next: ReadState) => {
    if (alive.current) setState(next);
  }, []);

  const watch = useCallback(
    async (noteId: string) => {
      if (running.current) return;
      running.current = true;
      set({ phase: "reading", startedAt: Date.now() });
      try {
        for (let i = 0; i < MAX_POLLS && alive.current; i++) {
          const status = await getReadingStatus(noteId);
          if (status.state === "ready") {
            router.push(`/care/${status.careChainId}`);
            return; // keep showing "reading" until the next page replaces this one
          }
          if (status.state === "failed") {
            set({ phase: "failed", message: status.message });
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, POLL_EVERY_MS));
        }
        if (alive.current) set({ phase: "failed", message: TOO_LONG });
      } catch {
        set({ phase: "failed", message: LOST });
      } finally {
        running.current = false;
        if (alive.current) router.refresh();
      }
    },
    [router, set],
  );

  const read = useCallback(
    async (noteId: string) => {
      if (running.current) return;
      let alreadyReading = false;
      running.current = true;
      set({ phase: "reading", startedAt: Date.now() });
      try {
        const result = await triggerExtraction(noteId);
        if (result.ok) {
          router.push(`/care/${result.careChainId}`);
          return; // keep showing "reading" until the next page replaces this one
        }
        if ("state" in result && result.state === "reading") {
          alreadyReading = true; // in progress, not an error
        } else {
          set({ phase: "failed", message: result.error });
        }
      } catch {
        set({ phase: "failed", message: LOST });
      } finally {
        running.current = false;
        router.refresh();
      }
      if (alreadyReading) await watch(noteId);
    },
    [router, set, watch],
  );

  const retry = useCallback(
    async (noteId: string) => {
      if (running.current) return;
      try {
        const result = await retryRecognition(noteId);
        if (!result.ok) {
          set({ phase: "failed", message: result.error });
          return;
        }
      } catch {
        set({ phase: "failed", message: LOST });
        return;
      }
      await watch(noteId);
    },
    [set, watch],
  );

  return { state, read, watch, retry };
}

function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Shown while ai& reads the note. Announced once to screen readers; the timer is not. */
export function ReadingInProgress({ startedAt }: { startedAt: number }) {
  const seconds = useElapsedSeconds(startedAt);
  return (
    <div className="app-reading grid gap-3" aria-busy="true">
      <p role="status" className="text-lg font-semibold">
        Reading the handwriting…
      </p>
      <p className="app-hint" aria-hidden="true">
        {formatElapsed(seconds)} so far. This can take up to two minutes. Please keep this page open.
      </p>
      <ul className="app-hint grid gap-1 pl-5 list-disc">
        <li>Fudepan lists the care steps it finds in the note.</li>
        <li>Anything the note does not say, such as which clinic, is marked as missing instead of guessed.</li>
        <li>Nothing is booked, paid, or sent. Your family checks every step next.</li>
      </ul>
    </div>
  );
}

export function ReadingFailed({ message }: { message: string }) {
  return (
    <div role="alert" className="app-alert">
      <p className="app-alert__title">The note could not be read</p>
      <p>{message}</p>
    </div>
  );
}
