import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RISK_LABELS } from "@/lib/care/risk";

import {
  DRAFT,
  FOLLOW_UP,
  HERO,
  HOW_IT_WORKS,
  isOnTime,
  KIRO,
  NOTE,
  SAFETY,
  SIGN_IN_HREF,
} from "./content";
import { Landing } from "./landing";

const html = renderToStaticMarkup(<Landing />);
const text = html
  .replace(/<[^>]+>/g, " ")
  .replace(/&#x27;|&#39;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");

function count(pattern: RegExp): number {
  return html.match(pattern)?.length ?? 0;
}

function plain(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** A repository file, read relative to the repo root. */
function repoFile(path: string): string {
  return readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
}

describe("landing says what Fudepan is, straight away", () => {
  it("names the product and what it does in the first heading and lede", () => {
    expect(count(/<h1[\s>]/g)).toBe(1);
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "")
      .replace(/<[^>]+>/g, "")
      .replace(/&#x27;|&#39;/g, "'");
    expect(h1).toBe(HERO.title.text);
    expect(h1).toMatch(/handwritten notes/);
    // The accent phrase is set apart, and never split across lines.
    expect(html).toContain(`<span class="word__inner accent">${HERO.title.accent}</span>`);
    expect(text).toContain(HERO.lede);
    // The hero, with its working example, comes before every other section.
    expect(html.indexOf('id="top"')).toBeLessThan(html.indexOf('id="how-it-works"'));
  });

  it("shows the note and the draft made from it, line by line", () => {
    for (const line of NOTE.lines) expect(text).toContain(line.text);
    expect(DRAFT.tasks.map((t) => t.id)).toEqual(NOTE.lines.map((l) => l.id));
    for (const task of DRAFT.tasks) expect(text).toContain(task.title);
  });

  it("answers the questions a family will ask, in a short page", () => {
    const sections = [...html.matchAll(/<section[^>]*id="([^"]+)"/g)].map((m) => m[1]);
    expect(sections).toEqual([
      "top",
      // The interactive sample inside the hero, the main button's target.
      "sample-draft",
      "how-it-works",
      "follow-up",
      "safety",
      "for-families",
      "begin",
    ]);
  });

  it("explains the three steps in a few words each", () => {
    expect(HOW_IT_WORKS.steps).toHaveLength(3);
    for (const step of HOW_IT_WORKS.steps) {
      expect(text).toContain(step.title);
      expect(step.text.split(" ").length).toBeLessThanOrEqual(10);
    }
  });

  it("hides the hero entrance states only when JavaScript has run", () => {
    expect(html).toContain("<script>document.documentElement.classList.add('intro')</script>");
    expect(html).not.toMatch(/style="[^"]*opacity:\s*0/);
  });

  it("takes the main button straight to the sample, and keeps How it works in the nav", () => {
    expect(HERO.primaryCta).toBe("Try the sample note");
    expect(HERO.primaryHref).toBe("#sample-draft");
    expect(html).toMatch(
      /<a href="#sample-draft" class="button button--primary"[^>]*>Try the sample note/,
    );
    // The target holds the sample's title and tasks, and can take focus.
    const target = html.match(/<section id="sample-draft"[^>]*>/)?.[0] ?? "";
    expect(target).toContain('tabindex="-1"');
    expect(target).toContain('aria-labelledby="draft-title"');
    expect(html.indexOf('id="sample-draft"')).toBeLessThan(html.indexOf('data-task="visit"'));
    expect(html).toMatch(/<nav[^>]*>[\s\S]*?<a href="#how-it-works">How it works<\/a>/);
  });

  it("shows the sample's cards once the entrance is done or skipped, whatever was mid-animation", () => {
    const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
    const guard = css.match(/html\.intro-done\s*:is\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(guard?.[1]).toContain("[data-intro-card]");
    expect(guard?.[2]).toMatch(/opacity:\s*1\s*!important/);
    expect(guard?.[2]).toMatch(/transform:\s*none\s*!important/);
  });

  it("offers a real way in", () => {
    expect(count(new RegExp(`href="${SIGN_IN_HREF}"`, "g"))).toBeGreaterThanOrEqual(2);
  });

  it("avoids empty SaaS vocabulary", () => {
    expect(text).not.toMatch(/AI-powered|revolutionary|seamless|cutting-edge/i);
  });
});

describe("landing accessibility", () => {
  it("labels every section with a heading that exists", () => {
    const labelled = [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    expect(labelled.length).toBeGreaterThanOrEqual(6);
    for (const id of labelled) expect(html).toContain(`id="${id}"`);
  });

  it("hides every decorative SVG from assistive technology", () => {
    const svgs = html.match(/<svg[^>]*>/g) ?? [];
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) expect(svg).toContain('aria-hidden="true"');
  });

  it("states risk in words, using the steering labels", () => {
    expect(RISK_LABELS).toEqual({
      low: "Low priority",
      medium: "Needs attention",
      high: "High risk",
    });
    for (const label of Object.values(RISK_LABELS)) expect(text).toContain(label);
  });

  it("makes each draft task a toggle button, and offers a skip link", () => {
    expect(count(/<button type="button" class="task[^"]*" aria-pressed="false"/g)).toBe(
      DRAFT.tasks.length,
    );
    expect(html).toMatch(/<a href="#main" class="skip-link">Skip to main content<\/a>/);
    expect(html).toContain('aria-live="polite"');
  });

  it("keeps Grandma's note as real text with a caption", () => {
    expect(html).toContain('aria-labelledby="demo-note-caption"');
    expect(text).toContain(NOTE.caption);
  });
});

describe("landing content follows the safety policy", () => {
  it("marks every task from the note as needing confirmation", () => {
    for (const task of DRAFT.tasks) expect(task.risk, task.title).toBe("high");
  });

  it("asks about missing details instead of guessing them", () => {
    expect(DRAFT.tasks.some((t) => t.question)).toBe(true);
    expect(text).toContain("Which hospital? What time is the appointment?");
  });

  it("keeps the family's confirmation deadline apart from the unknown appointment time", () => {
    const card = html.match(/<button[^>]*data-task="visit"[^>]*>([\s\S]*?)<\/button>/)?.[1] ?? "";
    const field = (name: string) =>
      card.match(
        new RegExp(
          `<span class="task__due" ${name}="true"><span class="task__due-label">[^<]*</span>[^<]*</span>`,
        ),
      )?.[0] ?? "";
    const due = field("data-due");
    const appointment = field("data-appointment");
    expect(plain(due)).toBe("Family-set confirmation deadline: Wed 6 PM");
    expect(plain(appointment)).toBe("Appointment time: To be confirmed");
    // Never one merged value, and no invented appointment time.
    expect(plain(card)).not.toContain("Wed 6 PM (");
    expect(plain(card)).not.toMatch(/Appointment time: (Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d)/);
  });

  it("shows on the hospital card that approval comes before marking it done", () => {
    const card = html.match(/<button[^>]*data-task="visit"[^>]*>([\s\S]*?)<\/button>/)?.[0] ?? "";
    // Still the same toggle that points back to the note line.
    expect(card).toMatch(
      /^<button type="button" class="task[^"]*" aria-pressed="false" data-task="visit"/,
    );
    expect(plain(card)).toContain(
      "Approval first: It can’t be marked done until a family member approves it.",
    );
    expect(plain(card)).toContain("Requires confirmation");
  });

  it("shows an unowned task instead of assigning someone automatically", () => {
    expect(DRAFT.tasks.some((t) => t.owner === null)).toBe(true);
    expect(text).toContain(DRAFT.unowned);
  });

  it("sends the medication question to the doctor rather than answering it", () => {
    expect(text).toContain("Only her doctor can answer this. Fudepan will not.");
    expect(text).not.toMatch(/you (can|should) stop/i);
  });

  it("says plainly what the AI never does", () => {
    for (const rule of SAFETY.never) expect(text).toContain(rule);
    expect(text).toContain("Fudepan is not a medical service.");
  });
});

describe("follow-up example keeps approval, work, and proof apart", () => {
  const { task, log, labels } = FOLLOW_UP;

  it("tells events in the order they happened", () => {
    const minutes = log.map((e) => e.at.minutes);
    expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);
  });

  it("gets approved before anyone is reminded, and done before the proof arrives", () => {
    expect(task.approval.at.minutes).toBeLessThan(
      log.find((e) => e.kind === "reminder")!.at.minutes,
    );
    expect(task.done.at.minutes).toBeLessThanOrEqual(task.proof.at.minutes);
    expect(log.find((e) => e.kind === "done")!.at).toEqual(task.done.at);
    expect(log.find((e) => e.kind === "proof")!.at).toEqual(task.proof.at);
  });

  it("keeps the handoff to the backup person when nobody answers", () => {
    const kinds = log.map((e) => e.kind);
    expect(kinds.indexOf("reminder")).toBeLessThan(kinds.indexOf("handoff"));
    expect(kinds.indexOf("handoff")).toBeLessThan(kinds.indexOf("accepted"));
    expect(log.find((e) => e.kind === "reminder")!.status).toBe("Simulated");
  });

  it("never implies that a reminder or escalation was really delivered", () => {
    const section = html.match(/<section id="follow-up"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(plain(section)).not.toMatch(/deliver|reminder sent|sent to|follows up/i);
    for (const entry of log.filter((e) => e.kind === "reminder" || e.kind === "handoff")) {
      expect(["Simulated", "Recorded"], entry.text).toContain(entry.status);
    }
    expect(log.find((e) => e.kind === "reminder")!.text).toContain("(not sent)");
    // The Alpha note is visible text in the section, not screen-reader-only.
    expect(plain(section)).toContain(FOLLOW_UP.disclaimer.replace(/\s+/g, " "));
    expect(FOLLOW_UP.disclaimer).toContain("sends no notifications");
    expect(section).not.toMatch(/class="sr-only"[^>]*>[^<]*sends no notifications/);
    expect(section).toContain(`aria-label="${labels.log}"`);
  });

  it("judges on time by when the work was done, not when proof was uploaded", () => {
    expect(isOnTime(task)).toBe(true);
    const lateProof = {
      ...task,
      proof: { ...task.proof, at: { label: "", minutes: task.deadline.minutes + 60 } },
    };
    expect(isOnTime(lateProof)).toBe(true);
    const lateWork = {
      ...task,
      done: { ...task.done, at: { label: "", minutes: task.deadline.minutes + 1 } },
    };
    expect(isOnTime(lateWork)).toBe(false);
  });

  it("labels the deadline, the family decision, the task status, and the proof separately", () => {
    for (const label of [labels.deadline, labels.approval, labels.status, labels.proof]) {
      expect(html).toContain(`<dt>${label}</dt>`);
    }
    expect(text).toContain(task.deadline.label);
    expect(text).toContain(labels.onTime);
    expect(text).not.toContain(labels.late);
    expect(text).toContain(`${task.done.at.label} by ${task.done.by}`);
    expect(text).toContain(`added ${task.proof.at.label}`);
  });

  it("shows a settled approval as Approved only, with no pending-style label beside it", () => {
    const row =
      html.match(new RegExp(`<dt>${labels.approval}</dt><dd>([\\s\\S]*?)</dd>`))?.[1] ?? "";
    expect(row).toContain(task.approval.result);
    expect(row).toContain(`by ${task.approval.by}, ${task.approval.at.label}`);
    expect(row).not.toContain('class="risk');
    expect(row).not.toContain(RISK_LABELS.high);
  });
});

describe("footer evidence matches the repository", () => {
  const items = KIRO.verification.items;

  it("quotes the Kiro spec exactly, under the cited heading", () => {
    for (const item of items) {
      const spec = repoFile(item.spec.file);
      expect(spec).toContain(`## ${item.spec.section}`);
      const section = spec.split(`## ${item.spec.section}`)[1].split("\n## ")[0];
      expect(section).toContain(item.spec.quote);
    }
  });

  it("names enforcement code that exists in the cited files", () => {
    for (const item of items) {
      for (const e of item.enforcement) expect(repoFile(e.file), e.file).toContain(e.code);
    }
    const actions = repoFile("src/app/(app)/care/actions.ts");
    expect(actions).toContain("export async function completeStep");
  });

  it("cites tests that exist and call the real completeStep action", () => {
    for (const item of items) {
      for (const t of item.tests) {
        const source = repoFile(t.file);
        const declared = t.file.endsWith(".sql") ? `'${t.name}'` : `it("${t.name}"`;
        expect(source, t.name).toContain(declared);
      }
    }
    const tests = repoFile("src/lib/care/actions.test.ts");
    expect(tests).toContain('import { completeStep } from "@/app/(app)/care/actions";');
    expect(tests).not.toMatch(/expect\(true\)|const \w+ = true;/);
  });

  it("shows every citation in the footer", () => {
    // Inline tags removed without adding spaces, so "file</span>: name" reads "file: name".
    const footer = (
      html.match(/<footer class="site-footer">[\s\S]*?<\/footer>/)?.[0] ?? ""
    ).replace(/<[^>]+>/g, "");
    for (const item of items) {
      expect(footer).toContain(item.rule);
      expect(footer).toContain(item.spec.file);
      expect(footer).toContain(item.spec.quote);
      for (const e of item.enforcement) expect(footer).toContain(`${e.file} (${e.code})`);
      for (const t of item.tests) expect(footer).toContain(`${t.file}: “${t.name}”`);
    }
  });
});

describe("draft tasks can quote their note line", () => {
  it("maps every task to an exact line on the note", () => {
    for (const task of DRAFT.tasks) {
      expect(NOTE.lines.find((l) => l.id === task.id)?.text, task.id).toBeTruthy();
    }
    // Nothing is quoted until a task is chosen.
    expect(html).not.toContain("data-task-source");
  });
});

describe("landing refresh keeps motion out of the way", () => {
  const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  /** The body of the first CSS block that starts with `header`, matched by braces. */
  function cssBlock(header: string): string {
    const open = css.indexOf("{", css.indexOf(header));
    if (css.indexOf(header) < 0 || open < 0) return "";
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    return "";
  }

  it("never pins a section or takes over scrolling", () => {
    const files = [
      "./motion/runtime.ts",
      "./motion/hero-intro.ts",
      "./motion/landing-motion.tsx",
      "./in-page-links.tsx",
      "./reveal.tsx",
      "./draft-demo.tsx",
      "./how-it-works.tsx",
      "./landing.tsx",
    ];
    for (const file of files) {
      const code = source(file);
      expect(code, file).not.toMatch(/from "lenis"|\bpin:\s*true|\bscrub:/);
      expect(code, file).not.toMatch(/addEventListener\(\s*"(wheel|touchmove|scroll)"/);
      expect(code, file).not.toContain("preventDefault(");
    }
    expect(css).not.toMatch(/position:\s*sticky|scroll-snap|overscroll-behavior|how--pinned/);
    expect(html).not.toMatch(/data-how-pin|how__stage/);
  });

  it("plays the new task and timeline motion only when motion is welcome", () => {
    const allowed = cssBlock("@media (prefers-reduced-motion: no-preference)");
    const reduced = cssBlock("@media (prefers-reduced-motion: reduce)");
    const outside = css.replace(allowed, "");
    for (const name of ["task-edge", "task-ring", "source-in"]) {
      expect(allowed).toContain(`animation: ${name} `);
      expect(outside).not.toContain(`animation: ${name} `);
    }
    // The timeline line draws down on entry, and only here.
    expect(allowed).toMatch(
      /\.escalation:not\(\.is-in\) \.log::before\s*\{\s*transform: scaleY\(0\)/,
    );
    // Reduced motion: presses and selections still show, without movement.
    expect(reduced).toMatch(/\.task:active,\s*\.draft__more:active\s*\{\s*scale: none/);
    expect(reduced).toMatch(/\.task:hover,\s*\.task\.is-active\s*\{\s*translate: none/);
  });

  it("answers a press on a task, and lifts cards only where hover exists", () => {
    expect(css).toMatch(/\.task:active\s*\{[^}]*scale: 0\.985/);
    const hover = cssBlock("@media (hover: hover)");
    expect(hover).toMatch(/\.task:hover,\s*\.task\.is-active\s*\{\s*translate: 0 -4px/);
    expect(css.replace(hover, "")).not.toContain("translate: 0 -4px");
    // Hover previews come from a mouse only, so a tap never leaves a card highlighted.
    expect(source("./draft-demo.tsx")).toContain('event.pointerType === "mouse"');
  });

  it("never hides Grandma's note during the entrance", () => {
    const hidden =
      css.match(/html\.intro:not\(\.intro-done\)\s*:is\(([^)]*)\)\s*\{\s*opacity: 0/)?.[1] ?? "";
    expect(hidden).toContain("[data-intro-card]");
    expect(hidden).not.toContain("data-intro-note");
    expect(html).not.toContain("data-intro-wipe");
    for (const line of NOTE.lines) expect(text).toContain(line.text);
  });

  it("keeps keyboard focus visible on every surface", () => {
    // The only outline removed is on <main>, which is focused by script after the skip link.
    expect(css.match(/outline:\s*(none|0)\b/g) ?? []).toHaveLength(1);
    expect(css).toMatch(/main:focus\s*\{\s*outline: none/);
    expect(cssBlock(".hero {")).toContain("--focus-ring: var(--cobalt)");
    expect(cssBlock(".section--slate {")).toContain("--focus-ring: var(--amber-light)");
  });

  it("uses cobalt for the main action and slate for the follow-up, keeping the disclosure visible", () => {
    expect(cssBlock(".button--primary {")).toContain("background: var(--cobalt)");
    expect(html).toMatch(/<section id="follow-up" class="section section--slate"/);
    expect(html).toContain(`<p class="follow__note">${FOLLOW_UP.disclaimer}</p>`);
  });

  it("still quotes the note line inside the selected task", () => {
    expect(source("./draft-demo.tsx")).toMatch(
      /selected === task\.id && \([\s\S]*?data-task-source[\s\S]*?lineFor\(task\.id\)/,
    );
  });
});
