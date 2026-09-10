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

/** Scale a projection into a viewport, preserving aspect so distances stay comparable. */
export function fit(points: { x: number; y: number }[], w: number, h: number, pad = 28) {
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  // One scale for both axes. Scaling them independently would stretch the space and make
  // two points look closer or further apart than they are.
  const scale = Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY);
  const offX = (w - spanX * scale) / 2;
  const offY = (h - spanY * scale) / 2;
  return points.map((p) => ({
    x: (p.x - minX) * scale + offX,
    y: h - ((p.y - minY) * scale + offY),
  }));
}
