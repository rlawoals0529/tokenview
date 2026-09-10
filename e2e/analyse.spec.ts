import { test, expect } from "@playwright/test";

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
    const shown = Number(await page.locator(".stat div").first().locator("b").innerText());
    expect(shown).toBe(await chips.count());

    // Seven words, and more tokens than words, which is the entire point being taught.
    const words = Number(await page.locator(".stat div").nth(2).locator("b").innerText());
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
});
