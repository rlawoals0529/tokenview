import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("states the caveats before it has anything to be wrong about", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "tokenview" })).toBeVisible();
  await expect(page.getByText(/nothing uploaded/)).toBeVisible();
  // The honesty panel is not a footnote added once there is a result to qualify.
  await expect(page.getByRole("heading", { name: "Reading this honestly" })).toBeVisible();
});

test("nothing is analysed until you ask for the model", async ({ page }) => {
  await expect(page.getByRole("button", { name: "Load the model" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What it reads" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Where the meaning lands" })).toBeHidden();
  // 23 MB on page open is exactly what the explicit button exists to prevent.
  await expect(page.getByText("~23 MB, fetched once and cached.")).toBeVisible();
});

test("each preset replaces the text with the case it is there to make", async ({ page }) => {
  const input = page.getByRole("textbox", { name: "Text to analyse" });
  const before = await input.inputValue();

  await page.getByRole("button", { name: "rare words shatter" }).click();
  const after = await input.inputValue();

  expect(after).not.toBe(before);
  expect(after.length).toBeGreaterThan(0);
  // A preset is a shortcut, not a submit: it must not start a 23 MB download.
  await expect(page.getByRole("button", { name: "Load the model" })).toBeVisible();
});

test("the palette list is closed until asked for, not merely marked closed", async ({ page }) => {
  const toggle = page.getByRole("button", { name: /^Palette:/ });
  const list = page.locator("#palette-list");

  // `hidden` alone was not enough: a `display: grid` on the class beat the user agent's
  // `[hidden] { display: none }`, because author styles win over the UA sheet whatever the
  // specificity. The page was shipping fifteen visible, tabbable options under a button
  // that said aria-expanded="false".
  await expect(list).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(await page.getByRole("button", { name: "Sakura Lake" }).isVisible()).toBe(false);

  await toggle.click();
  await expect(list).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Sakura Lake" })).toBeVisible();
});

test("each palette option is legible in the palette you are actually looking at", async ({ page }) => {
  await page.getByRole("button", { name: /^Palette:/ }).click();
  const option = page.getByRole("button", { name: "Sakura Lake" });

  // The chip shows another palette's accent; the LABEL must not also be painted in that
  // palette's foreground, which is what putting data-theme on the button did.
  const colours = await option.evaluate((el) => ({
    label: getComputedStyle(el).color,
    root: getComputedStyle(document.documentElement).getPropertyValue("--dim").trim(),
    chip: getComputedStyle(el.querySelector(".palette-chip")!).backgroundColor,
  }));
  const rgb = (hex: string) => {
    const n = hex.replace("#", "");
    return `rgb(${[0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)).join(", ")})`;
  };
  expect(colours.label).toBe(rgb(colours.root));
  // And the chip is still showing the other palette, or the fix traded one bug for another.
  expect(colours.chip).not.toBe(colours.label);
});

test("a model that will not load says so, and says it where you clicked", async ({ page }) => {
  // Fail every fetch to the model host, which is what a blocked network or an offline
  // first visit looks like from inside the page.
  await page.route("https://huggingface.co/**", (route) => route.abort("failed"));
  await page.route("https://cdn-lfs*.huggingface.co/**", (route) => route.abort("failed"));

  await page.getByRole("button", { name: "Load the model" }).click();

  await expect(page.locator(".err")).toBeVisible({ timeout: 60_000 });
  // A failure must not leave the page looking like it worked.
  await expect(page.getByRole("heading", { name: "What it reads" })).toBeHidden();
});
