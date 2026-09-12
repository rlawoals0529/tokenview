import { describe, expect, it } from "vitest";
import { pca2, fit, ticks, tickDecimals } from "./pca.js";

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
    for (const p of out.points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(400);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(300);
    }
  });

  it("uses one scale for both axes so distances stay comparable", () => {
    // A square must stay square. Independent scaling would stretch it to the viewport.
    const out = fit([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 400, 200);
    const dx = Math.hypot(out.points[1]!.x - out.points[0]!.x, out.points[1]!.y - out.points[0]!.y);
    const dy = Math.hypot(out.points[2]!.x - out.points[0]!.x, out.points[2]!.y - out.points[0]!.y);
    expect(dx).toBeCloseTo(dy, 4);
  });

  it("survives every point being identical", () => {
    const out = fit([{ x: 3, y: 3 }, { x: 3, y: 3 }], 200, 200);
    expect(out.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
  });

  it("places a gridline exactly where it places a point at the same value", () => {
    // The reason the transform is returned at all. An axis drawn from a second, parallel
    // calculation is an axis that can disagree with its own data, and half a pixel of
    // disagreement is a map whose gridlines lie about where the dots are.
    const pts = [{ x: -0.4, y: -0.2 }, { x: 0.3, y: 0.5 }, { x: 0.1, y: 0 }];
    const out = fit(pts, 400, 300, 20);
    pts.forEach((p, i) => {
      expect(out.px(p.x)).toBeCloseTo(out.points[i]!.x, 10);
      expect(out.py(p.y)).toBeCloseTo(out.points[i]!.y, 10);
    });
  });

  it("reports the value at each pixel edge, y increasing upward", () => {
    const out = fit([{ x: -1, y: -1 }, { x: 1, y: 1 }], 400, 300, 20);
    expect(out.px(out.domain.x[0])).toBeCloseTo(0, 6);
    expect(out.px(out.domain.x[1])).toBeCloseTo(400, 6);
    // Low end of the y domain is the BOTTOM of the plot, because SVG y grows downward and
    // a domain that came back upside down would rule the axis in reverse.
    expect(out.py(out.domain.y[0])).toBeCloseTo(300, 6);
    expect(out.py(out.domain.y[1])).toBeCloseTo(0, 6);
    expect(out.domain.y[0]).toBeLessThan(out.domain.y[1]);
  });

  it("has no points and a usable transform when given nothing", () => {
    const out = fit([], 400, 300);
    expect(out.points).toEqual([]);
    expect(Number.isFinite(out.px(0))).toBe(true);
    expect(Number.isFinite(out.py(0))).toBe(true);
  });
});

describe("ticks", () => {
  it("uses round steps rather than the range divided by a count", () => {
    // 0 to 0.37 over 5 would be 0.074 a step. Nobody reads an axis ruled in 0.074.
    const out = ticks(0, 0.37, 5);
    expect(out.length).toBe(4);
    out.forEach((v, i) => expect(v).toBeCloseTo(i * 0.1, 10));
  });

  it("covers the range and never leaves it", () => {
    for (const [lo, hi] of [[-0.42, 0.31], [12, 4900], [-3, -1], [0, 1]] as const) {
      const out = ticks(lo, hi);
      expect(out.length).toBeGreaterThan(1);
      expect(Math.min(...out)).toBeGreaterThanOrEqual(lo);
      expect(Math.max(...out)).toBeLessThanOrEqual(hi);
    }
  });

  it("spaces every tick equally, including across zero", () => {
    const out = ticks(-0.42, 0.31);
    const gaps = out.slice(1).map((v, i) => v - out[i]!);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 10);
  });

  it("gives one tick for a range with nothing in it, rather than looping forever", () => {
    expect(ticks(5, 5)).toEqual([5]);
    expect(ticks(NaN, 1)).toEqual([]);
    expect(ticks(0, 1, 0)).toEqual([]);
  });

  it("asks for enough decimals to tell one tick from the next", () => {
    expect(tickDecimals(0.1)).toBe(1);
    expect(tickDecimals(0.05)).toBe(2);
    expect(tickDecimals(2)).toBe(0);
    // A step that is not a step cannot ask for a negative number of decimals.
    expect(tickDecimals(0)).toBe(0);
    expect(tickDecimals(NaN)).toBe(0);
  });
});
