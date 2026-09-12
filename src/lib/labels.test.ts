import { describe, expect, it } from "vitest";
import { labelBox, labelWidth, placeLabels, type LabelBox } from "./labels.js";

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
    expect(labelWidth("abcd", 20)).toBeCloseTo(labelWidth("abcd", 10) * 2);
    expect(labelWidth("abcdabcd", 10)).toBeCloseTo(labelWidth("abcd", 10) * 2);
  });

  it("errs wide of the widest word the map actually renders", () => {
    // Measured in a browser across the reference corpus: the widest needs 0.639em per
    // character. An estimate under that draws two labels on top of each other and reports
    // the map as clear, which is the failure this number exists to prevent.
    expect(labelWidth("x", 100)).toBeGreaterThanOrEqual(63.9);
  });

  it("is zero for an empty string", () => {
    expect(labelWidth("", 12)).toBe(0);
  });
});

describe("labelBox", () => {
  it("puts the box around the glyphs, not below the baseline", () => {
    // SVG draws text from its baseline, so a box whose top IS the baseline covers the
    // descenders of the line and none of the letters.
    const box = labelBox(10, 100, "word", 10);
    expect(box.y).toBeLessThan(100);
    expect(box.y + box.h).toBeGreaterThan(100);
  });

  it("is taller than its own font size, because a rendered label is", () => {
    // Measured at 1.2x. Taking the height to be the point size is what let two names one
    // line apart pass a collision test they visibly failed.
    expect(labelBox(0, 0, "word", 10).h).toBeGreaterThanOrEqual(12);
  });

  it("carries the rank it is given, so your own point still wins a contested spot", () => {
    expect(labelBox(0, 0, "word", 10, 1).rank).toBe(1);
    expect(labelBox(0, 0, "word", 10).rank).toBe(0);
  });
});

describe("placeLabels with occupied space", () => {
  const box = (x: number, y: number, rank = 0): LabelBox => ({ x, y, w: 40, h: 10, rank });

  it("drops a label that would land under something already drawn", () => {
    // The halo around your own point is not a label, so nothing used to stop a neighbour's
    // name being placed straight under it.
    const keep = placeLabels([box(0, 0)], [box(10, 2)]);
    expect(keep).toEqual([false]);
  });

  it("leaves a label alone when the occupied space is elsewhere", () => {
    expect(placeLabels([box(0, 0)], [box(500, 500)])).toEqual([true]);
  });

  it("behaves exactly as before when nothing is occupied", () => {
    const boxes = [box(0, 0), box(10, 2), box(200, 200)];
    expect(placeLabels(boxes)).toEqual(placeLabels(boxes, []));
    expect(placeLabels(boxes)).toEqual([true, false, true]);
  });
});
