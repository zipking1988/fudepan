import { describe, expect, it, vi } from "vitest";

import type { SweepThrottleStore } from "@/lib/care/recognition-sweep";
import { createHouseholdSweeper } from "./sweep";

const HOUSEHOLD = "d0000000-0000-4000-8000-000000000001";
const escalation = { escalated: 1, expiredRequests: 2 };
const recognition = { restarted: 1, failed: 0, errors: 0 };

/** In-memory throttle with the same compare-and-set rule as the table. */
function memoryThrottle(): SweepThrottleStore {
  let last: Date | undefined;
  return {
    async claim(_id, now, olderThan) {
      if (last && last.getTime() > olderThan.getTime()) return false;
      last = now;
      return true;
    },
  };
}

function setup(overrides: Partial<Parameters<typeof createHouseholdSweeper>[0]> = {}) {
  const escalate = vi.fn(async () => escalation);
  const resume = vi.fn(async () => recognition);
  const log = vi.fn();
  const sweeper = createHouseholdSweeper({
    throttle: memoryThrottle(),
    escalate,
    resume,
    log,
    intervalMinutes: 1,
    ...overrides,
  });
  return { sweeper, escalate, resume, log };
}

const T0 = new Date("2027-01-01T10:00:00Z");

describe("runHouseholdSweep", () => {
  it("runs both steps for the household", async () => {
    const { sweeper, escalate, resume } = setup();
    const result = await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    expect(result).toEqual({ swept: true, escalation, recognition, failedSteps: [] });
    expect(escalate).toHaveBeenCalledWith(HOUSEHOLD, T0);
    expect(resume).toHaveBeenCalledWith(HOUSEHOLD);
  });

  it("sweeps once per minute per household", async () => {
    const { sweeper, escalate, resume } = setup();
    await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    const second = await sweeper.runHouseholdSweep(HOUSEHOLD, { now: new Date(T0.getTime() + 30_000) });
    expect(second).toEqual({ swept: false, escalation: null, recognition: null, failedSteps: [] });
    await sweeper.runHouseholdSweep(HOUSEHOLD, { now: new Date(T0.getTime() + 61_000) });
    expect(escalate).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it("lets only one of several simultaneous opens sweep", async () => {
    const { sweeper, escalate } = setup();
    await Promise.all([1, 2, 3].map(() => sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 })));
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it("skips the throttle when forced", async () => {
    const { sweeper, escalate } = setup();
    await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    const forced = await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0, force: true });
    expect(forced.swept).toBe(true);
    expect(escalate).toHaveBeenCalledTimes(2);
  });

  it("still resumes recognition when escalation fails", async () => {
    const { sweeper, resume } = setup({ escalate: vi.fn().mockRejectedValue(new Error("boom")) });
    const result = await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ escalation: null, recognition, failedSteps: ["escalation"] });
  });

  it("still escalates when recognition resume fails", async () => {
    const { sweeper, escalate } = setup({ resume: vi.fn().mockRejectedValue(new Error("boom")) });
    const result = await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ escalation, recognition: null, failedSteps: ["recognition"] });
  });

  it("never throws when the throttle fails", async () => {
    const { sweeper, escalate } = setup({ throttle: { claim: vi.fn().mockRejectedValue(new Error("down")) } });
    const result = await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    expect(result.swept).toBe(false);
    expect(escalate).not.toHaveBeenCalled();
  });

  it("logs stage and code only, with no message text", async () => {
    const secret = "Mrs Tanaka metformin 12345678 Sakura Clinic";
    const { sweeper, log } = setup({
      escalate: vi.fn().mockRejectedValue(new Error(secret)),
      resume: vi.fn().mockRejectedValue(Object.assign(new Error(secret), { code: "P0001" })),
    });
    await sweeper.runHouseholdSweep(HOUSEHOLD, { now: T0 });
    expect(log).toHaveBeenCalledTimes(2);
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain("Tanaka");
    expect(logged).not.toContain("metformin");
    expect(logged).not.toContain("Sakura");
    expect(log.mock.calls[1][2]).toEqual({ stage: "recognition", code: "P0001", household_id: HOUSEHOLD });
  });
});

describe("runAllHouseholdsSweep", () => {
  it("runs both steps for every household (null) without the throttle", async () => {
    const claim = vi.fn();
    const { sweeper, escalate, resume } = setup({ throttle: { claim } });
    const result = await sweeper.runAllHouseholdsSweep(T0);
    expect(escalate).toHaveBeenCalledWith(null, T0);
    expect(resume).toHaveBeenCalledWith(null);
    expect(claim).not.toHaveBeenCalled();
    expect(result.failedSteps).toEqual([]);
  });

  it("keeps going when one step fails", async () => {
    const { sweeper, resume } = setup({ escalate: vi.fn().mockRejectedValue(new Error("x")) });
    const result = await sweeper.runAllHouseholdsSweep(T0);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(result.failedSteps).toEqual(["escalation"]);
  });
});
