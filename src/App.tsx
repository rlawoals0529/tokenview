import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CORPUS, GROUPS, groupColour } from "./lib/corpus.js";
import { pca2, fit } from "./lib/pca.js";
import type { Token, Progress } from "./lib/model.js";

const PRESETS: { label: string; text: string; why: string }[] = [
  { label: "a leading space counts", text: "cat  cat", why: "The same word costs different tokens depending on what precedes it." },
  { label: "rare words shatter", text: "antidisestablishmentarianism", why: "One word, many pieces. Cost is not words." },
  { label: "emoji are expensive", text: "ok 👍🏽 done", why: "A single glyph can be several tokens." },
  { label: "numbers split oddly", text: "1234567 and 2026", why: "Digits are grouped by frequency, not by place value." },
  { label: "case matters", text: "Apple apple APPLE", why: "The tokenizer lowercases here — watch the ids." },
];

const MAP_H = 520;

interface Point { word: string; group: string; x: number; y: number }

export default function App() {
  const [text, setText] = useState("the quick brown fox jumps over the lazy dog");
  const [compare, setCompare] = useState("a fast auburn fox leaps above a sleepy hound");
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [points, setPoints] = useState<Point[] | null>(null);
  const [explained, setExplained] = useState<[number, number]>([0, 0]);
  const [sim, setSim] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  // Dynamic, so the model runtime is fetched when asked for rather than on page open.
  const engine = useCallback(() => import("./lib/model.js"), []);

  const guard = useCallback(async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, []);

  const start = useCallback(
    () =>
      guard("Loading the model", async () => {
        const m = await engine();
        await m.load(setProgress);
        setReady(true);
      }),
    [guard, engine],
  );

  const analyse = useCallback(
    () =>
      guard("Analysing", async () => {
        const m = await engine();
        setTokens(await m.tokenize(text));

        const vectors: Float32Array[] = [];
        for (const c of CORPUS) vectors.push(await m.embed(c.word));
        const mine = await m.embed(text);
        vectors.push(mine);

        const { points: projected, explained: ev } = pca2(vectors);
        const placed = fit(projected, width, MAP_H);
        setPoints(
          placed.map((p, i) => ({
            word: i < CORPUS.length ? CORPUS[i]!.word : "your text",
            group: i < CORPUS.length ? CORPUS[i]!.group : "yours",
            x: p.x,
            y: p.y,
          })),
        );
        setExplained(ev);

        setSim(compare.trim() ? m.cosine(mine, await m.embed(compare)) : null);
      }),
    [guard, engine, text, compare, width],
  );

  const counts = useMemo(() => {
    if (!tokens) return null;
    const real = tokens.filter((t) => !t.special);
    return {
      tokens: tokens.length,
      real: real.length,
      chars: text.length,
      words: text.trim() ? text.trim().split(/\s+/).length : 0,
      perWord: real.length / Math.max(1, text.trim().split(/\s+/).length),
    };
  }, [tokens, text]);

  return (
    <div className="wrap">
      <h1>
        token<span>view</span>
      </h1>
      <p className="tagline">
        Type a sentence and watch it turn into the pieces a language model actually reads, then
        watch its meaning land on a map beside eighty reference words.
      </p>
      <div className="privacy">
        Runs entirely in your browser · no API key · nothing uploaded · works offline once cached
      </div>

      <section className="panel">
        <h2>Your text</h2>
        <input type="text" value={text} onChange={(e) => setText(e.target.value)} aria-label="Text to analyse" />
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.label} title={p.why} onClick={() => setText(p.text)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <input
            type="text"
            value={compare}
            onChange={(e) => setCompare(e.target.value)}
            aria-label="Compare against"
            placeholder="compare against…"
            style={{ flex: 1, minWidth: 240 }}
          />
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          {!ready ? (
            <button className="primary" onClick={start} disabled={!!busy}>
              Load the model
            </button>
          ) : (
            <button className="primary" onClick={analyse} disabled={!!busy}>
              Analyse
            </button>
          )}
          <span className="note" style={{ margin: 0 }}>
            {ready ? "Model ready." : "~23 MB, fetched once and cached."}
          </span>
        </div>
        {busy && (
          <div style={{ marginTop: 12 }}>
            <p className="note" style={{ marginTop: 0 }}>
              {busy}
              {progress?.status ? ` · ${progress.status}` : ""}
            </p>
            {typeof progress?.progress === "number" && <progress value={progress.progress} max={100} />}
          </div>
        )}
        {error && <p className="err">{error}</p>}
      </section>

      {tokens && counts && (
        <section className="panel">
          <h2>What it reads</h2>
          <div className="toks">
            {tokens.map((t, i) => (
              <span
                key={i}
                className={`tok${t.special ? " special" : ""}${t.continuation ? " cont" : ""}`}
                title={t.continuation ? "A continuation of the previous word" : t.special ? "Structural token" : t.raw}
              >
                <span>
                  {t.continuation && <span className="lead">##</span>}
                  {t.text === " " ? "␠" : t.text}
                </span>
                <span className="id">{t.id}</span>
              </span>
            ))}
          </div>
          <div className="stat">
            <div><b>{counts.tokens}</b><span>tokens</span></div>
            <div><b>{counts.real}</b><span>without structural</span></div>
            <div><b>{counts.words}</b><span>words</span></div>
            <div><b>{counts.chars}</b><span>characters</span></div>
            <div><b>{counts.perWord.toFixed(2)}</b><span>tokens per word</span></div>
          </div>
          <p className="note">
            Pink tokens marked <code>##</code> are continuations — a single word broken into pieces.
            Dashed tokens are structural, added by the tokenizer rather than by you.
          </p>
        </section>
      )}

      {points && (
        <section className="panel" ref={box}>
          <h2>Where the meaning lands</h2>
          <svg className="map" width={width} height={MAP_H} role="img" aria-label="Embedding map">
            {points.map((p, i) => {
              const mine = p.group === "yours";
              return (
                <g key={i}>
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={mine ? 7 : 3.6}
                    fill={mine ? "#fff" : groupColour(p.group)}
                    opacity={mine ? 1 : 0.85}
                  />
                  {mine && <circle cx={p.x} cy={p.y} r={13} fill="none" stroke="#fff" strokeOpacity={0.45} />}
                  {/* A stroke behind the fill keeps a label readable where points crowd.
                      paint-order puts the stroke underneath rather than over the glyphs. */}
                  <text
                    x={p.x + (mine ? 17 : 7)}
                    y={p.y + 3.5}
                    fill={mine ? "#fff" : "#a6a6c0"}
                    fontSize={mine ? 12.5 : 9.5}
                    fontWeight={mine ? 600 : 400}
                    stroke="#0e0e16"
                    strokeWidth={mine ? 3.5 : 2.5}
                    paintOrder="stroke"
                    strokeLinejoin="round"
                  >
                    {p.word}
                  </text>
                </g>
              );
            })}
          </svg>
          <div className="legend">
            {GROUPS.map((g) => (
              <span key={g}>
                <b style={{ background: groupColour(g) }} />
                {g}
              </span>
            ))}
          </div>
          <p className="note">
            384 dimensions squeezed into 2, so these two axes carry{" "}
            <b>{((explained[0] + explained[1]) * 100).toFixed(1)}%</b> of the variance. Most of the
            structure is in the dimensions you cannot see — which is why two words looking close
            here is a hint, not a fact.
          </p>
        </section>
      )}

      {sim !== null && (
        <section className="panel">
          <h2>Compared</h2>
          <div className="bar">
            <i style={{ width: `${Math.max(0, sim) * 100}%` }} />
            <span>
              <b>similarity</b>
              <code>{sim.toFixed(3)}</code>
            </span>
          </div>
          <p className="note">
            Cosine similarity between the two sentence embeddings. Near 1 means the model places
            them in nearly the same spot, whatever words they used.
          </p>
        </section>
      )}

      <section className="panel">
        <h2>Reading this honestly</h2>
        <p className="note" style={{ marginTop: 0 }}>
          The map is a projection. Two points near each other in 384 dimensions will be near each
          other here, but the reverse does not hold: things can be flattened into the same spot by
          the projection alone. The percentage above tells you how much to trust it.
        </p>
        <p className="note">
          The tokenizer shown is this model's. Another model splits text differently, so treat the
          counts as an illustration of how tokenization behaves, not as a bill for a specific API.
        </p>
      </section>
    </div>
  );
}
