import type { ReadingStatus } from "@/app/(app)/care/actions";

/**
 * Follows a note's reading until it is ready, has failed, or the deadline
 * passes. Each status check gets its own time limit, so one request that never
 * answers (for example a tab left open across a dev-server rebuild) cannot keep
 * the page spinning forever: the overall deadline is measured by the clock, not
 * by how many checks returned.
 */
export const POLL_EVERY_MS = 3_000;
/** One status check normally answers in well under a second. */
export const CHECK_TIMEOUT_MS = 10_000;
/** Reading usually takes under a minute; give it three before saying so plainly. */
export const READING_DEADLINE_MS = 180_000;

export type PollOutcome =
  | { kind: "ready"; careChainId: string }
  | { kind: "failed"; message: string }
  | { kind: "too_long" }
  | { kind: "stopped" };

export type PollDeps = {
  check: () => Promise<ReadingStatus>;
  /** False once the page has gone away. */
  isAlive: () => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  everyMs?: number;
  checkTimeoutMs?: number;
  deadlineMs?: number;
};

const TIMED_OUT = Symbol("timed_out");

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function pollReading(deps: PollDeps): Promise<PollOutcome> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const everyMs = deps.everyMs ?? POLL_EVERY_MS;
  const checkTimeoutMs = deps.checkTimeoutMs ?? CHECK_TIMEOUT_MS;
  const deadline = now() + (deps.deadlineMs ?? READING_DEADLINE_MS);

  while (deps.isAlive()) {
    if (now() >= deadline) return { kind: "too_long" };
    const remaining = Math.max(1, Math.min(checkTimeoutMs, deadline - now()));
    // A check that throws or does not answer in time is retried on the next round.
    const status = await withTimeout(
      deps.check().catch((): typeof TIMED_OUT => TIMED_OUT),
      remaining,
    );
    if (!deps.isAlive()) return { kind: "stopped" };
    if (status !== TIMED_OUT) {
      if (status.state === "ready") return { kind: "ready", careChainId: status.careChainId };
      if (status.state === "failed") return { kind: "failed", message: status.message };
    }
    if (now() >= deadline) return { kind: "too_long" };
    await sleep(Math.min(everyMs, Math.max(0, deadline - now())));
  }
  return { kind: "stopped" };
}
