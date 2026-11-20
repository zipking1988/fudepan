import { expect, test } from "@playwright/test";

const pages = [
  { path: "/", heading: "Grandma writes it down. The family takes care of it." },
  { path: "/demo", heading: "Example: a medication reminder" },
  { path: "/board", heading: "Household Board" },
  { path: "/settings", heading: "Household Settings" },
  { path: "/tasks/11111111-1111-4111-8111-111111111111", heading: "Task Detail" },
  { path: "/login", heading: "Sign in" },
];

for (const { path, heading } of pages) {
  test(`${path} has landmarks and a heading`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toContainText("never pays");
  });
}

test("primary text is at least 18px", async ({ page }) => {
  await page.goto("/");
  const sizes = await page
    .locator("main p, main li, main label, main button, main a")
    .evaluateAll((els) => els.map((el) => parseFloat(getComputedStyle(el).fontSize)));
  expect(sizes.length).toBeGreaterThan(0);
  expect(Math.min(...sizes)).toBeGreaterThanOrEqual(18);
});

test("signed-out visitors never see a 'coming soon' dead end", async ({ page }) => {
  for (const path of ["/", "/board", "/settings"]) {
    await page.goto(path);
    await expect(page.getByText(/coming soon/i)).toHaveCount(0);
  }
  await page.goto("/board");
  await expect(page.getByRole("main").getByRole("link", { name: "Sign in" })).toBeVisible();
});

test("primary buttons and links are large enough to tap", async ({ page }) => {
  await page.goto("/");
  for (const name of ["Explore the example", "Upload my note"]) {
    const links = page.getByRole("link", { name });
    expect(await links.count()).toBeGreaterThan(0);
    for (const link of await links.all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  }
});

test("keyboard focus is visible", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return el ? getComputedStyle(el).outlineStyle : "none";
  });
  expect(outline).not.toBe("none");
});
