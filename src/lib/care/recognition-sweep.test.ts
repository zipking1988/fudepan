import { describe, expect, it, vi } from "vitest";
import {
  createRecognitionSweeper,
  createSupabaseSweepThrottle,
  type SweepThrottleStore,
} from "./recognition-sweep";

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const summary = { restarted: 1, failed: 0, errors: 0 };

/** In-memory throttle with the same compare-and-set rule as the table. */
function memoryThrottle(initial?: Date): SweepThrottleStore & { last?: Date } {
  const store: SweepThrottleStore & { last?: Date } = {
    last: initial,
    async claim(_id, now, olderThan) {
      if (store.last && store.last.getTime() > olderThan.getTime()) return false;
      store.last = now;
      return true;
    },
  };
  return store;
}

function sweeper(throttle: SweepThrottleStore, clock: { t: number }, resume = vi.fn(async () => summary)) {
  return {
    resume,
    run: createRecognitionSweeper({
      throttle,
      resume,
      log: vi.fn(),
      now: () => new Date(clock.t),
      intervalMinutes: 5,
    }),
  };
}

describe("maybeSweepRecognition throttling", () => {
  it("sweeps once, skips within the interval, and sweeps again after it", async () => {
    const clock = { t: Date.parse("2027-01-01T10:00:00Z") };
    const { run, resume } = sweeper(memoryThrottle(), clock);

    expect(await run(HOUSEHOLD)).toEqual({ swept: true, summary });
    clock.t += 4 * 60_000;
    expect(await run(HOUSEHOLD)).toEqual({ swept: false, reason: "throttled" });
    clock.t += 61_000;
    expect(await run(HOUSEHOLD)).toMatchObject({ swept: true });
    expect(resume).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledWith(HOUSEHOLD);
  });

  it("lets only one of several simultaneous opens sweep", async () => {
    const clock = { t: Date.parse("2027-01-01T10:00:00Z") };
    const { run, resume } = sweeper(memoryThrottle(), clock);
    await Promise.all([run(HOUSEHOLD), run(HOUSEHOLD), run(HOUSEHOLD)]);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it("never throws when the throttle or the resume fails", async () => {
    const clock = { t: 0 };
    const broken = { claim: vi.fn().mockRejectedValue(new Error("boom")) };
    expect(await sweeper(broken, clock).run(HOUSEHOLD)).toEqual({ swept: false, reason: "error" });
    const failing = sweeper(memoryThrottle(), clock, vi.fn().mockRejectedValue(new Error("x")));
    expect(await failing.run(HOUSEHOLD)).toEqual({ swept: false, reason: "error" });
  });
});

describe("createSupabaseSweepThrottle", () => {
  it("treats a unique-violation on insert as lost the turn", async () => {
    const admin = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        insert: async () => ({ error: { code: "23505" } }),
      }),
    };
    const store = createSupabaseSweepThrottle(admin as never);
    expect(await store.claim(HOUSEHOLD, new Date(), new Date(0))).toBe(false);
  });
});
