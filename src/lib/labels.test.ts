import { describe, expect, it } from "vitest";
import { labelWidth, placeLabels, type LabelBox } from "./labels.js";

const box = (x: number, y: number, rank = 0, w = 40, h = 12): LabelBox => ({ x, y, w, h, rank });

describe("placeLabels", () => {
  it("keeps every label when nothing overlaps", () => {
    expect(placeLabels([box(0, 0), box(100, 0), box(0, 100)])).toEqual([true, true, true]);
  });

  it("drops the lower-ranked of two overlapping labels", () => {
    expect(placeLabels([box(0, 0, 1), box(10, 0, 5)])).toEqual([false, true]);
  });

  it("breaks a rank tie by array order, so the result is stable", () => {
    expect(placeLabels([box(0, 0), box(10, 0)])).toEqual([true, false]);
    // The same boxes reversed keep the one that is now first -- order decides, not position.
    expect(placeLabels([box(10, 0), box(0, 0)])).toEqual([true, false]);
  });

  it("lets a third label through when it clears both kept ones", () => {
    expect(placeLabels([box(0, 0), box(10, 0), box(200, 0)])).toEqual([true, false, true]);
  });

  it("compares against kept labels only, so a dropped one blocks nothing", () => {
    // b overlaps a and is dropped; c overlaps b but not a, so it survives.
    expect(placeLabels([box(0, 0), box(30, 0), box(60, 0)])).toEqual([true, false, true]);
  });

  it("touching edges do not count as overlapping", () => {
    expect(placeLabels([box(0, 0), box(40, 0)])).toEqual([true, true]);
  });

  it("returns an empty array for no boxes", () => {
    expect(placeLabels([])).toEqual([]);
  });
});

describe("labelWidth", () => {
  it("scales with both length and size", () => {
    expect(labelWidth("abcd", 10)).toBeCloseTo(22);
    expect(labelWidth("abcd", 20)).toBeCloseTo(44);
  });

  it("is zero for an empty string", () => {
    expect(labelWidth("", 12)).toBe(0);
  });
});
