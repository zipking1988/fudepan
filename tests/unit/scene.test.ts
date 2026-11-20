import { describe, expect, it } from "vitest";
import {
  PHASE,
  STEP_AT,
  chipWindow,
  filledCount,
  interpolate,
  isWide,
  readCount,
  sceneKeys,
  sceneStep,
  toStage,
  type CardPose,
  type NotePose,
  type Size,
} from "@/lib/demo/scene";

const YS = [0.2, 0.35, 0.5, 0.65, 0.8];
const grid = (n = 200) => Array.from({ length: n + 1 }, (_, i) => i / n);

const box = (pose: { x: number; y: number; s: number }, size: Size) => ({
  left: pose.x - (size.w * pose.s) / 2,
  right: pose.x + (size.w * pose.s) / 2,
  top: pose.y - (size.h * pose.s) / 2,
  bottom: pose.y + (size.h * pose.s) / 2,
});
const last = <T>(stops: { v: T }[]) => stops[stops.length - 1]!.v;

describe("scene timeline", () => {
  it("moves through the steps in order", () => {
    expect(sceneStep(0)).toBe(0);
    expect(sceneStep(0.1)).toBe(1);
    expect(sceneStep(0.3)).toBe(2);
    expect(sceneStep(0.6)).toBe(3);
    expect(sceneStep(0.95)).toBe(4);
    expect(sceneStep(1)).toBe(4);
    let prev = 0;
    for (const p of grid()) {
      const s = sceneStep(p);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("treats bad input as the start", () => {
    expect(sceneStep(Number.NaN)).toBe(0);
    expect(sceneStep(-1)).toBe(0);
    expect(sceneStep(5)).toBe(4);
  });

  it("each step button lands on its own step", () => {
    for (const n of [1, 2, 3, 4] as const) expect(sceneStep(STEP_AT[n])).toBe(n);
  });

  it("reads phrases top to bottom and never un-reads them", () => {
    expect(readCount(0, YS)).toBe(0);
    expect(readCount(PHASE.scan[0], YS)).toBe(0);
    expect(readCount(PHASE.scan[1], YS)).toBe(YS.length);
    expect(readCount(1, YS)).toBe(YS.length);
    let prev = 0;
    for (const p of grid()) {
      const n = readCount(p, YS);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it("flies every phrase inside the fly phase, in order", () => {
    const n = 5;
    let prevStart = -1;
    for (let i = 0; i < n; i++) {
      const [a, b] = chipWindow(i, n);
      expect(a).toBeGreaterThanOrEqual(PHASE.fly[0]);
      expect(b).toBeLessThanOrEqual(PHASE.fly[1] + 1e-9);
      expect(a).toBeGreaterThan(prevStart);
      prevStart = a;
    }
  });

  it("fills fields only after reading, and all of them by the review", () => {
    expect(filledCount(PHASE.split[1], 5)).toBe(0);
    expect(filledCount(PHASE.review, 5)).toBe(5);
    let prev = 0;
    for (const p of grid()) {
      const n = filledCount(p, 5);
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it("interpolates between stops and holds the end values", () => {
    const stops = [
      { p: 0, v: { a: 0 } },
      { p: 0.5, v: { a: 10 } },
      { p: 1, v: { a: 10 } },
    ];
    expect(interpolate(stops, 0).a).toBe(0);
    expect(interpolate(stops, 0.25).a).toBeCloseTo(5);
    expect(interpolate(stops, 0.5).a).toBe(10);
    expect(interpolate(stops, 1).a).toBe(10);
    expect(interpolate(stops, 2).a).toBe(10);
    expect(() => interpolate([], 0.5)).toThrow();
  });
});

describe("scene layout", () => {
  const note: Size = { w: 450, h: 417 };

  const cases = [
    { name: "hero, laptop", W: 1440, H: 900, card: { w: 558, h: 740 }, variant: "hero" as const },
    {
      name: "hero, small laptop",
      W: 1280,
      H: 720,
      card: { w: 558, h: 740 },
      variant: "hero" as const,
    },
    { name: "hero, phone", W: 390, H: 844, card: { w: 367, h: 690 }, variant: "hero" as const },
    { name: "example, laptop", W: 1224, H: 700, card: { w: 558, h: 740 }, variant: "box" as const },
    { name: "example, phone", W: 390, H: 660, card: { w: 367, h: 690 }, variant: "box" as const },
  ];

  for (const c of cases) {
    it(`${c.name}: note and card stay on stage and never overlap at the end`, () => {
      const keys = sceneKeys(c.W, c.H, note, c.card, c.variant, { copyBottom: c.H * 0.55 });
      expect(keys.wide).toBe(isWide(c.W, c.H));

      const framed = keys.note.find((s) => s.p === PHASE.aimEnd)!.v as NotePose;
      const f = box(framed, note);
      expect(f.left).toBeGreaterThanOrEqual(0);
      expect(f.right).toBeLessThanOrEqual(c.W);
      expect(f.top).toBeGreaterThanOrEqual(0);
      expect(f.bottom).toBeLessThanOrEqual(c.H);
      expect(framed.rx).toBe(0);

      const n = box(last(keys.note) as NotePose, note);
      const cardPose = last(keys.card) as CardPose;
      const k = box(cardPose, c.card);
      expect(cardPose.o).toBe(1);
      for (const b of [n, k]) {
        expect(b.left).toBeGreaterThanOrEqual(-0.5);
        expect(b.right).toBeLessThanOrEqual(c.W + 0.5);
        expect(b.top).toBeGreaterThanOrEqual(-0.5);
        expect(b.bottom).toBeLessThanOrEqual(c.H + 0.5);
      }
      if (keys.wide) expect(n.right).toBeLessThan(k.left);
      else expect(n.bottom).toBeLessThan(k.top);
    });
  }

  it("starts the hero note tilted, below the headline", () => {
    const copyBottom = 520;
    const keys = sceneKeys(1440, 900, note, { w: 558, h: 740 }, "hero", { copyBottom });
    const start = keys.note[0]!.v;
    expect(start.rx).toBeGreaterThan(0);
    expect(start.y).toBeGreaterThan(copyBottom);
  });

  it("hides the card until the note moves aside", () => {
    const keys = sceneKeys(1440, 900, note, { w: 558, h: 740 }, "hero");
    expect(interpolate(keys.card, 0).o).toBe(0);
    expect(interpolate(keys.card, PHASE.split[0]).o).toBe(0);
    expect(interpolate(keys.card, 1).o).toBe(1);
  });

  it("maps a point on a flat element to the stage", () => {
    const pose = { x: 500, y: 300, s: 0.5 };
    expect(toStage(pose, note, { x: note.w / 2, y: note.h / 2 })).toEqual({ x: 500, y: 300 });
    expect(toStage(pose, note, { x: 0, y: 0 })).toEqual({
      x: 500 - note.w / 4,
      y: 300 - note.h / 4,
    });
  });
});
