import { test, expect } from "@playwright/test";
import { describeFailures, probeContrast } from "./contrast-probe.js";
import themes from "../src/theme/palettes.json" with { type: "json" };

/**
 * Every palette has to be readable, not just the one that ships as the default.
 *
 * The picker offers fifteen, so fifteen are on the page as far as a reader is concerned, and
 * a palette nobody uses is exactly the one that rots. This measures real computed colours in
 * a real browser rather than the token files, because what fails is never the token on its
 * own: it is a --dim that passes on --bg sitting on a chip painted --raised.
 *
 * The paired check lives in yozora (scripts/check-contrast.mjs) and measures the tokens. This
 * one measures where they land. Neither subsumes the other.
 */
test("no text on the page is below AA contrast, in any palette", async ({ page }) => {
  await page.goto("/");
  // Open the picker, so its own fifteen options are measured too. They paint a chip in
  // another palette, which is the exact shape of mistake that puts foreign colours on a page.
  await page.getByRole("button", { name: /^Palette:/ }).click();

  const probe = await probeContrast(page, themes);

  // A selector that stopped matching would make this pass by measuring nothing.
  expect(probe.styles).toBeGreaterThan(9);
  expect(probe.measured).toBeGreaterThan(140);
  expect(probe.samples.some((t) => t.startsWith("Runs entirely in your browser"))).toBe(true);

  // The sweep has to have actually swept. Fewer distinct paintings than palettes means some
  // of them never applied, and those numbers are another palette measured twice.
  expect(probe.distinctPalettes, "some palettes painted nothing of their own").toBe(themes.length);
  expect(probe.failures, describeFailures(probe.failures)).toEqual([]);
});
