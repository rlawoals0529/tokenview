/**
 * The model. Loaded once, on request, and never on page open.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

export const MODEL = "Xenova/all-MiniLM-L6-v2";
export type Progress = { status: string; progress?: number };

let pipe: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Whether WebGPU will actually work, asked of the adapter rather than of the namespace.
 *
 * This has to be settled BEFORE the model is built, not caught afterwards. Transformers.js
 * caches a model by id, so a failed webgpu build poisons that entry and a second call asking
 * for wasm fails with the first call's webgpu error. Probing first means only one pipeline is
 * ever constructed, on a device already known to work.
 */
async function webgpuUsable(): Promise<boolean> {
  if (typeof navigator === "undefined") return false;
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

export function load(onProgress?: (p: Progress) => void): Promise<FeatureExtractionPipeline> {
  if (!pipe) {
    pipe = (async () => {
      const opts = { progress_callback: onProgress as never };
      if (await webgpuUsable()) {
        return await pipeline("feature-extraction", MODEL, { ...opts, device: "webgpu" });
      }
      // The non-GPU device must be NAMED, and which name is valid differs by environment.
      // In a browser transformers.js defaults to webgpu and does not fall back on its own,
      // so omitting this is what produced "no available backend found"; under Node there is
      // no wasm provider at all, so there the library's own default is the right one.
      return await pipeline(
        "feature-extraction",
        MODEL,
        typeof window === "undefined" ? opts : { ...opts, device: "wasm" as const },
      );
    })();
    // Clear a failed load, otherwise the rejected promise stays in the slot and every later
    // attempt fails with the first attempt's error -- a dropped connection would be permanent.
    pipe.catch(() => { pipe = null; });
  }
  return pipe;
}

export interface Token {
  id: number;
  /** As the tokenizer emits it, so a word-piece marker or a space is visible. */
  raw: string;
  /** What it actually stands for in the text. */
  text: string;
  special: boolean;
  /** A continuation of the previous word rather than a new one. */
  continuation: boolean;
}

const SPECIAL = /^\[(CLS|SEP|PAD|MASK|UNK)\]$/;

/** Tokenize, keeping enough detail to show why a count is what it is. */
export async function tokenize(text: string): Promise<Token[]> {
  const p = await load();
  const enc = p.tokenizer(text, { add_special_tokens: true });
  const ids = Array.from(enc.input_ids.data as ArrayLike<bigint | number>, Number);
  return ids.map((id) => {
    const raw = p.tokenizer.decode([id], { skip_special_tokens: false });
    const continuation = raw.startsWith("##");
    return {
      id,
      raw,
      text: continuation ? raw.slice(2) : raw,
      special: SPECIAL.test(raw),
      continuation,
    };
  });
}

/** One normalised sentence embedding. */
export async function embed(text: string): Promise<Float32Array> {
  const p = await load();
  const out = await p(text, { pooling: "mean", normalize: true });
  return Float32Array.from(out.data as Iterable<number>);
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i]! * b[i]!;
  return d;
}
