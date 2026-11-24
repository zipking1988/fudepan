import { describe, expect, it } from "vitest";
import { leaderboard } from "./leaderboard";
const owner = { id: "m1", name: "Aki Sato" };
const part = (status: string) => ({ progressStatus: status, owner }) as never;
describe("thanks board counting", () => {
  it("leaves the board empty while tasks are only claimed", () => {
    expect(leaderboard({ state: "ready", done: false, parts: [part("claimed"), part("claimed"), part("claimed")] })).toEqual([]);
  });
  it("adds one entry for the first completed task", () => {
    const rows = leaderboard({ state: "ready", done: false, parts: [part("completed"), part("claimed")] });
    expect(rows).toHaveLength(1);
    expect(rows[0].done).toBe(1);
  });
});
