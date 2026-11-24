import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  cardShortcut,
  CareExample,
  clinicStart,
  FamilyParty,
  ownerShortcut,
  TaskRow,
  TaskThanks,
  ThanksBoard,
} from "./care-example";
import { COPY, EXAMPLE_COPY } from "./content";
import {
  claim,
  complete,
  release,
  confirm,
  findTask,
  initialExample,
  saveClinic,
  sendThanks,
  type ExampleResult,
  type ExampleState,
  type PersonId,
  type StickerId,
  type TaskId,
  type ThanksList,
} from "./example";

function render(lang: "ja" | "en") {
  return renderToStaticMarkup(<CareExample lang={lang} />);
}

/** Text as React writes it into HTML. */
function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
}

function count(html: string, needle: string | RegExp): number {
  return html.split(needle).length - 1;
}

describe("CareExample, as first rendered", () => {
  it.each(["ja", "en"] as const)("%s: shows four tasks, four empty progress segments, and 0 of 4", (lang) => {
    const html = render(lang);
    const c = EXAMPLE_COPY[lang];
    expect(count(html, /<li class="lp-task"/)).toBe(4);
    for (const id of ["card", "clinic", "visit", "glasses"] as const) expect(html).toContain(esc(c.tasks[id]));
    expect(count(html, 'data-filled="false"')).toBe(4);
    expect(count(html, 'data-filled="true"')).toBe(0);
    expect(html).toContain(c.progress(0, 4));
    expect(html).toContain(esc(c.photoHint));
  });

  it.each(["ja", "en"] as const)("%s: shows the ready photo only, and no accent before anything is done", (lang) => {
    const html = render(lang);
    const active = html.match(/<img[^>]*data-active="true"[^>]*>/g) ?? [];
    expect(active).toHaveLength(1);
    expect(active[0]).toContain("grandma-ready.png");
    expect(active[0]).toContain(`alt="${EXAMPLE_COPY[lang].photoAlt[0]}"`);
    expect(count(html, /data-active="false"/)).toBe(4);
    for (const n of [1, 2, 3, 4]) expect(html).toContain(`grandma-task-${n}.png`);
    expect(html).not.toContain("lp-celebrate");
  });

  it.each(["ja", "en"] as const)("%s: offers each person as a named choice, with Yui selected", (lang) => {
    const html = render(lang);
    const c = EXAMPLE_COPY[lang];
    const radios = html.match(/<input type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.includes("checked"))).toEqual([expect.stringContaining('value="yui"')]);
    expect(html).toContain(`<legend class="lp-tray__legend">${c.persona.legend}</legend>`);
    expect(count(html, 'class="lp-face" data-can-drag="true"')).toBe(3);
    expect(html).toContain(esc(c.dragHint));
  });

  it("names the choices so a screen reader says who you act as", () => {
    expect(render("ja")).toContain('ミサ<span class="lp-sr">として操作</span>');
    expect(render("en")).toContain('<span class="lp-sr">Act as </span>Kenta');
  });

  it.each(["ja", "en"] as const)("%s: shows the unknown clinic and who to ask, with no clinic name", (lang) => {
    const html = render(lang);
    const c = EXAMPLE_COPY[lang];
    expect(html).toContain(esc(c.missingHospital));
    expect(html).toContain(esc(c.askFromNote(c.people.misa, c.note.transcript[1])));
    expect(html).not.toContain(c.clinicForm.sampleName);
    expect(html).not.toContain("lp-clinic__input");
  });

  it("says what the visitor can do, in plain words, in both languages", () => {
    expect(COPY.ja.example.fictional).toContain("ミサ、ケンタ、ユイのだれとしても操作できます");
    expect(COPY.en.example.fictional).toContain("You can act as Misa, Kenta, or Yui");
    expect(COPY.ja.example.fictional).toContain("何も保存されず");
    expect(COPY.en.example.fictional).toContain("Nothing is saved or sent");
  });
});

function ok(r: ExampleResult): ExampleState {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.state;
}

/** One card alone, in a given state, as a given person. */
function taskCard(state: ExampleState, id: TaskId, actor: PersonId, lang: "ja" | "en" = "ja") {
  const task = findTask(state, id);
  if (!task) throw new Error(`no ${id}`);
  return renderToStaticMarkup(
    <TaskRow
      task={task}
      actor={actor}
      lang={lang}
      copy={EXAMPLE_COPY[lang]}
      riskLabel="高リスク"
      doneLabel="完了"
      confirmedLabel="確認済み"
      hospital={task.missingHospital}
      dragging={null}
      over={false}
      onAction={() => {}}
      onSwitch={() => {}}
      clinicForm={null}
    />,
  );
}

/** The visit card alone, in a given state, as a given person. */
function visitCard(state: ExampleState, actor: PersonId, lang: "ja" | "en" = "ja") {
  return taskCard(state, "visit", actor, lang);
}

/** The 「完了にする」 button's opening tag, and the element its aria-describedby points to. */
function completeButton(html: string) {
  const button = html.match(/<button[^>]*data-focus="visit:complete"[^>]*>/)?.[0] ?? null;
  const describedBy = button?.match(/aria-describedby="([^"]+)"/)?.[1] ?? null;
  const reason = describedBy ? (html.match(new RegExp(`<p id="${describedBy}"[^>]*>(.*?)</p>`))?.[1] ?? null) : null;
  return { button, reason };
}

const withClinic = () => ok(saveClinic(ok(claim(initialExample(), "clinic", "yui")), "みどり台クリニック", "yui"));
/** Clinic saved, and Yui going along: the visit is ready for Misa. */
const ready = () => ok(claim(withClinic(), "visit", "yui"));
const confirmed = () => ok(confirm(ready(), "visit", "misa"));

describe("the visit card's 「完了にする」", () => {
  it.each(["ja", "en"] as const)("%s: is shown disabled from the start, with the missing clinic as its reason", (lang) => {
    const html = render(lang);
    const { button, reason } = completeButton(html);
    expect(button).toContain('aria-disabled="true"');
    expect(button).not.toMatch(/\sdisabled[\s=>]/);
    expect(reason).toContain(esc(EXAMPLE_COPY[lang].completeBlocked.missing(true, true)));
    // No other card gets a disabled button.
    expect(count(html, 'aria-disabled="true"')).toBe(1);
  });

  it("keeps waiting for Misa next to her own 「ミサとして確認する」 button", () => {
    const html = visitCard(ready(), "misa");
    expect(html).toContain('data-focus="visit:confirm"');
    const { button, reason } = completeButton(html);
    expect(button).toContain('aria-disabled="true"');
    expect(reason).toContain(EXAMPLE_COPY.ja.completeBlocked.confirm("ミサ"));
  });

  it.each(["yui", "kenta"] as const)("tells %s to wait for Misa, with a button to switch to her", (actor) => {
    const html = visitCard(ready(), actor);
    expect(html).not.toContain('data-focus="visit:confirm"');
    expect(completeButton(html).reason).toContain(EXAMPLE_COPY.ja.completeBlocked.confirm("ミサ"));
    expect(html).toMatch(/data-focus="visit:switch"[^>]*>ミサに切り替える</);
    // The button replaces the text hint, so it is not said twice.
    expect(html).not.toContain(EXAMPLE_COPY.ja.waiting.switchToConfirm("ミサ"));
  });

  it.each(["misa", "yui"] as const)("after Misa confirms, tells %s that only Kenta can finish it", (actor) => {
    const { button, reason } = completeButton(visitCard(confirmed(), actor));
    expect(button).toContain('aria-disabled="true"');
    expect(reason).toContain(EXAMPLE_COPY.ja.completeBlocked.owner("ケンタ"));
  });

  it("works for Kenta once Misa has confirmed, with no reason shown", () => {
    const html = visitCard(confirmed(), "kenta");
    const { button, reason } = completeButton(html);
    expect(button).not.toBeNull();
    expect(button).not.toContain("aria-disabled");
    expect(button).not.toContain("aria-describedby");
    expect(reason).toBeNull();
    expect(html).not.toContain("lp-task__reason");
  });

  it("is replaced by the done badge once Kenta finishes", () => {
    const html = visitCard(ok(complete(confirmed(), "visit", "kenta")), "kenta");
    expect(completeButton(html).button).toBeNull();
    expect(html).toContain("lp-pill--done");
    expect(html).not.toContain("lp-task__reason");
  });
});

describe("the visit card's 「ケンタに切り替える」 shortcut", () => {
  const visit = (state: ExampleState) => {
    const t = findTask(state, "visit");
    if (!t) throw new Error("no visit");
    return t;
  };
  /** The opening tag of the shortcut button and its label, or null. */
  const shortcut = (html: string) =>
    html.match(/<button[^>]*data-focus="visit:switch"[^>]*>([^<]*)<span class="lp-sr">[^<]*<\/span><\/button>/);

  it.each(["misa", "yui"] as const)("shows for %s once Misa has confirmed, naming the owner", (actor) => {
    expect(ownerShortcut(visit(confirmed()), actor)).toBe("kenta");
    expect(shortcut(visitCard(confirmed(), actor, "ja"))?.[1]).toBe("ケンタに切り替える");
    expect(shortcut(visitCard(confirmed(), actor, "en"))?.[1]).toBe("Switch to Kenta");
  });

  it("sits with 「完了にする」 in the card's actions, and points to the reason", () => {
    const html = visitCard(confirmed(), "misa");
    const actions = html.match(/<div class="lp-task__actions"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    expect(actions).toContain('data-focus="visit:complete"');
    expect(actions).toContain('data-focus="visit:switch"');
    expect(actions.indexOf("visit:complete")).toBeLessThan(actions.indexOf("visit:switch"));
    const describedBy = shortcut(html)?.[0].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(describedBy).toBeTruthy();
    expect(html).toContain(`<p id="${describedBy}" class="lp-task__reason">`);
  });

  it.each(["misa", "kenta", "yui"] as const)("is hidden for %s before Misa confirms", (actor) => {
    expect(ownerShortcut(visit(initialExample()), actor)).toBeNull();
    expect(ownerShortcut(visit(withClinic()), actor)).toBeNull();
    expect(shortcut(visitCard(withClinic(), actor))?.[1]).not.toBe("ケンタに切り替える");
  });

  it("is hidden when already acting as the owner, who can finish it", () => {
    expect(ownerShortcut(visit(confirmed()), "kenta")).toBeNull();
    const html = visitCard(confirmed(), "kenta");
    expect(shortcut(html)).toBeNull();
    expect(completeButton(html).button).not.toContain("aria-disabled");
  });

  it("is hidden again when a helper joins and Misa has to confirm again", () => {
    const joined = ok(claim(ok(release(confirmed(), "visit", "yui")), "visit", "misa"));
    expect(ownerShortcut(visit(joined), "misa")).toBeNull();
    expect(shortcut(visitCard(joined, "misa"))).toBeNull();
  });

  it.each(["misa", "kenta", "yui"] as const)("is hidden for %s after completion", (actor) => {
    const done = ok(complete(confirmed(), "visit", "kenta"));
    expect(ownerShortcut(visit(done), actor)).toBeNull();
    expect(shortcut(visitCard(done, actor))).toBeNull();
  });

  it("is never offered on the other cards", () => {
    for (const t of confirmed().tasks.filter((x) => x.id !== "visit")) {
      for (const actor of ["misa", "kenta", "yui"] as const) expect(ownerShortcut(t, actor)).toBeNull();
    }
  });

  it("leads to a 「完了にする」 that only the owner's guard decides, with the task unchanged", () => {
    const before = confirmed();
    // Switching only selects Kenta: the same state, now rendered for him, has the enabled button.
    expect(completeButton(visitCard(before, "misa")).button).toContain('aria-disabled="true"');
    expect(completeButton(visitCard(before, "kenta")).button).not.toContain("aria-disabled");
    expect(complete(before, "visit", "misa")).toEqual({ ok: false, code: "not_owner" });
    expect(complete(before, "visit", "kenta").ok).toBe(true);
  });
});

describe("the visit card's 「ミサに切り替える」 shortcut", () => {
  const visit = (state: ExampleState) => {
    const t = findTask(state, "visit");
    if (!t) throw new Error("no visit");
    return t;
  };
  const shortcut = (html: string) =>
    html.match(/<button[^>]*data-focus="visit:switch"[^>]*>([^<]*)<span class="lp-sr">[^<]*<\/span><\/button>/);

  it.each(["yui", "kenta"] as const)("shows for %s once clinic and companion are set, leading to Misa's 「ミサとして確認する」", (actor) => {
    expect(cardShortcut(visit(ready()), actor)).toEqual({ person: "misa", then: "confirm" });
    expect(shortcut(visitCard(ready(), actor, "ja"))?.[1]).toBe("ミサに切り替える");
    expect(shortcut(visitCard(ready(), actor, "en"))?.[1]).toBe("Switch to Misa");
  });

  it.each(["yui", "kenta"] as const)("is hidden for %s while nobody is going along", (actor) => {
    expect(cardShortcut(visit(withClinic()), actor)).toBeNull();
    expect(shortcut(visitCard(withClinic(), actor))).toBeNull();
  });

  it.each(["misa", "kenta", "yui"] as const)("is hidden for %s before the clinic is saved", (actor) => {
    expect(cardShortcut(visit(initialExample()), actor)).toBeNull();
    expect(shortcut(visitCard(initialExample(), actor))).toBeNull();
  });

  it("is hidden when already acting as Misa, who sees the enabled 「ミサとして確認する」 instead", () => {
    expect(cardShortcut(visit(ready()), "misa")).toBeNull();
    const html = visitCard(ready(), "misa");
    expect(shortcut(html)).toBeNull();
    expect(html).toMatch(/<button[^>]*data-focus="visit:confirm"(?![^>]*aria-disabled)[^>]*>/);
  });

  it.each(["yui", "kenta"] as const)("uses the same stacked layout for %s, so the title keeps its width", (actor) => {
    // Yui goes along on her card, so it has 「やめる」; on Kenta's, Misa goes along.
    const state = actor === "yui" ? ready() : ok(claim(withClinic(), "visit", "misa"));
    const html = visitCard(state, actor);
    const actions = html.match(/<div class="lp-task__actions" data-stack="">(.*?)<\/div>/)?.[1] ?? "";
    const order = [...actions.matchAll(/data-focus="visit:(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(actor === "yui" ? ["complete", "switch", "release"] : ["complete", "switch"]);
    const describedBy = shortcut(html)?.[0].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`<p id="${describedBy}" class="lp-task__reason">`);
  });

  it.each(["yui", "kenta"] as const)("leaves the visit pending and nothing else changed when %s switches", (actor) => {
    const before = ready();
    // Switching only selects Misa: the same state, rendered for her, has the enabled 「ミサとして確認する」.
    expect(visitCard(before, "misa")).toContain('data-focus="visit:confirm"');
    const v = visit(before);
    expect(v.approvalState).toBe("pending");
    expect(v.holders).toEqual({ owner: "kenta", driver: "kenta", companion: "yui" });
    expect(confirm(before, "visit", actor)).toEqual({ ok: false, code: "not_primary_caregiver" });
    expect(visit(ok(confirm(before, "visit", "misa"))).approvalState).toBe("approved");
  });

  it("offers Misa again when the companion changes after she confirmed", () => {
    const joined = ok(claim(ok(release(confirmed(), "visit", "yui")), "visit", "misa"));
    expect(cardShortcut(visit(joined), "yui")).toEqual({ person: "misa", then: "confirm" });
  });

  it.each(["misa", "yui"] as const)("hands over to the Kenta shortcut after confirmation, unchanged, for %s", (actor) => {
    expect(cardShortcut(visit(confirmed()), actor)).toEqual({ person: "kenta", then: "complete" });
    expect(shortcut(visitCard(confirmed(), actor))?.[1]).toBe("ケンタに切り替える");
    expect(cardShortcut(visit(confirmed()), "kenta")).toBeNull();
  });

  it.each(["misa", "kenta", "yui"] as const)("is hidden for %s after completion and on the other cards", (actor) => {
    const done = ok(complete(confirmed(), "visit", "kenta"));
    expect(cardShortcut(visit(done), actor)).toBeNull();
    for (const t of withClinic().tasks.filter((x) => x.id === "clinic" || x.id === "glasses")) {
      expect(cardShortcut(t, actor)).toBeNull();
    }
  });
});

describe("the insurance card's 「ミサに切り替える」 shortcut", () => {
  const card = (state: ExampleState) => {
    const t = findTask(state, "card");
    if (!t) throw new Error("no card");
    return t;
  };
  /** [whole button, visible label, hidden task name] of the card's shortcut, or null. */
  const shortcut = (html: string) =>
    html.match(/<button[^>]*data-focus="card:switch"[^>]*>([^<]*)<span class="lp-sr">([^<]*)<\/span><\/button>/);

  it.each(["yui", "kenta"] as const)("shows for %s from the start, naming Misa, the owner", (actor) => {
    expect(cardShortcut(card(initialExample()), actor)).toEqual({ person: "misa", then: "complete" });
    const ja = shortcut(taskCard(initialExample(), "card", actor, "ja"));
    expect(ja?.[1]).toBe("ミサに切り替える");
    expect(ja?.[2]).toBe("（「保険証を用意する」）");
    const en = shortcut(taskCard(initialExample(), "card", actor, "en"));
    expect(en?.[1]).toBe("Switch to Misa");
    expect(en?.[2]).toBe(": Get the insurance card ready");
  });

  it("is described by the card's waiting line, which names the owner", () => {
    const html = taskCard(initialExample(), "card", "yui");
    const describedBy = shortcut(html)?.[0].match(/aria-describedby="([^"]+)"/)?.[1];
    expect(html).toContain(`<p id="${describedBy}" class="lp-task__wait">${EXAMPLE_COPY.ja.waiting.owner("ミサ")}</p>`);
  });

  it("is hidden when already acting as Misa, who sees the enabled 「完了にする」 instead", () => {
    expect(cardShortcut(card(initialExample()), "misa")).toBeNull();
    const html = taskCard(initialExample(), "card", "misa");
    expect(shortcut(html)).toBeNull();
    expect(html).toMatch(/<button[^>]*data-focus="card:complete"(?![^>]*aria-disabled)[^>]*>/);
  });

  it.each(["misa", "kenta", "yui"] as const)("is hidden for %s after completion", (actor) => {
    const done = ok(complete(initialExample(), "card", "misa"));
    expect(cardShortcut(card(done), actor)).toBeNull();
    expect(shortcut(taskCard(done, "card", actor))).toBeNull();
  });

  it("follows the actual owner, and hides when nobody owns the card", () => {
    const released = ok(release(initialExample(), "card", "misa"));
    for (const actor of ["misa", "kenta", "yui"] as const) expect(cardShortcut(card(released), actor)).toBeNull();
    const kentas = ok(claim(released, "card", "kenta"));
    expect(cardShortcut(card(kentas), "misa")).toEqual({ person: "kenta", then: "complete" });
    expect(shortcut(taskCard(kentas, "card", "misa"))?.[1]).toBe("ケンタに切り替える");
    expect(cardShortcut(card(kentas), "kenta")).toBeNull();
  });

  it.each(["yui", "kenta"] as const)("leaves the card, progress, and photo as they are when %s switches", (actor) => {
    const before = initialExample();
    // Switching only selects Misa: the same state, rendered for her, has the enabled 「完了にする」.
    expect(taskCard(before, "card", "misa")).toContain('data-focus="card:complete"');
    expect(taskCard(before, "card", actor)).not.toContain('data-focus="card:complete"');
    expect(card(before).status).toBe("in_progress");
    expect(card(before).holders.owner).toBe("misa");
    expect(complete(before, "card", actor)).toEqual({ ok: false, code: "not_owner" });
    const done = ok(complete(before, "card", "misa"));
    expect(card(done).status).toBe("completed");
  });

  it("is not offered on the clinic or glasses cards, even when someone else owns them", () => {
    const s = ok(claim(ok(claim(initialExample(), "glasses", "kenta")), "clinic", "kenta"));
    for (const id of ["clinic", "glasses"] as const) expect(cardShortcut(findTask(s, id)!, "yui")).toBeNull();
  });

  it("can sit beside the visit's own 「ミサに切り替える」, and the hidden task names tell them apart", () => {
    const html = render("ja");
    expect(count(html, 'data-focus="card:switch"')).toBe(1);
    expect(taskCard(ready(), "visit", "yui")).toContain("（「通院に付き添う」）");
    expect(taskCard(withClinic(), "card", "yui")).toContain("（「保険証を用意する」）");
  });
});

describe("the visit card's layout with three buttons", () => {
  const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
  // Misa goes along, then confirms: 「完了にする」 (disabled), the shortcut, and 「やめる」 all show.
  const misaAlongAndConfirmed = () => ok(confirm(ok(claim(withClinic(), "visit", "misa")), "visit", "misa"));

  it("stacks the buttons, with the shortcut on its own row under 「完了にする」", () => {
    const html = visitCard(misaAlongAndConfirmed(), "misa");
    const actions = html.match(/<div class="lp-task__actions" data-stack="">(.*?)<\/div>/)?.[1] ?? "";
    const order = [...actions.matchAll(/data-focus="visit:(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["complete", "switch", "release"]);
    expect(html).toMatch(/<li class="lp-task"[^>]*data-locked-complete="true"/);
  });

  it("stacks only while the shortcut shows", () => {
    expect(visitCard(misaAlongAndConfirmed(), "kenta")).not.toContain("data-stack");
    expect(visitCard(ok(claim(withClinic(), "visit", "misa")), "misa")).not.toContain("data-stack");
  });

  it("caps the side only on the unfinished visit card, so the title keeps its width", () => {
    expect(count(render("ja"), "data-locked-complete")).toBe(1);
    const done = ok(complete(confirmed(), "visit", "kenta"));
    expect(visitCard(done, "kenta")).not.toContain("data-locked-complete");
    const wide = css.slice(css.indexOf("@container (min-width: 34rem)"));
    expect(wide).toMatch(/\.lp-task\[data-locked-complete\] \.lp-task__side \{\s*max-width: 16rem;\s*\}/);
    expect(css).toMatch(/\.lp-task__actions\[data-stack\] \{\s*flex-direction: column;\s*align-items: stretch;\s*\}/);
  });

  it("lets button labels wrap on a narrow card", () => {
    const btn = css.match(/\n\.lp-btn \{([^}]*)\}/)?.[1] ?? "";
    const task = css.match(/\n\.lp-btn--task \{([^}]*)\}/)?.[1] ?? "";
    expect(btn + task).not.toMatch(/white-space:\s*nowrap/);
    expect(btn).toMatch(/text-align: center;/);
  });
});

describe("the original note dialog", () => {
  const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
  const rule = css.match(/\n\.lp-dialog \{([^}]*)\}/)?.[1] ?? "";

  it("is centered in the viewport, even though the global reset removes the browser's margin", () => {
    expect(rule).toMatch(/position: fixed;/);
    expect(rule).toMatch(/inset: 0;/);
    expect(rule).toMatch(/margin: auto;/);
    expect(rule).toMatch(/height: fit-content;/);
    expect(rule).toMatch(/width: min\(46rem, calc\(100% - 1\.5rem\)\);/);
  });

  it("scrolls inside itself on a short viewport", () => {
    expect(rule).toMatch(/max-height: calc\(100% - 1\.5rem\);/);
    expect(rule).toMatch(/overflow: auto;/);
    expect(rule).toMatch(/overscroll-behavior: contain;/);
  });

  it("leaves display to the browser, so a closed dialog stays hidden", () => {
    expect(rule).not.toMatch(/display:/);
    expect(css).not.toMatch(/\.lp-dialog(\[open\])?\s*\{[^}]*display:/);
    expect(render("ja")).toMatch(/<dialog class="lp-dialog" aria-labelledby="lp-note-title">/);
  });
});

/** Yui does the clinic and goes along; Misa the card; Kenta the visit; Yui the glasses. */
function fullRun(): ExampleState {
  let s = ok(saveClinic(ok(claim(initialExample(), "clinic", "yui")), "みどり台クリニック", "yui"));
  s = ok(claim(s, "visit", "yui"));
  s = ok(complete(ok(claim(s, "glasses", "yui")), "glasses", "yui"));
  s = ok(complete(s, "card", "misa"));
  s = ok(complete(ok(confirm(s, "visit", "misa")), "visit", "kenta"));
  return s;
}

function thanksBlock(
  state: ExampleState,
  id: TaskId,
  actor: PersonId,
  thanks: ThanksList,
  opts: { pickerOpen?: boolean; pop?: { from: PersonId; n: number } | null; lang?: "ja" | "en" } = {},
) {
  const task = findTask(state, id);
  if (!task) throw new Error(`no ${id}`);
  return renderToStaticMarkup(
    <TaskThanks
      task={task}
      actor={actor}
      copy={EXAMPLE_COPY[opts.lang ?? "ja"]}
      idBase="t"
      thanks={thanks.filter((t) => t.task === id)}
      pickerOpen={opts.pickerOpen ?? false}
      pop={opts.pop ?? null}
      onOpen={() => {}}
      onClose={() => {}}
      onPick={() => {}}
      onRemove={() => {}}
    />,
  );
}

function kentaThanksYui(sticker: StickerId = "helped"): ThanksList {
  const r = sendThanks(fullRun(), [], "clinic", "kenta", sticker);
  if (!r.ok) throw new Error("not sent");
  return r.thanks;
}

describe("「ありがとうを送る」 on a finished card", () => {
  it("is offered to Kenta on Yui's finished clinic card, naming who it goes to", () => {
    const html = thanksBlock(fullRun(), "clinic", "kenta", []);
    expect(html).toMatch(
      /data-focus="clinic:thanks-send" aria-expanded="false">.*ありがとうを送る<span class="lp-sr">（ユイへ、「病院名を確認する」）<\/span><\/button>/,
    );
    expect(thanksBlock(fullRun(), "clinic", "kenta", [], { lang: "en" })).toContain(
      'Send thanks<span class="lp-sr"> to Yui: Confirm the clinic</span>',
    );
  });

  it("is not offered to the owner on her own card", () => {
    expect(thanksBlock(fullRun(), "clinic", "yui", [])).toBe("");
  });

  it("offers exactly the three stickers, in a labelled group", () => {
    const html = thanksBlock(fullRun(), "clinic", "kenta", [], { pickerOpen: true });
    const labels = [...html.matchAll(/data-focus="clinic:sticker:\w+"[^>]*>(?:<svg.*?<\/svg>)?([^<]*)</g)].map((m) => m[1]);
    expect(labels).toEqual(["助かった！", "送迎ありがとう", "おつかれさま"]);
    expect(html).toMatch(/role="group" aria-labelledby="t-clinic-stickers-label"/);
    expect(html).toContain("ユイに送るスタンプを選んでください");
    expect(html).toContain('aria-expanded="true" aria-controls="t-clinic-stickers"');
    const en = thanksBlock(fullRun(), "clinic", "kenta", [], { pickerOpen: true, lang: "en" });
    for (const label of ["That helped!", "Thanks for the ride", "Thanks for all your work"]) expect(en).toContain(label);
  });

  it("shows the sent sticker, who sent it to whom, and lets the sender change or remove it", () => {
    const html = thanksBlock(fullRun(), "clinic", "kenta", kentaThanksYui());
    expect(html).toContain('<span class="lp-sticker" data-sticker="helped">');
    expect(html).toContain("助かった！");
    expect(html).toContain("ケンタからユイへ");
    expect(html).toContain('data-focus="clinic:thanks-change"');
    expect(html).toContain('data-focus="clinic:thanks-remove"');
    expect(html).not.toContain('data-focus="clinic:thanks-send"');
  });

  it("marks the current sticker when changing it", () => {
    const html = thanksBlock(fullRun(), "clinic", "kenta", kentaThanksYui("ride"), { pickerOpen: true });
    expect(html).toMatch(/data-focus="clinic:sticker:ride" aria-pressed="true"/);
    expect(html).toMatch(/data-focus="clinic:sticker:helped" aria-pressed="false"/);
  });

  it("keeps the sticker for everyone after a switch, with edit buttons only for the sender", () => {
    const asYui = thanksBlock(fullRun(), "clinic", "yui", kentaThanksYui());
    expect(asYui).toContain("ケンタからユイへ");
    expect(asYui).not.toContain("thanks-change");
    const asMisa = thanksBlock(fullRun(), "clinic", "misa", kentaThanksYui());
    expect(asMisa).toContain("ケンタからユイへ");
    expect(asMisa).not.toContain("thanks-change");
    expect(asMisa).toContain('data-focus="clinic:thanks-send"');
  });

  it("pops only the sticker that was just sent", () => {
    expect(thanksBlock(fullRun(), "clinic", "kenta", kentaThanksYui(), { pop: { from: "kenta", n: 1 } })).toContain(
      'data-sticker="helped" data-pop=""',
    );
    expect(thanksBlock(fullRun(), "clinic", "kenta", kentaThanksYui())).not.toContain("data-pop");
  });
});

describe("「みんなでできた！」", () => {
  const party = (lang: "ja" | "en", celebration = 4) =>
    renderToStaticMarkup(<FamilyParty state={fullRun()} copy={EXAMPLE_COPY[lang]} idBase="p" celebration={celebration} />);

  it.each(["ja", "en"] as const)("%s: shows the title, the laughing portrait, and each person's real contribution", (lang) => {
    const html = party(lang);
    const c = EXAMPLE_COPY[lang];
    expect(html).toContain(`<section class="lp-party" aria-labelledby="p-party">`);
    expect(html).toContain(esc(c.party.title));
    expect(html).toMatch(/<img[^>]*alt=""[^>]*grandma-task-4\.png/);
    // next/image encodes the path, so match the file name.
    for (const person of ["misa", "kenta", "yui"] as const) expect(html).toContain(`${person}.png`);
    expect(count(html, 'class="lp-party__person"')).toBe(3);
    expect(html).toContain(esc(c.party.did.finished(c.tasks.card)));
    expect(html).toContain(esc(c.party.did.confirmed));
    expect(html).toContain(esc(c.party.did.drove));
    expect(html).toContain(esc(c.party.did.wentAlong));
    expect(html).toContain(esc(c.party.did.finished(c.tasks.glasses)));
  });

  it("plays the photo flourish once it appears, and not without a completion", () => {
    expect(count(party("ja"), 'class="lp-celebrate"')).toBe(1);
    expect(party("ja", 0)).not.toContain("lp-celebrate");
  });

  it("is not shown before 4 of 4, and no stickers show at the start", () => {
    const html = render("ja");
    expect(html).not.toContain("lp-party");
    expect(html).not.toContain('class="lp-thank"');
  });

  it("keeps the flourish and the sticker pop off with reduced motion", () => {
    const css = readFileSync(new URL("./landing.css", import.meta.url), "utf8");
    const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  /* A 220ms"));
    expect(css).toMatch(/\n\.lp-celebrate \{\s*display: none;\s*\}/);
    expect(motion).toMatch(/\.lp-sticker\[data-pop\] \{\s*animation: lp-pop/);
    const outside = css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference) {\n  /* A 220ms"));
    expect(outside).not.toMatch(/\.lp-sticker\[data-pop\][^{]*\{[^}]*animation/);
  });
});

describe("「今週のありがとう」 board", () => {
  const board = (state: ExampleState, lang: "ja" | "en" = "ja") =>
    renderToStaticMarkup(<ThanksBoard state={state} copy={EXAMPLE_COPY[lang]} />);
  /** [rank label, name, count] per row, and whether the row has the award. */
  const rows = (html: string) =>
    [...html.matchAll(/<li class="lp-board__row"( data-best="true")?>(.*?)<\/li>/g)].map((m) => ({
      rank: m[2].match(/lp-board__rank">([^<]*)</)?.[1],
      name: m[2].match(/lp-board__name">([^<]*)</)?.[1],
      count: m[2].match(/lp-board__count">([^<]*)</)?.[1],
      best: Boolean(m[1]) && m[2].includes("lp-board__best"),
    }));
  const yuiTwoMisaOneKentaOne = (finished: boolean) => {
    let s = ok(saveClinic(ok(claim(initialExample(), "clinic", "yui")), "みどり台クリニック", "yui"));
    s = ok(complete(ok(claim(s, "glasses", "yui")), "glasses", "yui"));
    s = ok(complete(s, "card", "misa"));
    s = ok(confirm(ok(claim(s, "visit", "yui")), "visit", "misa"));
    return finished ? ok(complete(s, "visit", "kenta")) : s;
  };

  it.each(["ja", "en"] as const)("%s: keeps the title, says it is this made-up note, and is empty at 0 of 4", (lang) => {
    const html = board(initialExample(), lang);
    const t = EXAMPLE_COPY[lang].thanks;
    expect(html).toContain(esc(t.title));
    expect(html).toContain(esc(t.scope));
    expect(html).toContain(esc(t.empty));
    expect(html).not.toContain("lp-board__row");
    expect(render(lang)).toContain(esc(t.empty));
    expect(render(lang)).not.toMatch(/見本|Sample/);
  });

  it("shows face, name, count, and shared ranks, with no award before 4 of 4", () => {
    const html = board(yuiTwoMisaOneKentaOne(false));
    expect(rows(html)).toEqual([
      { rank: "1位", name: "ユイ", count: "2つ完了", best: false },
      { rank: "2位", name: "ミサ", count: "1つ完了", best: false },
    ]);
    expect(html).not.toContain("ベストサポーター");
    expect(count(html, 'class="lp-avatar lp-avatar--small"')).toBe(2);
  });

  it("at 4 of 4 shows 1位, 同率2位, 同率2位 and gives Yui the award", () => {
    expect(rows(board(yuiTwoMisaOneKentaOne(true)))).toEqual([
      { rank: "1位", name: "ユイ", count: "2つ完了", best: true },
      { rank: "同率2位", name: "ミサ", count: "1つ完了", best: false },
      { rank: "同率2位", name: "ケンタ", count: "1つ完了", best: false },
    ]);
    expect(rows(board(yuiTwoMisaOneKentaOne(true), "en"))).toEqual([
      { rank: "1st", name: "Yui", count: "2 tasks done", best: true },
      { rank: "Tied 2nd", name: "Misa", count: "1 task done", best: false },
      { rank: "Tied 2nd", name: "Kenta", count: "1 task done", best: false },
    ]);
  });

  it("gives the award to each joint first at 4 of 4", () => {
    let s = ok(saveClinic(ok(claim(initialExample(), "clinic", "misa")), "みどり台クリニック", "misa"));
    s = ok(complete(s, "card", "misa"));
    s = ok(complete(ok(claim(s, "glasses", "kenta")), "glasses", "kenta"));
    s = ok(complete(ok(confirm(ok(claim(s, "visit", "yui")), "visit", "misa")), "visit", "kenta"));
    expect(rows(board(s))).toEqual([
      { rank: "同率1位", name: "ミサ", count: "2つ完了", best: true },
      { rank: "同率1位", name: "ケンタ", count: "2つ完了", best: true },
    ]);
  });

  it("leaves stickers and the family celebration as they were", () => {
    const s = yuiTwoMisaOneKentaOne(true);
    const before = board(s);
    const thanks = sendThanks(s, [], "clinic", "kenta", "helped");
    expect(thanks.ok).toBe(true);
    expect(board(s)).toBe(before);
    if (thanks.ok) expect(thanksBlock(s, "clinic", "kenta", thanks.thanks)).toContain("ケンタからユイへ");
    const party = renderToStaticMarkup(<FamilyParty state={s} copy={EXAMPLE_COPY.ja} idBase="p" celebration={4} />);
    expect(party).toContain("みんなでできた！");
  });
});

describe("the start bar at the top of the example", () => {
  const clinic = (s: ExampleState) => findTask(s, "clinic");

  it.each(["ja", "en"] as const)("%s: shows who you act as (Yui) and 「病院名を確認する」 first", (lang) => {
    const html = render(lang);
    const c = EXAMPLE_COPY[lang];
    const bar = html.match(/<div class="lp-app__bar">(.*?)<\/div><div class="lp-app__body">/)?.[1] ?? "";
    expect(bar).toContain(esc(c.start.actingAs(c.people.yui)));
    expect(bar).toMatch(new RegExp(`<button[^>]*lp-app__start[^>]*>${esc(c.tasks.clinic)}<span class="lp-sr">`));
    // The bar comes before the photo, the note preview, and the tasks.
    expect(html.indexOf("lp-app__start")).toBeLessThan(html.indexOf("lp-app__photo"));
    expect(html).toContain("lp-app__note");
  });

  it("keeps the real capture page out of the made-up example", () => {
    for (const lang of ["ja", "en"] as const) expect(render(lang)).not.toContain("/family/capture");
  });

  it("claims the clinic for whoever is selected, then goes to the field, and never fills it in", () => {
    for (const actor of ["misa", "kenta", "yui"] as const) {
      expect(clinicStart(clinic(initialExample()), actor)).toBe("claim");
      // The start button runs this same claim; nothing else changes and no name is typed.
      const s = ok(claim(initialExample(), "clinic", actor));
      expect(clinic(s)?.holders.owner).toBe(actor);
      expect(clinic(s)?.status).toBe("in_progress");
      expect(findTask(s, "visit")?.missingHospital?.name).toBeNull();
      expect(clinicStart(clinic(s), actor)).toBe("fill");
    }
  });

  it("follows the current state: shows someone else's clinic task, and goes away once it is done", () => {
    const yuis = ok(claim(initialExample(), "clinic", "yui"));
    expect(clinicStart(clinic(yuis), "kenta")).toBe("show");
    const done = ok(saveClinic(yuis, "みどり台クリニック", "yui"));
    expect(clinicStart(clinic(done), "yui")).toBeNull();
    expect(clinicStart(clinic(done), "kenta")).toBeNull();
  });
});

describe("the visit card's next step", () => {
  /** The "missing" lines on a card, in order. */
  const missing = (html: string) => [...html.matchAll(/lp-task__missing">.*?<strong>([^<]*)<\/strong>/g)].map((m) => m[1]);

  it.each(["ja", "en"] as const)("%s: at first names both the missing clinic and the missing companion", (lang) => {
    const c = EXAMPLE_COPY[lang];
    const html = visitCard(initialExample(), "yui", lang);
    expect(missing(html)).toEqual([esc(c.missingHospital), esc(c.missingCompanion)]);
    expect(completeButton(html).reason).toContain(esc(c.completeBlocked.missing(true, true)));
  });

  it("offers 「付き添いを引き受ける」 on the visit, and the plain claim on other cards", () => {
    const html = visitCard(initialExample(), "yui");
    expect(html).toMatch(
      /data-focus="visit:claim"><span class="lp-sr">「通院に付き添う」の<\/span>付き添いを引き受ける<\/button>/,
    );
    expect(visitCard(initialExample(), "yui", "en")).toMatch(
      /data-focus="visit:claim">Go as her companion<span class="lp-sr">: Go with her to the clinic<\/span><\/button>/,
    );
    expect(taskCard(initialExample(), "glasses", "yui")).toMatch(/data-focus="glasses:claim">.*>引き受ける</);
  });

  it("after the clinic is saved, still waits for a companion, with no way to confirm", () => {
    for (const actor of ["misa", "kenta", "yui"] as const) {
      const html = visitCard(withClinic(), actor);
      expect(missing(html)).toEqual([EXAMPLE_COPY.ja.missingCompanion]);
      expect(completeButton(html).reason).toContain(EXAMPLE_COPY.ja.completeBlocked.missing(false, true));
      expect(html).not.toContain('data-focus="visit:confirm"');
      expect(html).not.toContain('data-focus="visit:switch"');
    }
  });

  it("with clinic and companion set, highlights the switch to Misa", () => {
    const html = visitCard(ready(), "yui");
    expect(missing(html)).toEqual([]);
    expect(html).toMatch(/<button type="button" class="lp-btn lp-btn--navy lp-btn--task" data-focus="visit:switch"[^>]*>ミサに切り替える/);
  });

  it.each(["ja", "en"] as const)("%s: then shows 「ミサとして確認する」 to Misa", (lang) => {
    const html = visitCard(ready(), "misa", lang);
    const label = EXAMPLE_COPY[lang].confirmAs(EXAMPLE_COPY[lang].people.misa);
    expect(html).toMatch(new RegExp(`data-focus="visit:confirm">.*${label}`));
    expect(label).toBe(lang === "ja" ? "ミサとして確認する" : "Confirm as Misa");
  });

  it("shows the real driver, companion, and owner on the finished card", () => {
    const html = visitCard(ok(complete(confirmed(), "visit", "kenta")), "kenta");
    const roles = [...html.matchAll(/<dt>([^<]*)<\/dt><dd>.*?lp-task__holder">([^<]*)</g)].map((m) => [m[1], m[2]]);
    expect(roles).toEqual([
      ["送迎", "ケンタ"],
      ["付き添い", "ユイ"],
      ["担当", "ケンタ"],
    ]);
    expect(html).not.toContain(EXAMPLE_COPY.ja.status.unassigned);
    expect(html).not.toContain(EXAMPLE_COPY.ja.missingCompanion);
  });
});
