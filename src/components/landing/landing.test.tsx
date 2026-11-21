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
      high: "Requires confirmation",
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
    expect(text).toContain("Which hospital? What time?");
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
    expect(log.find((e) => e.kind === "reminder")!.status).toBe("No reply");
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

describe("draft tasks can quote their note line", () => {
  it("maps every task to an exact line on the note", () => {
    for (const task of DRAFT.tasks) {
      expect(NOTE.lines.find((l) => l.id === task.id)?.text, task.id).toBeTruthy();
    }
    // Nothing is quoted until a task is chosen.
    expect(html).not.toContain("data-task-source");
  });
});
