import { describe, expect, it } from "vitest";
import type { ReadingStatus } from "@/app/(app)/care/actions";
import { pollReading } from "./poll-reading";

/** A fake clock: sleeping and waiting for a timeout both move time forward instantly. */
function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const reading: ReadingStatus = { state: "reading" };

describe("pollReading", () => {
  it("returns the chain as soon as the reading is ready", async () => {
    const clock = fakeClock();
    const answers: ReadingStatus[] = [reading, reading, { state: "ready", careChainId: "c1" }];
    let calls = 0;
    const outcome = await pollReading({
      check: async () => answers[calls++],
      isAlive: () => true,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ kind: "ready", careChainId: "c1" });
    expect(calls).toBe(3);
  });

  it("reports a failed reading with its message", async () => {
    const clock = fakeClock();
    const outcome = await pollReading({
      check: async () => ({ state: "failed", message: "Try again." }),
      isAlive: () => true,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ kind: "failed", message: "Try again." });
  });

  // Regression: a status check that never answered kept the page spinning for minutes.
  it("does not hang when a status check never answers", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollReading({
      check: () => {
        calls++;
        return new Promise<ReadingStatus>(() => {}); // never settles
      },
      isAlive: () => true,
      now: clock.now,
      sleep: clock.sleep,
      checkTimeoutMs: 5, // real timer, kept tiny so the test is fast
      deadlineMs: 30_000,
      everyMs: 3_000,
    });
    expect(outcome).toEqual({ kind: "too_long" });
    expect(calls).toBeGreaterThan(1); // it kept trying instead of waiting on the first check
  });

  it("recovers when one check hangs and a later one answers", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollReading({
      check: () => {
        calls++;
        if (calls === 1) return new Promise<ReadingStatus>(() => {});
        return Promise.resolve({ state: "ready", careChainId: "c2" });
      },
      isAlive: () => true,
      now: clock.now,
      sleep: clock.sleep,
      checkTimeoutMs: 5,
    });
    expect(outcome).toEqual({ kind: "ready", careChainId: "c2" });
  });

  it("treats a check that throws as 'try again', not as a failure", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollReading({
      check: async () => {
        calls++;
        if (calls === 1) throw new Error("network");
        return { state: "ready", careChainId: "c3" };
      },
      isAlive: () => true,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ kind: "ready", careChainId: "c3" });
  });

  it("stops at the deadline measured by the clock, however slow the checks are", async () => {
    const clock = fakeClock();
    let calls = 0;
    const outcome = await pollReading({
      check: async () => {
        calls++;
        clock.advance(20_000); // each check is slow but does answer
        return reading;
      },
      isAlive: () => true,
      now: clock.now,
      sleep: clock.sleep,
      deadlineMs: 60_000,
    });
    expect(outcome).toEqual({ kind: "too_long" });
    expect(calls).toBeLessThanOrEqual(3);
  });

  it("stops quietly when the page goes away", async () => {
    const clock = fakeClock();
    let alive = true;
    const outcome = await pollReading({
      check: async () => {
        alive = false;
        return reading;
      },
      isAlive: () => alive,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(outcome).toEqual({ kind: "stopped" });
  });
});
