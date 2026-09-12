import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CORPUS, GROUPS, groupColour } from "./lib/corpus.js";
import { pca2, fit, ticks, tickDecimals } from "./lib/pca.js";
import { labelBox, placeLabels, type LabelBox } from "./lib/labels.js";
import { Ticker, stagger } from "./lib/motion.js";
import type { Token, Progress } from "./lib/model.js";
import { Palette } from "./lib/palette.js";
import palettes from "./theme/palettes.json";

const PRESETS: { label: string; text: string; why: string }[] = [
  { label: "a leading space counts", text: "cat  cat", why: "The same word costs different tokens depending on what precedes it." },
  { label: "rare words shatter", text: "antidisestablishmentarianism", why: "One word, many pieces. Cost is not words." },
  { label: "emoji are expensive", text: "ok 👍🏽 done", why: "A single glyph can be several tokens." },
  { label: "numbers split oddly", text: "1234567 and 2026", why: "Digits are grouped by frequency, not by place value." },
  { label: "case matters", text: "Apple apple APPLE", why: "The tokenizer lowercases here, so watch the ids." },
];

/**
 * Room for the axes, outside the area the points are fitted into.
 *
 * The plot is inset rather than the axes being drawn over the data, because a tick label
 * sitting on top of the scatter is a tick label nobody can read and a dot nobody can see.
 */
const MARGIN = { top: 16, right: 18, bottom: 38, left: 50 };

/** Every tenth token is numbered, so the strip can be counted rather than trusted. */
const ORDINAL_EVERY = 10;

/** Radius of the ring around your own point. Named, because the label pass reserves it too. */
const HALO = 13;

/** Size of the word "mean" beside the origin cross. Set here, and in .map .origin text. */
const ORIGIN_LABEL = 9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How many reference words each group contributes, for the key. */
const GROUP_SIZE = new Map(GROUPS.map((g) => [g, CORPUS.filter((c) => c.group === g).length]));

interface Placed { word: string; group: string; x: number; y: number }

/**
 * One figure with its name and its unit.
 *
 * An instrument labels what it is showing and in what, every time, in the same place. A
 * number floating above a caption is the version that needs the caption.
 */
function Readout({ k, children, unit, note }: { k: string; children: React.ReactNode; unit?: string; note?: string }) {
  return (
    <div className="readout">
      <span className="readout-k">{k}</span>
      <b className="readout-v">
        {children}
        {unit && <i>{unit}</i>}
      </b>
      {note && <span className="readout-n">{note}</span>}
    </div>
  );
}

/**
 * Cosine similarity on its own full scale, from -1 to 1.
 *
 * The full scale, not 0 to 1. The previous bar filled `max(0, value)`, which drew -0.4 and
 * 0.0 identically: a reading of "opposite" and a reading of "unrelated" came out as the
 * same empty track. Zero is marked, so which side of it the needle sits is the first thing
 * you can see.
 */
function Scale({ value }: { value: number }) {
  /** Where a value sits along the rail, 0% at -1 and 100% at 1. */
  const at = (v: number) => ((clamp(v, -1, 1) + 1) / 2) * 100;
  const from = Math.min(at(0), at(value));
  const to = Math.max(at(0), at(value));
  return (
    <div
      className="scale"
      role="img"
      aria-label={`Cosine similarity ${value.toFixed(3)}, on a scale from minus one to one`}
    >
      {/* The rail is inset from the panel edge, because a tick label is centred on its tick
          and the one at -1 would otherwise have its minus sign cut off by the container. */}
      <div className="scale-rail">
        <div className="scale-track" />
        <div className="scale-fill" style={{ left: `${from}%`, width: `${to - from}%` }} />
        {[-1, -0.5, 0, 0.5, 1].map((v) => (
          <span key={v} className={`scale-tick${v === 0 ? " zero" : ""}`} style={{ left: `${at(v)}%` }}>
            <i />
            <em>{v}</em>
          </span>
        ))}
        <span className="scale-needle" style={{ left: `${at(value)}%` }} />
      </div>
    </div>
  );
}

export default function App() {
  const [text, setText] = useState("the quick brown fox jumps over the lazy dog");
  const [compare, setCompare] = useState("a fast auburn fox leaps above a sleepy hound");
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [placed, setPlaced] = useState<Placed[] | null>(null);
  const [explained, setExplained] = useState<[number, number]>([0, 0]);
  const [sim, setSim] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(880);

  /*
   * Measured on the page wrapper, not on the map's own panel.
   *
   * The panel does not exist until there is something to plot, so observing it means the
   * first map is drawn at a guessed width and corrected a frame later. The wrapper is the
   * same content width - the panels are full-bleed inside it - and it is there from the
   * start.
   */
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

        const { points, explained: ev } = pca2(vectors);
        // Kept in COMPONENT space, not pixels. Placing them here would freeze the map at
        // whatever width the window happened to be when Analyse was pressed, and a later
        // resize would move the axes out from under the dots.
        setPlaced(
          points.map((p, i) => ({
            word: i < CORPUS.length ? CORPUS[i]!.word : "your text",
            group: i < CORPUS.length ? CORPUS[i]!.group : "yours",
            x: p.x,
            y: p.y,
          })),
        );
        setExplained(ev);

        setSim(compare.trim() ? m.cosine(mine, await m.embed(compare)) : null);
      }),
    [guard, engine, text, compare],
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

  // Squarer than it is tall on a phone, taller on a desktop, and never taller than the
  // window: a 520px plot on a 360px screen is a column of dots, not a map.
  const mapH = Math.round(clamp(width * 0.62, 300, 520));
  const plotW = Math.max(80, width - MARGIN.left - MARGIN.right);
  const plotH = Math.max(80, mapH - MARGIN.top - MARGIN.bottom);

  const view = useMemo(() => (placed ? fit(placed, plotW, plotH) : null), [placed, plotW, plotH]);

  const axes = useMemo(() => {
    if (!view) return null;
    const x = ticks(view.domain.x[0], view.domain.x[1], 6);
    const y = ticks(view.domain.y[0], view.domain.y[1], 5);
    const step = (t: number[]) => (t.length > 1 ? t[1]! - t[0]! : 0);
    return { x, y, xDp: tickDecimals(step(x)), yDp: tickDecimals(step(y)) };
  }, [view]);

  /**
   * Which words get a name on the map.
   *
   * Your own point always wins, so it is never the one dropped; the rest compete on nothing but
   * order, which keeps the map identical between two runs of the same input.
   */
  /** Whether the corpus mean is inside the plotted range, and so worth marking. */
  const originVisible =
    !!view && view.domain.x[0] < 0 && view.domain.x[1] > 0 && view.domain.y[0] < 0 && view.domain.y[1] > 0;

  const layout = useMemo(() => {
    if (!view || !placed) return { labels: [] as boolean[], mean: false };
    const halos: LabelBox[] = [];
    const boxes = view.points.map((p, i) => {
      const mine = placed[i]!.group === "yours";
      const size = mine ? 12.5 : 9.5;
      // The halo is a ring of radius 13, and a name placed under it is hidden even though no
      // other NAME is there. Reserving it is what stops a neighbour being drawn half behind
      // your own point.
      if (mine) halos.push({ x: p.x - HALO, y: p.y - HALO, w: HALO * 2, h: HALO * 2, rank: 0 });
      // The same x and baseline the <text> below is drawn at, so the box is the label.
      return labelBox(p.x + (mine ? 17 : 7), p.y + 3.5, placed[i]!.word, size, mine ? 1 : 0);
    });
    /*
     * The word "mean" goes through the same pass as every other name, at the lowest rank.
     *
     * It is a marker for a fixed reference, so it loses every contest: the cross is still
     * drawn and the axes still say where zero is, but the four letters give way rather than
     * being painted over what you typed. Special-casing it either buries it under a dot or
     * lets it bury the one label that must never be dropped.
     */
    if (originVisible) boxes.push(labelBox(view.px(0) + 9, view.py(0) - 6, "mean", ORIGIN_LABEL, -1));

    const keep = placeLabels(boxes, halos);
    return { labels: keep, mean: originVisible ? keep[keep.length - 1]! : false };
  }, [view, placed, originVisible]);

  const labels = layout.labels;

  const trust = (explained[0] + explained[1]) * 100;

  return (
    <div className="wrap" ref={box}>
      <h1>
        token<span>view</span>
      </h1>
      <p className="tagline">
        Type a sentence and watch it turn into the pieces a language model actually reads, then
        watch its meaning land on a map beside eighty reference words.
      </p>
      <p className="assurance">
        Runs entirely in your browser · no API key · nothing uploaded · works offline once cached
      </p>

      <section className="panel">
        <label className="field">
          <span className="field-k">Subject</span>
          <input
            type="text"
            className="subject"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Text to analyse"
          />
        </label>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.label} title={p.why} onClick={() => setText(p.text)}>
              {p.label}
            </button>
          ))}
        </div>
        {/* A visible label, not a placeholder. A placeholder is the label until you type,
            and then the field has no label at all. */}
        <label className="field against">
          <span className="field-k">Reference</span>
          <input
            type="text"
            value={compare}
            onChange={(e) => setCompare(e.target.value)}
            aria-label="Compare against"
          />
        </label>
        <div className="row" style={{ marginTop: 22 }}>
          {!ready ? (
            <button className="primary" onClick={start} disabled={!!busy}>
              Load the model
            </button>
          ) : (
            <button className="primary" onClick={analyse} disabled={!!busy}>
              Analyse
            </button>
          )}
          {/* Once the model is in, the button says Analyse and there is nothing left for
              a line of text beside it to add. */}
          {!ready && (
            <span className="note" style={{ margin: 0 }}>
              ~23 MB, fetched once and cached.
            </span>
          )}
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
                className={`tok rise${t.special ? " special" : ""}${t.continuation ? " cont" : ""}`}
                style={stagger(i, 14, 260)}
                title={t.continuation ? "A continuation of the previous word" : t.special ? "Structural token" : t.raw}
              >
                {/* A ruler, not decoration: the strip can be counted to the tenth token
                    without counting chips, and the headline count checked against it. */}
                {(i + 1) % ORDINAL_EVERY === 0 && <span className="ord" aria-hidden="true">{i + 1}</span>}
                <span>
                  {t.continuation && <span className="lead">##</span>}
                  {t.text === " " ? "␠" : t.text}
                </span>
                <span className="id">{t.id}</span>
              </span>
            ))}
          </div>
          <div className="strip">
            <Readout k="Tokens"><Ticker value={counts.tokens} /></Readout>
            <Readout k="Without structural"><Ticker value={counts.real} /></Readout>
            <Readout k="Words"><Ticker value={counts.words} /></Readout>
            <Readout k="Characters"><Ticker value={counts.chars} /></Readout>
            <Readout k="Tokens per word"><Ticker value={counts.perWord} decimals={2} /></Readout>
          </div>
          <p className="note">
            Tokens marked <code>##</code> are continuations: a single word broken into pieces.
            Faded tokens are structural, added by the tokenizer rather than by you.
          </p>
        </section>
      )}

      {view && axes && placed && (
        <section className="panel map-panel">
          <h2>Where the meaning lands</h2>
          <div className="strip trust">
            <Readout k="Variance in view" unit="%" note="of 384 dimensions">
              <Ticker value={trust} decimals={1} />
            </Readout>
            {/* The number alone does not say whether it is a lot. A track that is nearly all
                empty does, at a glance, which is the whole point of printing it. */}
            <div className="meter" role="img" aria-label={`${trust.toFixed(1)} per cent of one hundred`}>
              <i style={{ width: `${clamp(trust, 0, 100)}%` }} />
            </div>
            <div className="readout rule">
              <span className="readout-k">How to read a distance</span>
              <p>
                Close in 384-D <b>⇒</b> close here.
                <br />
                Close here <b>⇏</b> close in 384-D.
              </p>
            </div>
          </div>
          <svg
            className="map"
            width={width}
            height={mapH}
            role="img"
            aria-label={`Eighty reference words and your sentence, projected onto two principal components carrying ${trust.toFixed(1)}% of the variance`}
          >
            <g transform={`translate(${MARGIN.left},${MARGIN.top})`}>
              {/* Grid first, so every dot and every label sits on top of it. */}
              <g className="grid">
                {axes.x.map((t) => (
                  <line key={`gx${t}`} x1={view.px(t)} y1={0} x2={view.px(t)} y2={plotH} />
                ))}
                {axes.y.map((t) => (
                  <line key={`gy${t}`} x1={0} y1={view.py(t)} x2={plotW} y2={view.py(t)} />
                ))}
              </g>


              <g className="axis">
                <line x1={0} y1={plotH} x2={plotW} y2={plotH} />
                <line x1={0} y1={0} x2={0} y2={plotH} />
                {axes.x.map((t) => (
                  <g key={`x${t}`}>
                    <line x1={view.px(t)} y1={plotH} x2={view.px(t)} y2={plotH + 5} />
                    <text className="tick tick-x" x={view.px(t)} y={plotH + 16} textAnchor="middle">
                      {t.toFixed(axes.xDp)}
                    </text>
                  </g>
                ))}
                {axes.y.map((t) => (
                  <g key={`y${t}`}>
                    <line x1={-5} y1={view.py(t)} x2={0} y2={view.py(t)} />
                    <text className="tick tick-y" x={-9} y={view.py(t) + 3} textAnchor="end">
                      {t.toFixed(axes.yDp)}
                    </text>
                  </g>
                ))}
                <text className="axis-k" x={plotW} y={plotH + 31} textAnchor="end">
                  PC1 · {(explained[0] * 100).toFixed(1)}% of variance
                </text>
                <text className="axis-k" x={0} y={0} transform={`translate(${-MARGIN.left + 11},0) rotate(-90)`} textAnchor="end">
                  PC2 · {(explained[1] * 100).toFixed(1)}%
                </text>
              </g>

              {view.points.map((p, i) => {
                const point = placed[i]!;
                const mine = point.group === "yours";
                return (
                  <g key={i}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={mine ? 7 : 3.6}
                      fill={mine ? "var(--fg)" : groupColour(point.group)}
                      opacity={mine ? 1 : 0.85}
                    />
                    {mine && <circle cx={p.x} cy={p.y} r={HALO} fill="none" stroke="var(--fg)" strokeOpacity={0.45} />}
                    {/* A stroke behind the fill keeps a label readable where points still touch;
                        paint-order puts the stroke underneath rather than over the glyphs. The
                        dot is always drawn, so a dropped label loses a name, never a data point. */}
                    {labels[i] && (
                      <text
                        x={p.x + (mine ? 17 : 7)}
                        y={p.y + 3.5}
                        fill={mine ? "var(--fg)" : "var(--dim)"}
                        fontSize={mine ? 12.5 : 9.5}
                        fontWeight={mine ? 600 : 400}
                        stroke="var(--bg)"
                        strokeWidth={mine ? 3.5 : 2.5}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                      >
                        {point.word}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* The corpus mean, drawn LAST. Every coordinate on this plot is a distance
                  from it, so it is the one position that means something on its own - and
                  chrome that a data point can bury is chrome nobody can use. It is a cross
                  and four letters, so it costs almost nothing to put on top. */}
              {originVisible && (
                <g className="origin">
                  <line x1={view.px(0) - 6} y1={view.py(0)} x2={view.px(0) + 6} y2={view.py(0)} />
                  <line x1={view.px(0)} y1={view.py(0) - 6} x2={view.px(0)} y2={view.py(0) + 6} />
                  {layout.mean && (
                    <text
                      x={view.px(0) + 9}
                      y={view.py(0) - 6}
                      stroke="var(--bg)"
                      strokeWidth={2.5}
                      paintOrder="stroke"
                      strokeLinejoin="round"
                    >
                      mean
                    </text>
                  )}
                </g>
              )}
            </g>
          </svg>
          <ul className="key">
            {GROUPS.map((g) => (
              <li key={g}>
                <b style={{ background: groupColour(g) }} />
                <span>{g}</span>
                <em>{GROUP_SIZE.get(g)}</em>
              </li>
            ))}
            <li className="mine">
              <b />
              <span>your text</span>
              <em>1</em>
            </li>
          </ul>
        </section>
      )}

      {sim !== null && (
        <section className="panel">
          <h2>Similarity</h2>
          <div className="strip">
            <Readout k="Cosine" note="between the two sentence embeddings">
              <Ticker value={sim} decimals={3} />
            </Readout>
          </div>
          <Scale value={sim} />
          <p className="note">
            Near 1 means the model places the two sentences in nearly the same spot, whatever
            words they used. Near 0 means it sees no relation; below 0 it reads them as pulling
            in opposite directions.
          </p>
        </section>
      )}

      <section className="panel">
        <h2>Reading this honestly</h2>
        <p className="note" style={{ marginTop: 0 }}>
          The map is a projection. Two points near each other in 384 dimensions will be near each
          other here, but the reverse does not hold: things can be flattened into the same spot by
          the projection alone. The percentage printed above the map tells you how much to
          trust it.
        </p>
        <p className="note">
          The tokenizer shown is this model's. Another model splits text differently, so treat the
          counts as an illustration of how tokenization behaves, not as a bill for a specific API.
        </p>
      </section>
      <Palette themes={palettes} storageKey="tokenview:theme" />
    </div>
  );
}
