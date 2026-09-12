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

/* The picker itself is covered by e2e/palette-picker.spec.ts, which is vendored with the
   component, so the same guard runs in every app that uses it rather than in this one. */

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

test("the server under test is this app, not another app on the same port", async ({ page }) => {
  await page.goto("/");
  /*
   * playwright.config.ts reuses a server that is already listening, so a port two projects
   * share means one project's running preview quietly answers the other's tests. That has
   * happened here twice, and once it produced a completely green run against the wrong page.
   * Ports are unique now; this is what catches the next way it goes wrong.
   */
  await expect(page).toHaveTitle(/^tokenview/);
});
