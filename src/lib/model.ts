/**
 * The model. Loaded once, on request, and never on page open.
 */
import { pipeline, env, type FeatureExtractionPipeline } from "@huggingface/transformers";

env.allowLocalModels = false;

export const MODEL = "Xenova/all-MiniLM-L6-v2";
export type Progress = { status: string; progress?: number };

let pipe: Promise<FeatureExtractionPipeline> | null = null;

export function load(onProgress?: (p: Progress) => void): Promise<FeatureExtractionPipeline> {
  if (!pipe) {
    pipe = (async () => {
      // Name a device only when asking for WebGPU: the right fallback differs by
      // environment ("wasm" in a browser, "cpu" under Node), so naming one breaks the other.
      const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
      const opts = { progress_callback: onProgress as never };
      if (!hasWebGPU) return await pipeline("feature-extraction", MODEL, opts);
      try {
        return await pipeline("feature-extraction", MODEL, { ...opts, device: "webgpu" });
      } catch (e) {
        console.warn("[tokenview] WebGPU failed, using the default backend:", e);
        return await pipeline("feature-extraction", MODEL, opts);
      }
    })();
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
