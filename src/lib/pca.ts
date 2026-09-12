/**
 * Two-component PCA, deterministic by construction.
 *
 * Determinism is the whole requirement here. A map that reshuffles between reloads teaches
 * the reader that the positions are arbitrary, which is the opposite of the lesson. So:
 * the power iteration starts from a fixed vector rather than a random one, and each
 * component's sign is pinned by a rule instead of left to whichever way it converged.
 */

export interface Projection {
  points: { x: number; y: number }[];
  /** Share of total variance each axis carries. Worth showing: it is often surprisingly low. */
  explained: [number, number];
}

function mean(rows: Float32Array[]): Float32Array {
  const dim = rows[0]?.length ?? 0;
  const out = new Float32Array(dim);
  for (const r of rows) for (let i = 0; i < dim; i++) out[i]! += r[i]!;
  for (let i = 0; i < dim; i++) out[i]! /= rows.length;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

function normalise(v: Float32Array): Float32Array {
  const n = Math.sqrt(dot(v, v));
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i]! /= n;
  return v;
}

/**
 * Fix the sign so the same data always yields the same picture.
 *
 * An eigenvector and its negation are equally valid, and power iteration picks whichever
 * the start vector leaned toward. Without this the map mirrors at random.
 */
function pinSign(v: Float32Array): Float32Array {
  let biggest = 0;
  for (let i = 1; i < v.length; i++) if (Math.abs(v[i]!) > Math.abs(v[biggest]!)) biggest = i;
  if (v[biggest]! < 0) for (let i = 0; i < v.length; i++) v[i]! = -v[i]!;
  return v;
}

/**
 * Leading eigenvector of the covariance, by power iteration.
 *
 * The covariance is never materialised: for centred rows X, `Cv` is `(1/n) Xᵀ(Xv)`, which
 * is two passes instead of a 384×384 matrix.
 */
function leading(centred: Float32Array[], exclude: Float32Array[], seed = 0, iterations = 128): Float32Array | null {
  const dim = centred[0]?.length ?? 0;
  // Fixed and non-uniform, so runs are identical; uniform is a bad start because it is
  // orthogonal to some components. Each component gets its OWN seed: reusing one means that
  // when the first converges to the seed, the second deflates to nothing and looks
  // degenerate on data that is merely isotropic.
  const v = new Float32Array(dim);
  for (let i = 0; i < dim; i++) v[i] = Math.sin(i + 1 + seed * 1.7);
  normalise(v);
  // Start orthogonal to what is already taken, so the first iteration is not wasted.
  for (const e of exclude) {
    const p = dot(v, e);
    for (let i = 0; i < dim; i++) v[i]! -= p * e[i]!;
  }
  if (Math.sqrt(dot(v, v)) < 1e-6) return null;
  normalise(v);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Float32Array(dim);
    for (const row of centred) {
      const p = dot(row, v);
      for (let i = 0; i < dim; i++) next[i]! += p * row[i]!;
    }
    for (let i = 0; i < dim; i++) next[i]! /= centred.length;

    const before = Math.sqrt(dot(next, next));

    // Deflate against components already found, so this converges to the next one.
    for (const e of exclude) {
      const p = dot(next, e);
      for (let i = 0; i < dim; i++) next[i]! -= p * e[i]!;
    }

    // When the residual is only float noise there is no further component to find, and
    // normalising here would amplify that noise into a confident-looking direction lining
    // up with one already taken. The threshold is RELATIVE: Float32 carries about seven
    // significant digits, so an absolute cutoff sits below the noise floor and never fires.
    const len = Math.sqrt(dot(next, next));
    if (!Number.isFinite(len) || len <= before * 1e-5 || len === 0) return null;

    normalise(next);
    v.set(next);
  }
  return pinSign(v);
}

/** Project rows onto their first two principal components. */
export function pca2(rows: Float32Array[]): Projection {
  if (rows.length === 0) return { points: [], explained: [0, 0] };
  const dim = rows[0]!.length;
  if (rows.some((r) => r.length !== dim)) throw new Error("All rows must have the same dimension");

  const mu = mean(rows);
  const centred = rows.map((r) => {
    const c = new Float32Array(dim);
    for (let i = 0; i < dim; i++) c[i] = r[i]! - mu[i]!;
    return c;
  });

  const totalVar = centred.reduce((s, r) => s + dot(r, r), 0) / rows.length;

  const pc1 = leading(centred, []);
  const pc2 = pc1 ? leading(centred, [pc1], 1) : null;

  // A missing component means a flat dataset, so that axis is genuinely zero rather than
  // an arbitrary direction with a plausible-looking spread.
  const xs = pc1 ? centred.map((r) => dot(r, pc1)) : centred.map(() => 0);
  const ys = pc2 ? centred.map((r) => dot(r, pc2)) : centred.map(() => 0);

  const varOf = (a: number[]) => a.reduce((s, v) => s + v * v, 0) / a.length;
  const explained: [number, number] =
    totalVar > 0 ? [varOf(xs) / totalVar, varOf(ys) / totalVar] : [0, 0];

  return { points: xs.map((x, i) => ({ x, y: ys[i]! })), explained };
}

/**
 * A projection placed in a viewport, and the mapping that placed it.
 *
 * The mapping is returned rather than thrown away because the plot is drawn with axes: a
 * gridline at PC1 = -0.2 needs the same transform the dots went through, and recomputing it
 * beside the caller is how a gridline ends up half a pixel out from the data it rules.
 */
export interface Fitted {
  points: { x: number; y: number }[];
  /** Pixels per unit of component space. One number, because both axes share a scale. */
  scale: number;
  /** Component value to pixel, per axis. The y axis is flipped; these hide that. */
  px: (v: number) => number;
  py: (v: number) => number;
  /** The component-space interval each pixel axis spans, low end first. */
  domain: { x: [number, number]; y: [number, number] };
}

/** Scale a projection into a viewport, preserving aspect so distances stay comparable. */
export function fit(points: { x: number; y: number }[], w: number, h: number, pad = 28): Fitted {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = points.length ? Math.min(...xs) : 0, maxX = points.length ? Math.max(...xs) : 0;
  const minY = points.length ? Math.min(...ys) : 0, maxY = points.length ? Math.max(...ys) : 0;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  // One scale for both axes. Scaling them independently would stretch the space and make
  // two points look closer or further apart than they are.
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  const px = (v: number) => (v - minX) * scale + offX;
  const py = (v: number) => h - ((v - minY) * scale + offY);
  // Inverses of px and py at the two pixel edges, so a caller asking "what value is at the
  // left of the plot" gets the answer from the same constants the dots used.
  const vx = (p: number) => (p - offX) / scale + minX;
  const vy = (p: number) => (h - p - offY) / scale + minY;
  return {
    points: points.map((p) => ({ x: px(p.x), y: py(p.y) })),
    scale,
    px,
    py,
    domain: { x: [vx(0), vx(w)], y: [vy(h), vy(0)] },
  };
}

/**
 * Round values to rule an axis with, covering [min, max].
 *
 * Steps come from 1, 2 or 5 times a power of ten, which is the set people read without
 * doing arithmetic: an axis ruled every 0.037 is technically evenly spaced and nobody can
 * use it. `count` is a target, not a promise - snapping the step to a round number is the
 * whole point, and that necessarily changes how many fit.
 */
export function ticks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 1) return [];
  if (min > max) [min, max] = [max, min];
  // A degenerate range has one value in it, and that value is the only honest tick.
  if (max - min < 1e-12) return [min];
  const raw = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  /*
   * The NEAREST round step, not the smallest one that is big enough.
   *
   * Always rounding up overshoots by as much as 2.5x, and on a short axis that is the
   * difference between five gridlines and two: the vertical axis of this plot is the short
   * one, and it came out ruled twice. The thresholds are the geometric midpoints between
   * 1, 2, 5 and 10, so each candidate wins the range it is genuinely closest to in the
   * ratio sense, which is the sense a log scale of magnitudes is measured in.
   */
  const error = raw / magnitude;
  const step =
    magnitude * (error >= Math.sqrt(50) ? 10 : error >= Math.sqrt(10) ? 5 : error >= Math.sqrt(2) ? 2 : 1);
  const out: number[] = [];
  // Multiply rather than accumulate. Repeated addition compounds its own rounding error, so
  // the last tick of a long axis is the one that lands off its gridline.
  for (let i = Math.ceil(min / step); i * step <= max + 1e-12; i++) out.push(i * step);
  return out;
}

/** Decimals needed to tell one tick from the next, so an axis is not ruled 0.0, 0.0, 0.0. */
export function tickDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 0;
  return Math.max(0, Math.ceil(-Math.log10(step)));
}
