/**
 * Which labels can be drawn without colliding.
 *
 * A scatter of eighty words has crowded regions where every label overlaps its neighbours, and
 * overlapping text is worse than no text: it is unreadable and it hides the dots underneath.
 * This is the standard greedy placement pass. Take labels in priority order and keep one only
 * if its box is clear of every box already kept. The dot is always drawn; only its label is
 * dropped, so nothing disappears from the map, it just stops shouting over its neighbour.
 */

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Higher wins a contested spot. Ties break by array order, so the result is stable. */
  rank: number;
}

/**
 * Width of a label, estimated rather than measured.
 *
 * Measuring means a DOM round trip per word per render. The map only needs to know whether two
 * boxes overlap, so an estimate is enough -- but only if it errs WIDE, because an estimate that
 * runs narrow draws two labels on top of each other and reports no collision.
 *
 * 0.64 rather than a rounder number because it was measured: across the corpus as rendered, the
 * widest word needs 0.639em per character and the median needs 0.526. At the 0.55 this used to
 * assume, five pairs of labels overlapped on screen while the placement pass called the map
 * clear.
 */
export function labelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * WIDTH_PER_CHAR;
}

const WIDTH_PER_CHAR = 0.64;

/** How far a rendered label rises above its own baseline, as a multiple of the font size. */
const ASCENT = 0.95;

/** And its full height. Measured the same way: the tallest box is 1.2x its font size. */
const LINE = 1.2;

/**
 * The box a label occupies, from the baseline position it is drawn at.
 *
 * SVG places text by its baseline; collision needs the rectangle around the glyphs. Keeping
 * the conversion here means the caller cannot get half of it right, which is what happened
 * when the height was taken to be the font size: a label is taller than its own point size,
 * so two names a line apart passed a test they visibly failed.
 */
export function labelBox(x: number, baseline: number, text: string, fontSize: number, rank = 0): LabelBox {
  return {
    x,
    y: baseline - fontSize * ASCENT,
    w: labelWidth(text, fontSize),
    h: fontSize * LINE,
    rank,
  };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * One boolean per input box, in the input's own order: true where the label is drawable.
 *
 * `blocked` is space that is already spoken for by something that is not a label - the halo
 * around your own point, in practice. Without it a neighbour's name is placed into a clear
 * patch of label space that is not clear at all, and comes out half-hidden under a filled
 * circle: legible to the collision test, unreadable on the screen.
 */
export function placeLabels(boxes: LabelBox[], blocked: LabelBox[] = []): boolean[] {
  const order = boxes
    .map((box, at) => ({ box, at }))
    .sort((a, b) => b.box.rank - a.box.rank || a.at - b.at);
  const keep = new Array<boolean>(boxes.length).fill(false);
  const placed: LabelBox[] = [...blocked];
  for (const { box, at } of order) {
    if (placed.some((other) => overlaps(box, other))) continue;
    keep[at] = true;
    placed.push(box);
  }
  return keep;
}
