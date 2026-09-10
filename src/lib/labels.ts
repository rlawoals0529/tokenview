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
 * boxes overlap, and 0.55em per character is close enough for that on the sans stack in use --
 * erring wide, which drops a borderline label rather than drawing a colliding one.
 */
export function labelWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.55;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** One boolean per input box, in the input's own order: true where the label is drawable. */
export function placeLabels(boxes: LabelBox[]): boolean[] {
  const order = boxes
    .map((box, at) => ({ box, at }))
    .sort((a, b) => b.box.rank - a.box.rank || a.at - b.at);
  const keep = new Array<boolean>(boxes.length).fill(false);
  const placed: LabelBox[] = [];
  for (const { box, at } of order) {
    if (placed.some((other) => overlaps(box, other))) continue;
    keep[at] = true;
    placed.push(box);
  }
  return keep;
}
