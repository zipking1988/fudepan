import { expect, test, type Page } from "@playwright/test";

/** Scrolls the pinned hero to progress `p` (0–1), the way a visitor's scrolling would. */
async function scrollHero(page: Page, p: number) {
  await page.evaluate((pp) => {
    const el = document.querySelector<HTMLElement>(".lp-hero")!;
    const top = el.getBoundingClientRect().top + window.scrollY;
    window.scrollTo(0, top + pp * (el.offsetHeight - window.innerHeight));
  }, p);
}

const scene = (page: Page) => page.locator("[data-scene]").first();
const BLOCKED = /\/api\/|aiand|:54321|googleapis/;

test.describe("landing page", () => {
  test("first screen explains the product and offers both paths", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Grandma writes it down. The family takes care of it.",
      }),
    ).toBeVisible();
    const hero = page.locator(".lp-hero");
    await expect(hero.getByRole("link", { name: "Explore the example" })).toHaveAttribute(
      "href",
      "/demo",
    );
    await expect(hero.getByRole("link", { name: "Upload my note" })).toHaveAttribute(
      "href",
      "/login?next=%2F%23add-note",
    );
    await expect(scene(page)).toHaveAttribute("data-mode", "motion");
    await expect(page.locator(".scene-note")).toBeVisible();
  });

  test("scrolling turns the note into a reviewable draft", async ({ page }) => {
    await page.goto("/");
    await expect(scene(page)).toHaveAttribute("data-mode", "motion");
    await expect(scene(page)).toHaveAttribute("data-step", "0");

    await scrollHero(page, 0.32);
    await expect(scene(page)).toHaveAttribute("data-step", "2");

    await scrollHero(page, 1);
    await expect(scene(page)).toHaveAttribute("data-step", "4");
    await expect(scene(page)).toHaveAttribute("data-read", "5");
    await expect(scene(page)).toHaveAttribute("data-filled", "5");

    const card = page.locator(".scene-card");
    await expect(card).toContainText("Pick up blood pressure medicine");
    await expect(card).toContainText("Sakura Pharmacy");
    await expect(card).toContainText(/Thursday, [A-Z][a-z]{2} \d{1,2}/);
    await expect(card).toContainText("Which Thursday?");
    await expect(card).toContainText("By 5:00 at the latest");
    await expect(card).toContainText("5 AM or 5 PM?");
    await expect(card).toContainText("Assigned to: nobody yet");
    await expect(card).toContainText("High risk");
    await expect(card).toHaveAttribute("data-review", "true");
    // The date only appears next to the reference date it was worked out from.
    await expect(page.locator(".scene-note")).toContainText(
      /Example · written [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}/,
    );
    // Nothing in the card can be acted on.
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect(card.getByRole("link")).toHaveCount(0);

    await scrollHero(page, 0);
    await expect(scene(page)).toHaveAttribute("data-step", "0");
    await expect(scene(page)).toHaveAttribute("data-filled", "0");
  });

  test("the step buttons jump through the story", async ({ page }) => {
    await page.goto("/");
    await expect(scene(page)).toHaveAttribute("data-mode", "motion");
    await scrollHero(page, 0.1);
    const steps = page.getByRole("navigation", { name: "How it works, step by step" });
    await expect(steps).toBeVisible();
    await steps.getByRole("button", { name: "Review", exact: true }).click();
    await expect(scene(page)).toHaveAttribute("data-step", "4");
    await steps.getByRole("button", { name: "Read", exact: true }).click();
    await expect(scene(page)).toHaveAttribute("data-step", "2");
  });

  test("the handwriting is marked as Japanese", async ({ page }) => {
    await page.goto("/");
    for (const sel of [".scene-note", "[data-scam-note]"]) {
      expect(await page.locator(sel).locator('[lang="ja"]').count()).toBeGreaterThan(0);
    }
  });

  test("the scam note is marked, stamped and held, with no way to act on it", async ({ page }) => {
    await page.goto("/");
    const scam = page.locator("[data-scam]");
    await page.locator("[data-scam-note]").scrollIntoViewIfNeeded();
    await expect(scam).toHaveAttribute("data-stage", "5", { timeout: 8000 });
    await expect(page.locator("[data-scam-stamp]")).toHaveAttribute("data-on", "true");
    const card = page.locator("[data-scam-card]");
    await expect(card).toContainText("Possible fake-police scam");
    await expect(card).toContainText("Real police never collect cash cards");
    await expect(card).toContainText("High risk");
    await expect(card.getByRole("button")).toHaveCount(0);

    await scam.getByRole("button", { name: "Replay" }).click();
    await expect(page.locator("[data-scam-stamp]")).toHaveAttribute("data-on", "false");
    await expect(page.locator("[data-scam-stamp]")).toHaveAttribute("data-on", "true", {
      timeout: 8000,
    });
  });

  test("the family steps light up while scrolling", async ({ page }) => {
    await page.goto("/");
    const flow = page.locator(".lp-flow");
    await flow.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const el = document.querySelector(".lp-flow")!;
      window.scrollTo(0, el.getBoundingClientRect().bottom + window.scrollY - 200);
    });
    await expect(flow.locator(".lp-flow-step").last()).toHaveAttribute("data-on", "true");
    await expect(flow).toContainText("Ren, caregiver");
  });

  test("the safety rules sandbox masks numbers and flags scams", async ({ page }) => {
    await page.goto("/");
    const input = page.getByLabel("Your note");
    const result = page.getByTestId("sandbox-result");

    await input.fill("カード番号 4242 4242 4242 4242 で払う");
    await expect(result).toContainText("[MASKED]");
    await expect(result).not.toContainText("4242");
    await expect(result).toContainText("card number");

    await page.getByRole("button", { name: "Try: Fake police call" }).click();
    await expect(result.getByRole("alert")).toContainText("This looks like a scam");
    await expect(result).toContainText("High risk");

    await page.getByRole("button", { name: "Try: Shopping" }).click();
    await expect(result).toContainText("Low risk");
    await expect(result.getByRole("alert")).toHaveCount(0);

    await page.getByRole("button", { name: "Try: Medicine" }).click();
    await expect(result).toContainText("High risk");
  });

  test("every number has a source, and nothing calls a server", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (BLOCKED.test(r.url())) calls.push(r.url());
    });
    await page.goto("/");
    await page.getByLabel("Your note").fill("夜 血圧の薬をのむ");
    await scrollHero(page, 1);
    await page.waitForTimeout(500);

    const items = page.locator("[data-evidence-item]");
    await expect(items).toHaveCount(3);
    for (const item of await items.all()) {
      await expect(item.getByRole("link")).toHaveAttribute("href", /^https:\/\//);
    }
    const stray = await page.evaluate(() => {
      const main = document.querySelector("main")!.cloneNode(true) as HTMLElement;
      main.querySelectorAll("[data-evidence-item]").forEach((el) => el.remove());
      return main.textContent?.match(/\d+\s?%/g) ?? [];
    });
    expect(stray).toEqual([]);
    expect(calls).toEqual([]);
  });

  test("no horizontal scrolling", async ({ page }) => {
    await page.goto("/");
    for (const p of [0, 0.5, 1]) {
      await scrollHero(page, p);
      const { extra, culprits } = await page.evaluate(() => {
        const w = window.innerWidth;
        const culprits = Array.from(document.querySelectorAll("body *"))
          .filter((el) => el.getBoundingClientRect().right > w + 0.5)
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
        return { extra: document.documentElement.scrollWidth - w, culprits };
      });
      expect(extra, `wider than the screen: ${culprits.join(", ")}`).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("landing page without motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("shows the finished example as a still layout", async ({ page }) => {
    await page.goto("/");
    await expect(scene(page)).toHaveAttribute("data-mode", "static");
    await expect(page.locator(".scene-card")).toBeVisible();
    await expect(page.locator(".scene-card")).toContainText("By 5:00 at the latest");
    await expect(page.locator(".lp-steps-static")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "How it works, step by step" })).toHaveCount(
      0,
    );
    await expect(page.locator("[data-scam-stamp]")).toHaveAttribute("data-on", "true");
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => a.playState === "running").length,
    );
    expect(running).toBe(0);
  });
});

test.describe("landing page without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("everything can still be read and no dead controls are shown", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Grandma writes it down.");
    await expect(page.locator(".scene-card")).toBeVisible();
    await expect(page.locator(".scene-card")).toContainText("Assigned to: nobody yet");
    await expect(page.locator(".lp-steps-static")).toBeVisible();
    await expect(page.locator(".lp-step-nav")).toBeHidden();
    await expect(page.locator("[data-scam-card]")).toContainText("Real police never collect");
    await expect(page.locator(".lp-flow-step").first()).toBeVisible();
  });
});

test.describe("example page", () => {
  test("the slider moves through the example with the keyboard", async ({ page }) => {
    await page.goto("/demo");
    const slider = page.getByTestId("demo-scrub");
    await expect(scene(page)).toHaveAttribute("data-mode", "motion");
    await expect(scene(page)).toHaveAttribute("data-step", "4");
    await slider.focus();
    await page.keyboard.press("Home");
    await expect(scene(page)).toHaveAttribute("data-step", "0");
    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowRight");
    await expect(scene(page)).toHaveAttribute("data-step", "1");
    await expect(page.getByTestId("demo-caption")).toContainText("Take a photo of the note");
  });

  test("play runs the whole example and the steps jump", async ({ page }) => {
    await page.goto("/demo");
    await expect(scene(page)).toHaveAttribute("data-mode", "motion");
    await page.getByRole("button", { name: "Play again", exact: true }).click();
    await expect(scene(page)).not.toHaveAttribute("data-step", "4");
    await expect(scene(page)).toHaveAttribute("data-step", "4", { timeout: 12000 });

    const steps = page.getByRole("group", { name: "How it works, step by step" });
    await steps.getByRole("button", { name: "Read", exact: true }).click();
    await expect(scene(page)).toHaveAttribute("data-step", "2");
    await steps.getByRole("button", { name: "Draft", exact: true }).click();
    await expect(scene(page)).toHaveAttribute("data-step", "3");
  });

  test("the review form saves nothing and assigns nobody", async ({ page }) => {
    const calls: string[] = [];
    page.on("request", (r) => {
      if (BLOCKED.test(r.url())) calls.push(r.url());
    });
    await page.goto("/demo");
    await expect(page.locator('select[id$="-assignee"]')).toHaveValue("");
    await expect(page.getByRole("button", { name: /approve/i })).toHaveCount(0);
    await page.getByRole("button", { name: "Save draft (example)" }).click();
    await expect(page.getByText("nothing was saved")).toBeVisible();
    expect(calls).toEqual([]);
  });

  test("without motion the example is a still layout", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.goto("/demo");
    await expect(scene(page)).toHaveAttribute("data-mode", "static");
    await expect(page.getByTestId("demo-scrub")).toHaveCount(0);
    await expect(page.locator(".scene-card")).toContainText("By 5:00 at the latest");
    await ctx.close();
  });
});
