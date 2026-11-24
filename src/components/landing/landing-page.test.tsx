import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// next/font only works inside a Next build; the class names do not matter here.
vi.mock("./landing-fonts", () => ({ landingFontClasses: "" }));

import { COPY } from "./content";
import { Landing } from "./landing";

const render = (lang: "ja" | "en") => renderToStaticMarkup(<Landing lang={lang} />);
const repo = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/** Text as React writes it into HTML. */
function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

describe("landing navigation", () => {
  it("keeps English visitors on the English interactive example", () => {
    const html = render("en");
    expect(html).not.toMatch(/href="\/demo"/);
    expect(html).not.toContain("Try the full demo");
    expect(html).toMatch(/<a href="\/en#example">Demo<\/a>/);
    expect(html).toMatch(/<a href="#example" class="lp-btn lp-btn--navy lp-btn--large">Try the quick demo/);
  });

  it("keeps the full /demo on the Japanese landing", () => {
    const html = render("ja");
    expect(html).toMatch(/<a href="#example" class="lp-btn lp-btn--navy lp-btn--large">かんたんデモを試す/);
    expect(html).toMatch(/<a class="lp-btn lp-btn--ember lp-btn--large" href="\/demo">家族それぞれの視点で試す/);
    expect(html).toMatch(/<a href="\/demo">デモ<\/a>/);
    expect(() => repo("src/app/demo/page.tsx")).not.toThrow();
  });

  it.each(["ja", "en"] as const)("%s: puts the real capture link outside the example, saying it needs a login", (lang) => {
    const html = render(lang);
    const { actual } = COPY[lang].example;
    const app = html.slice(html.indexOf('class="lp-app"'), html.indexOf('class="lp-example__cta"'));
    expect(app).not.toContain("/family/capture");
    const cta = html.slice(html.indexOf('class="lp-example__cta"'));
    expect(cta).toMatch(new RegExp(`href="/family/capture">.*${esc(actual.link).replace(/[()]/g, "\\$&")}</a>`));
  });
});

describe("hero", () => {
  it("keeps the headline and says what Fudepan does with the note", () => {
    const ja = render("ja");
    expect(ja).toContain("おばあちゃんのこと、");
    expect(ja).toContain("伝言ゲーム");
    expect(ja).toContain("手書きのメモを撮ると、Fudepanがやることをリストに。家族で分担できます。");
    expect(render("en")).toContain(
      "Take a photo of a handwritten note, and Fudepan turns it into a list of tasks your family can share.",
    );
  });

  it("labels the real capture page as starting with your own note", () => {
    expect(COPY.ja.example.actual.link).toBe("自分のメモで始める（ログインが必要です）");
    expect(COPY.en.example.actual.link).toBe("Start with your own note (log in required)");
  });
});

describe("Built with Kiro", () => {
  it.each(["ja", "en"] as const)("%s: shows the spec, the example, and the test, with real paths", (lang) => {
    const html = render(lang);
    const { kiro } = COPY[lang].how;
    expect(html).toContain(esc(kiro.title));
    expect(html.indexOf("lp-kiro")).toBeGreaterThan(html.indexOf("lp-confirm"));
    for (const step of kiro.steps) expect(html).toContain(`<code class="lp-kiro__path">${step.path}</code>`);
    expect(html).toContain(esc(kiro.honest));
    const section = html.slice(html.indexOf('<section class="lp-kiro"'), html.indexOf("</section>", html.indexOf("lp-kiro")));
    expect(section).not.toContain("href=");
  });

  it("cites only things that exist in the repository", () => {
    const [spec, example, test] = COPY.en.how.kiro.steps;
    expect(repo(spec.path)).toContain(spec.quote);
    expect(repo(example.path)).toContain('import { decideCompletion } from "@/lib/care/rules/completion";');
    expect(repo(test.path)).toContain(`it("${test.detail}"`);
    expect(COPY.ja.how.kiro.steps.map((s) => s.path)).toEqual(COPY.en.how.kiro.steps.map((s) => s.path));
  });

  it("does not claim AI reading or notifications on this page", () => {
    expect(COPY.ja.how.kiro.honest).toContain("動いていません");
    expect(COPY.en.how.kiro.honest).toMatch(/does not read notes with AI or send notifications/);
  });
});
