import { test, expect } from "@playwright/test";
import { describeFailures, probeContrast } from "./contrast-probe.js";
import themes from "../src/theme/palettes.json" with { type: "json" };

/**
 * The lane that loads the real model.
 *
 * Nothing here is mocked. A fake tokenizer would still emit chips and a fake embedder would
 * still emit points, so a mocked version of this suite would have passed throughout the
 * period when the browser could not load the model at all.
 */
test.describe("@model", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  const analyse = async (page: import("@playwright/test").Page, text: string) => {
    await page.goto("/");
    await page.getByRole("textbox", { name: "Text to analyse" }).fill(text);
    await page.getByRole("button", { name: "Load the model" }).click();
    // Loading is not analysing; the button becomes Analyse and that is a second, explicit step.
    await expect(page.getByRole("button", { name: "Analyse" })).toBeVisible({ timeout: 280_000 });
    await page.getByRole("button", { name: "Analyse" }).click();
    await expect(page.getByRole("heading", { name: "What it reads" })).toBeVisible({ timeout: 120_000 });
  };

  test("shows a long word broken into the pieces the model actually reads", async ({ page }) => {
    await analyse(page, "rare words like antidisestablishmentarianism shatter into pieces");

    const chips = page.locator(".tok");
    const continuations = page.locator(".tok.cont");

    // The claim under the panel is that ## marks a continuation, so at least one has to be
    // there for the caption to be describing this picture rather than a different one.
    await expect(continuations.first()).toBeVisible();
    expect(await continuations.count()).toBeGreaterThan(3);

    // The headline count is the number of chips drawn, not a separate tally that can drift.
    const shown = Number(await page.locator(".strip .readout").first().locator(".readout-v").innerText());
    expect(shown).toBe(await chips.count());

    // Seven words, and more tokens than words, which is the entire point being taught.
    const words = Number(await page.locator(".strip .readout").nth(2).locator(".readout-v").innerText());
    expect(words).toBe(7);
    expect(shown).toBeGreaterThan(words);
  });

  test("the same text lands in the same place twice", async ({ page }) => {
    const coords = async () => {
      await analyse(page, "a wolf runs through the forest at night");
      await expect(page.locator("svg.map circle").first()).toBeVisible({ timeout: 120_000 });
      return page.locator("svg.map circle").evaluateAll((els) =>
        els.map((e) => `${e.getAttribute("cx")},${e.getAttribute("cy")}`),
      );
    };

    const first = await coords();
    const second = await coords();

    // A map that reshuffles on reload teaches the wrong lesson: it says the positions are
    // arbitrary. PCA is deterministic and the seeds are pinned so that this holds.
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(50);
  });

  test("every point keeps its dot even where a label is dropped", async ({ page }) => {
    await analyse(page, "a wolf runs through the forest at night");
    await expect(page.locator("svg.map circle").first()).toBeVisible({ timeout: 120_000 });

    // Your own point draws a second circle as a halo, so there is one more circle than
    // there are points.
    const points = (await page.locator("svg.map circle").count()) - 1;
    const labels = await page.locator("svg.map text").count();

    // Every point is drawn. Dropping a dot would be dropping data.
    expect(points).toBeGreaterThan(50);

    // And the crowded middle really does give labels up. "fewer than points" is the whole
    // claim, and it has to be strictly fewer: if placement kept everything, this reads as
    // a pass while the map is the unreadable pile the pass was meant to rule out.
    expect(labels).toBeLessThan(points);
    expect(labels).toBeGreaterThan(10);
  });

  test("no two names on the map overlap once they are actually drawn", async ({ page }) => {
    await analyse(page, "a wolf runs through the forest at night");
    await expect(page.locator("svg.map circle").first()).toBeVisible({ timeout: 120_000 });

    // Measured on RENDERED boxes, not on the estimate the placement pass used. That is the
    // whole point: the estimate said the map was clear while five pairs of names sat on top
    // of each other, because it assumed a label is as tall as its font size and 0.55em per
    // character wide. Both were wrong, and only the browser could say so.
    const found = await page.evaluate(() => {
      const svg = document.querySelector("svg.map")!;
      // Axis furniture is excluded; the origin's own "mean" is NOT, because it goes through
      // the same placement pass as every word and has to keep the same promise.
      const isName = (t: Element) => !t.classList.contains("tick") && !t.classList.contains("axis-k");
      const names = [...svg.querySelectorAll("g > text")].filter(isName);
      const halo = [...svg.querySelectorAll("circle")].find((c) => c.getAttribute("r") === "13")!;
      const hits = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const boxes = names.map((t) => ({ text: t.textContent!, r: t.getBoundingClientRect() }));
      const pairs: string[] = [];
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          if (hits(boxes[i]!.r, boxes[j]!.r)) pairs.push(`${boxes[i]!.text}/${boxes[j]!.text}`);
      const hb = halo.getBoundingClientRect();
      return { count: boxes.length, pairs, overHalo: boxes.filter((b) => hits(b.r, hb)).map((b) => b.text) };
    });

    // Enough names to be a real test of crowding, and not so many that everything was kept.
    expect(found.count).toBeGreaterThan(10);
    expect(found.count).toBeLessThan(81);
    expect(found.pairs, found.pairs.join(", ")).toEqual([]);
    // And nothing is tucked under the ring around your own point, where it reads as a smudge.
    expect(found.overHalo, found.overHalo.join(", ")).toEqual([]);
  });

  test("the plot is ruled in component units, not decorated with lines", async ({ page }) => {
    await analyse(page, "a wolf runs through the forest at night");
    await expect(page.locator("svg.map circle").first()).toBeVisible({ timeout: 120_000 });

    // textContent, not innerText: innerText does not exist on an SVG element and comes back
    // undefined, which reads as an empty axis rather than as a broken query.
    const values = async (sel: string) =>
      (await page.locator(sel).allTextContents()).map((t) => Number(t.trim()));
    const xs = await values("svg.map .axis text.tick-x");
    const ys = await values("svg.map .axis text.tick-y");

    expect(xs.length).toBeGreaterThan(2);
    expect(ys.length).toBeGreaterThan(2);
    expect([...xs, ...ys].every(Number.isFinite)).toBe(true);

    // Every gridline sits on a tick that is labelled, or the grid is a texture rather than a
    // scale. Counting both is the cheapest way to catch a grid drawn from its own arithmetic.
    expect(await page.locator("svg.map .grid line").count()).toBe(xs.length + ys.length);

    // Ticks are evenly spaced in VALUE. A scale that is not is a scale that lies about
    // distance, which is the one thing this plot is for.
    for (const axis of [xs, ys]) {
      const gaps = axis.slice(1).map((v, i) => v - axis[i]!);
      for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!, 6);
    }

    // And both axes say what share of the variance they carry, beside the axis itself.
    await expect(page.locator("svg.map text.axis-k").first()).toContainText(/PC1 · \d+\.\d% of variance/);
    await expect(page.locator("svg.map text.axis-k").nth(1)).toContainText(/PC2 · \d+\.\d%/);
  });

  test("the map is re-laid out when the window changes, not stretched", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await analyse(page, "a wolf runs through the forest at night");
    await expect(page.locator("svg.map circle").first()).toBeVisible({ timeout: 120_000 });

    const spread = async () => {
      const xs = await page.locator("svg.map circle").evaluateAll((els) =>
        els.map((e) => Number(e.getAttribute("cx"))),
      );
      return Math.max(...xs) - Math.min(...xs);
    };

    const wide = await spread();
    await page.setViewportSize({ width: 680, height: 900 });
    // The placement is recomputed from the projection, so the dots move. Before this, the
    // pixel positions were frozen at whatever width Analyse was pressed at, and the axes
    // drawn later slid out from under them.
    await expect.poll(spread, { timeout: 5_000 }).toBeLessThan(wide - 40);

    const narrow = await spread();
    const svgWidth = Number(await page.locator("svg.map").getAttribute("width"));
    expect(narrow).toBeLessThanOrEqual(svgWidth);
    expect(narrow).toBeGreaterThan(60);
  });

  test("the analysed page is legible in every palette, plot and all", async ({ page }) => {
    await analyse(page, "a wolf runs through the forest at night");
    await expect(page.locator("svg.map circle").first()).toBeVisible({ timeout: 120_000 });

    // The fast lane measures the page as it opens. This state has a token strip, axis labels,
    // a key and a similarity scale that do not exist there, and they are drawn on --raised and
    // on mixed surfaces rather than on the page - which is where the last failure was hiding.
    const probe = await probeContrast(page, themes);

    expect(probe.styles).toBeGreaterThan(20);
    // Named by class, not by copy: every h2 on the page shares one style, so they dedupe to
    // a single row and asserting on a heading's words checks whichever happens to be first.
    expect(probe.classes).toContain("text.tick tick-x");
    expect(probe.classes).toContain("SPAN.readout-k");
    expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
  });
});
