import { describe, expect, it } from "vitest";
import { pca2, fit } from "./pca.js";

const v = (...n: number[]) => Float32Array.from(n);

describe("pca2 against a hand-computed case", () => {
  it("puts a straight line on one axis and nothing on the other", () => {
    // Three points along y = x. All variance is on one component, so the second carries none.
    const { points, explained } = pca2([v(-1, -1), v(0, 0), v(1, 1)]);
    expect(explained[0]).toBeCloseTo(1, 5);
    expect(explained[1]).toBeCloseTo(0, 5);
    // Spread survives on the first axis, and the middle point sits between the others.
    const xs = points.map((p) => p.x);
    expect(xs[1]).toBeCloseTo(0, 5);
    expect(Math.sign(xs[0]!)).toBe(-Math.sign(xs[2]!));
    expect(Math.abs(xs[0]!)).toBeCloseTo(Math.sqrt(2), 4);
  });

  it("splits variance evenly for a symmetric square", () => {
    const { explained } = pca2([v(1, 1), v(1, -1), v(-1, 1), v(-1, -1)]);
    expect(explained[0]).toBeCloseTo(0.5, 4);
    expect(explained[1]).toBeCloseTo(0.5, 4);
  });

  it("finds the dominant axis when one direction has more spread", () => {
    const { points, explained } = pca2([v(-10, 0.1), v(0, 0), v(10, -0.1)]);
    expect(explained[0]).toBeGreaterThan(0.99);
    expect(Math.abs(points[0]!.x)).toBeGreaterThan(Math.abs(points[0]!.y));
  });
});

describe("determinism", () => {
  const data = () => [v(3, 1, 4), v(1, 5, 9), v(2, 6, 5), v(3, 5, 8)];

  it("gives identical coordinates on a repeated run", () => {
    // A map that reshuffles between reloads teaches that position is arbitrary.
    expect(pca2(data()).points).toEqual(pca2(data()).points);
  });

  it("does not mirror between runs", () => {
    const a = pca2(data()).points.map((p) => Math.sign(p.x));
    const b = pca2(data()).points.map((p) => Math.sign(p.x));
    expect(a).toEqual(b);
  });
});

describe("edges", () => {
  it("returns nothing for no rows rather than throwing", () => {
    expect(pca2([])).toEqual({ points: [], explained: [0, 0] });
  });
  it("handles identical points without dividing by zero", () => {
    const { points, explained } = pca2([v(2, 2), v(2, 2)]);
    expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(explained).toEqual([0, 0]);
  });
  it("throws on mismatched dimensions instead of reading past the end", () => {
    expect(() => pca2([v(1, 2), v(1, 2, 3)])).toThrow(/same dimension/i);
  });
});

describe("fit", () => {
  it("keeps every point inside the viewport", () => {
    const out = fit([{ x: -5, y: -5 }, { x: 5, y: 5 }, { x: 0, y: 1 }], 400, 300, 20);
    for (const p of out) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(300);
    }
  });

  it("uses one scale for both axes so distances stay comparable", () => {
    // A square must stay square. Independent scaling would stretch it to the viewport.
    const out = fit([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 400, 200);
    const dx = Math.hypot(out[1]!.x - out[0]!.x, out[1]!.y - out[0]!.y);
    const dy = Math.hypot(out[2]!.x - out[0]!.x, out[2]!.y - out[0]!.y);
    expect(dx).toBeCloseTo(dy, 4);
  });

  it("survives every point being identical", () => {
    const out = fit([{ x: 3, y: 3 }, { x: 3, y: 3 }], 200, 200);
    expect(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });
});
