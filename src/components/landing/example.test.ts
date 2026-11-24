import { describe, expect, it } from "vitest";
import { cardShortcut } from "./care-example";
import { EXAMPLE_COPY, IMAGES } from "./content";
import {
  allDone,
  alwaysShowsComplete,
  awaitsConfirmation,
  canComplete,
  canConfirm,
  canFillClinic,
  canRelease,
  claim,
  clinicUnknown,
  companionMissing,
  complete,
  completionBlock,
  confirm,
  contributions,
  DEFAULT_PERSON,
  dropClaim,
  dropTargets,
  grandmaPhotoIndex,
  holderOf,
  initialExample,
  isAvailable,
  isConfirmed,
  isNewCompletion,
  leaderboard,
  parseClinicName,
  PEOPLE,
  PRIMARY,
  progress,
  release,
  removeThanks,
  saveClinic,
  sendThanks,
  sentThanks,
  STICKERS,
  thanksOn,
  thanksRecipient,
  waitingOn,
  type ExampleResult,
  type ExampleState,
  type PersonId,
  type TaskId,
  type ThanksList,
} from "./example";

const EVERYONE: PersonId[] = ["misa", "kenta", "yui"];
const CLINIC = "みどり台クリニック";

function task(state: ExampleState, id: TaskId) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
}

function ok(r: ExampleResult): ExampleState {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.state;
}

/** Clinic saved by Yui, but nobody going along yet. */
const withClinic = () => ok(saveClinic(ok(claim(initialExample(), "clinic", "yui")), CLINIC, "yui"));
/** Clinic saved, and Yui going along: ready for Misa to confirm. */
const ready = () => ok(claim(withClinic(), "visit", "yui"));

function photoFor(state: ExampleState): string {
  return IMAGES.grandmaByDone[grandmaPhotoIndex(progress(state).done)];
}

describe("landing example: starting state", () => {
  it("has exactly four tasks, one per line of the note, and nothing done", () => {
    const s = initialExample();
    expect(s.tasks.map((t) => t.id)).toEqual(["card", "clinic", "visit", "glasses"]);
    expect(progress(s)).toEqual({ done: 0, total: 4 });
    expect(s.tasks.map((t) => t.noteLine).sort()).toEqual([0, 1, 2, 3]);
    const transcript = EXAMPLE_COPY.ja.note.transcript;
    expect(transcript[task(s, "visit").noteLine]).toBe("11/27（金）14:30 通院");
    expect(transcript[task(s, "clinic").noteLine]).toBe("病院はミサに聞く");
    expect(transcript[task(s, "card").noteLine]).toBe("保険証");
    expect(transcript[task(s, "glasses").noteLine]).toBe("帰りに眼鏡");
  });

  it("names the fourth task in both languages", () => {
    expect(EXAMPLE_COPY.ja.tasks.clinic).toBe("病院名を確認する");
    expect(EXAMPLE_COPY.en.tasks.clinic).toBe("Confirm the clinic");
  });

  it("takes the date and time from the note and invents no deadline", () => {
    expect(EXAMPLE_COPY.ja.event.date).toBe("11月27日（金）14:30");
    expect(EXAMPLE_COPY.en.event.date).toBe("Fri, Nov 27, 2:30 PM");
    expect(EXAMPLE_COPY.ja.event.dateSource).toBe("メモより");
    // No task carries a due time: nothing in the example is derived from the note's time.
    for (const t of initialExample().tasks) expect(t).not.toHaveProperty("taskDue");
  });

  it("leaves the clinic unknown, with Misa only as the person to ask, not an owner", () => {
    const s = initialExample();
    const clinic = task(s, "clinic");
    expect(clinic.askPerson).toBe("misa");
    expect(clinic.holders).toEqual({ owner: null, driver: null, companion: null });
    expect(clinic.status).toBe("open");
    expect(clinic.approvalRequired).toBe(false);
    const visit = task(s, "visit");
    expect(visit.missingHospital).toEqual({ name: null, askPerson: "misa", filledBy: null });
    expect(clinicUnknown(visit)).toBe(true);
    expect(waitingOn(visit)).toEqual({ kind: "clinic" });
  });

  it("has Misa on the insurance card and Kenta owning and driving the visit, with the companion free", () => {
    const s = initialExample();
    expect(holderOf(task(s, "card"))).toBe("misa");
    const visit = task(s, "visit");
    expect(visit.holders).toEqual({ owner: "kenta", driver: "kenta", companion: null });
    expect(awaitsConfirmation(visit)).toBe(true);
    expect(holderOf(task(s, "glasses"))).toBeNull();
  });

  it("starts as Yui, with Misa as the only primary caregiver", () => {
    expect(DEFAULT_PERSON).toBe("yui");
    expect(PRIMARY).toBe("misa");
    expect(PEOPLE.filter((p) => p.role === "primary_caregiver").map((p) => p.id)).toEqual(["misa"]);
  });

  it("highlights the same three free slots for every person", () => {
    for (const person of EVERYONE) {
      expect(dropTargets(initialExample(), person)).toEqual(["clinic", "visit", "glasses"]);
      expect(isAvailable(task(initialExample(), "card"), person)).toBe(false);
    }
  });
});

describe("landing example: claiming by button or by dropping a face", () => {
  it.each(EVERYONE)("a drop of %s's face claims each free task for that person only", (person) => {
    let s = initialExample();
    s = ok(dropClaim(s, "glasses", person));
    expect(task(s, "glasses").holders.owner).toBe(person);
    s = ok(dropClaim(s, "clinic", person));
    expect(task(s, "clinic").holders.owner).toBe(person);
    s = ok(dropClaim(s, "visit", person));
    expect(task(s, "visit").holders).toEqual({ owner: "kenta", driver: "kenta", companion: person });
    // Nobody else was touched, and nothing is done.
    expect(holderOf(task(s, "card"))).toBe("misa");
    expect(progress(s).done).toBe(0);
  });

  it.each(EVERYONE)("a drop and the button give the same result for %s", (person) => {
    for (const id of ["clinic", "visit", "glasses"] as const) {
      expect(dropClaim(initialExample(), id, person)).toEqual(claim(initialExample(), id, person));
    }
  });

  it("changes nothing when a face is let go away from any task", () => {
    expect(dropClaim(initialExample(), null, "yui")).toEqual({ ok: false, code: "no_target" });
  });

  it("refuses a drop on a task someone already has, and keeps its owner", () => {
    const s = ok(dropClaim(initialExample(), "glasses", "kenta"));
    expect(dropClaim(s, "glasses", "yui")).toEqual({ ok: false, code: "already_claimed" });
    expect(dropClaim(s, "card", "kenta")).toEqual({ ok: false, code: "already_claimed" });
    expect(task(s, "glasses").holders.owner).toBe("kenta");
    expect(dropTargets(s, "yui")).toEqual(["clinic", "visit"]);
  });

  it("refuses a drop on a finished task", () => {
    const s = ok(complete(initialExample(), "card", "misa"));
    expect(dropClaim(s, "card", "yui")).toEqual({ ok: false, code: "part_closed" });
  });

  it("keeps a high-risk task awaiting confirmation after a claim", () => {
    const s = ok(claim(initialExample(), "visit", "yui"));
    const visit = task(s, "visit");
    expect(visit.approvalState).toBe("pending");
    expect(canComplete(visit, "kenta")).toBe(false);
    expect(progress(s).done).toBe(0);
  });

  it("can be undone by the person who claimed it, and only by them", () => {
    const claimed = ok(claim(initialExample(), "visit", "yui"));
    expect(canRelease(task(claimed, "visit"), "yui")).toBe(true);
    expect(canRelease(task(claimed, "visit"), "misa")).toBe(false);
    expect(release(claimed, "visit", "misa")).toEqual({ ok: false, code: "not_holder" });
    const back = ok(release(claimed, "visit", "yui"));
    expect(task(back, "visit")).toEqual(task(initialExample(), "visit"));
  });
});

describe("landing example: confirming the clinic", () => {
  it("only the owner can save a clinic name, after claiming the task", () => {
    const s = initialExample();
    expect(canFillClinic(task(s, "clinic"), "misa")).toBe(false);
    expect(saveClinic(s, CLINIC, "misa")).toEqual({ ok: false, code: "not_owner" });
    const claimed = ok(claim(s, "clinic", "yui"));
    expect(canFillClinic(task(claimed, "clinic"), "yui")).toBe(true);
    expect(saveClinic(claimed, CLINIC, "kenta")).toEqual({ ok: false, code: "not_owner" });
  });

  it("cannot be marked as done without a clinic name", () => {
    const claimed = ok(claim(initialExample(), "clinic", "yui"));
    expect(canComplete(task(claimed, "clinic"), "yui")).toBe(false);
    expect(complete(claimed, "clinic", "yui")).toEqual({ ok: false, code: "clinic_name_required" });
  });

  it("says exactly what is wrong with the name", () => {
    expect(parseClinicName("")).toEqual({ ok: false, code: "clinic_name_required" });
    expect(parseClinicName("   ")).toEqual({ ok: false, code: "clinic_name_required" });
    expect(parseClinicName("あ".repeat(201))).toEqual({ ok: false, code: "clinic_name_too_long" });
    expect(parseClinicName(`  ${CLINIC} `)).toEqual({ ok: true, name: CLINIC });
    const claimed = ok(claim(initialExample(), "clinic", "kenta"));
    expect(saveClinic(claimed, " ", "kenta")).toEqual({ ok: false, code: "clinic_name_required" });
    expect(task(claimed, "clinic").status).toBe("in_progress");
  });

  it("completes the clarification and fills in the visit's clinic, without confirming the visit", () => {
    const claimed = ok(claim(initialExample(), "clinic", "kenta"));
    const s = ok(saveClinic(claimed, ` ${CLINIC} `, "kenta"));
    expect(task(s, "clinic").status).toBe("completed");
    expect(progress(s).done).toBe(1);
    const visit = task(s, "visit");
    expect(visit.missingHospital).toEqual({ name: CLINIC, askPerson: "misa", filledBy: "kenta" });
    expect(visit.approvalState).toBe("pending");
    expect(visit.status).toBe("in_progress");
    // Next the visit needs someone going along, before Misa can confirm.
    expect(waitingOn(visit)).toEqual({ kind: "companion" });
    expect(saveClinic(s, "別の名前", "kenta")).toEqual({ ok: false, code: "part_closed" });
  });
});

describe("landing example: the visit needs the clinic, a companion, Misa's confirmation, then Kenta", () => {
  it("cannot be confirmed while the clinic is unknown", () => {
    const visit = task(initialExample(), "visit");
    expect(canConfirm(visit, "misa")).toBe(false);
    expect(confirm(initialExample(), "visit", "misa")).toEqual({ ok: false, code: "clinic_unknown" });
  });

  it("reproduces the walkthrough that reached done with nobody going along, and now stops it", () => {
    // Clinic saved, companion 未担当: this used to be confirmable and then completable.
    const s = withClinic();
    const visit = task(s, "visit");
    expect(companionMissing(visit)).toBe(true);
    expect(canConfirm(visit, "misa")).toBe(false);
    expect(confirm(s, "visit", "misa")).toEqual({ ok: false, code: "companion_missing" });
    expect(cardShortcut(visit, "yui")).toBeNull();
    expect(canComplete(visit, "kenta")).toBe(false);
    expect(complete(s, "visit", "kenta")).toEqual({ ok: false, code: "approval_pending" });
    // Even an approved visit with nobody going along cannot be finished.
    const approvedAlone: ExampleState = {
      tasks: s.tasks.map((t) => (t.id === "visit" ? { ...t, approvalState: "approved" } : t)),
    };
    expect(canComplete(task(approvedAlone, "visit"), "kenta")).toBe(false);
    expect(complete(approvedAlone, "visit", "kenta")).toEqual({ ok: false, code: "companion_missing" });
    expect(progress(s).done).toBe(1);
  });

  it("gets a companion only from someone's own claim, never assigned", () => {
    const s = ready();
    expect(task(s, "visit").holders).toEqual({ owner: "kenta", driver: "kenta", companion: "yui" });
    expect(task(withClinic(), "visit").holders.companion).toBeNull();
  });

  it("can be confirmed only by Misa, the primary caregiver", () => {
    const s = ready();
    expect(canConfirm(task(s, "visit"), "misa")).toBe(true);
    for (const person of ["kenta", "yui"] as const) {
      expect(canConfirm(task(s, "visit"), person)).toBe(false);
      expect(confirm(s, "visit", person)).toEqual({ ok: false, code: "not_primary_caregiver" });
    }
  });

  it("cannot be marked as done before Misa confirms it", () => {
    const s = ready();
    expect(canComplete(task(s, "visit"), "kenta")).toBe(false);
    expect(complete(s, "visit", "kenta")).toEqual({ ok: false, code: "approval_pending" });
  });

  it("after Misa confirms, only Kenta as owner can mark it as done", () => {
    const confirmed = ok(confirm(ready(), "visit", "misa"));
    const visit = task(confirmed, "visit");
    expect(isConfirmed(visit)).toBe(true);
    expect(visit.status).toBe("in_progress");
    expect(progress(confirmed).done).toBe(1);
    expect(confirm(confirmed, "visit", "misa")).toEqual({ ok: false, code: "already_confirmed" });
    expect(waitingOn(visit)).toEqual({ kind: "owner", by: "kenta" });
    for (const person of ["misa", "yui"] as const) {
      expect(canComplete(visit, person)).toBe(false);
      expect(complete(confirmed, "visit", person)).toEqual({ ok: false, code: "not_owner" });
    }
    const done = ok(complete(confirmed, "visit", "kenta"));
    expect(task(done, "visit").status).toBe("completed");
    expect(task(done, "visit").holders).toEqual({ owner: "kenta", driver: "kenta", companion: "yui" });
    expect(progress(done).done).toBe(2);
  });

  it("needs confirming again when the companion changes after Misa confirmed (current role rules)", () => {
    const confirmed = ok(confirm(ready(), "visit", "misa"));
    const left = ok(release(confirmed, "visit", "yui"));
    expect(awaitsConfirmation(task(left, "visit"))).toBe(true);
    expect(confirm(left, "visit", "misa")).toEqual({ ok: false, code: "companion_missing" });
    const joined = ok(dropClaim(left, "visit", "misa"));
    expect(task(joined, "visit").holders.companion).toBe("misa");
    expect(awaitsConfirmation(task(joined, "visit"))).toBe(true);
    expect(complete(joined, "visit", "kenta")).toEqual({ ok: false, code: "approval_pending" });
  });

  it("is not something low-risk tasks need", () => {
    expect(confirm(initialExample(), "glasses", "misa")).toEqual({ ok: false, code: "approval_not_required" });
    expect(canConfirm(task(initialExample(), "card"), "misa")).toBe(false);
  });
});

describe("landing example: why the visit cannot be marked as done yet", () => {
  it("always shows 「完了にする」 only on the unfinished visit", () => {
    const s = initialExample();
    expect(s.tasks.filter(alwaysShowsComplete).map((t) => t.id)).toEqual(["visit"]);
  });

  it("names the clinic and the companion first, for everyone", () => {
    for (const person of EVERYONE) {
      expect(completionBlock(task(initialExample(), "visit"), person)).toEqual({ kind: "missing", clinic: true, companion: true });
      expect(completionBlock(task(withClinic(), "visit"), person)).toEqual({ kind: "missing", clinic: false, companion: true });
    }
    const along = ok(claim(initialExample(), "visit", "yui"));
    expect(completionBlock(task(along, "visit"), "kenta")).toEqual({ kind: "missing", clinic: true, companion: false });
  });

  it("then waits for Misa, also while Misa can press 「ミサとして確認する」", () => {
    const visit = task(ready(), "visit");
    expect(canConfirm(visit, "misa")).toBe(true);
    for (const person of EVERYONE) expect(completionBlock(visit, person)).toEqual({ kind: "confirm", by: "misa" });
  });

  it("then only Kenta, the owner, can finish it", () => {
    const visit = task(ok(confirm(ready(), "visit", "misa")), "visit");
    expect(completionBlock(visit, "misa")).toEqual({ kind: "owner", by: "kenta" });
    expect(completionBlock(visit, "yui")).toEqual({ kind: "owner", by: "kenta" });
    expect(completionBlock(visit, "kenta")).toBeNull();
    expect(canComplete(visit, "kenta")).toBe(true);
  });

  it("goes back to the missing companion, then to Misa, when the companion changes after she confirmed", () => {
    const left = ok(release(ok(confirm(ready(), "visit", "misa")), "visit", "yui"));
    expect(completionBlock(task(left, "visit"), "kenta")).toEqual({ kind: "missing", clinic: false, companion: true });
    const joined = ok(claim(left, "visit", "misa"));
    expect(completionBlock(task(joined, "visit"), "kenta")).toEqual({ kind: "confirm", by: "misa" });
  });

  it("is never blocked when the guard allows it, and nothing shows once done", () => {
    const done = ok(complete(ok(confirm(ready(), "visit", "misa")), "visit", "kenta"));
    const visit = task(done, "visit");
    expect(alwaysShowsComplete(visit)).toBe(false);
    for (const person of EVERYONE) expect(completionBlock(visit, person)).toBeNull();
  });
});

describe("landing example: all four tasks can be finished", () => {
  it("follows the suggested path to 4 of 4, with one new photo per completed task", () => {
    const seen: string[] = [];
    const counts: number[] = [];
    const completions: boolean[] = [];
    let s = initialExample();
    const step = (next: ExampleState) => {
      completions.push(isNewCompletion(s, next));
      s = next;
      seen.push(photoFor(s));
      counts.push(progress(s).done);
    };

    step(ok(dropClaim(s, "clinic", "yui"))); // Yui takes the clinic question
    step(ok(saveClinic(s, CLINIC, "yui"))); // ...asks Misa and saves the name
    step(ok(dropClaim(s, "visit", "yui"))); // Yui goes along
    step(ok(dropClaim(s, "glasses", "yui"))); // ...and picks up the glasses
    step(ok(complete(s, "glasses", "yui")));
    step(ok(complete(s, "card", "misa")));
    step(ok(confirm(s, "visit", "misa")));
    step(ok(complete(s, "visit", "kenta")));

    expect(counts).toEqual([0, 1, 1, 1, 2, 3, 3, 4]);
    expect(completions).toEqual([false, true, false, false, true, true, false, true]);
    expect(seen).toEqual([
      "/landing/grandma-ready.png",
      "/landing/grandma-task-1.png",
      "/landing/grandma-task-1.png",
      "/landing/grandma-task-1.png",
      "/landing/grandma-task-2.png",
      "/landing/grandma-task-3.png",
      "/landing/grandma-task-3.png",
      "/landing/grandma-task-4.png",
    ]);
    expect(progress(s)).toEqual({ done: 4, total: 4 });
    expect(s.tasks.every((t) => t.status === "completed")).toBe(true);
    expect(dropTargets(s, "yui")).toEqual([]);
  });

});

describe("Grandma's photo", () => {
  it("maps 0, 1, 2, 3, 4 completed tasks to the ready photo and the four new photos", () => {
    expect([0, 1, 2, 3, 4].map((n) => IMAGES.grandmaByDone[grandmaPhotoIndex(n)])).toEqual([
      "/landing/grandma-ready.png",
      "/landing/grandma-task-1.png",
      "/landing/grandma-task-2.png",
      "/landing/grandma-task-3.png",
      "/landing/grandma-task-4.png",
    ]);
    expect(grandmaPhotoIndex(-1)).toBe(0);
    expect(grandmaPhotoIndex(9)).toBe(4);
  });

  it("has a description for each photo in both languages", () => {
    for (const lang of ["ja", "en"] as const) {
      const alts = EXAMPLE_COPY[lang].photoAlt;
      expect(alts).toHaveLength(5);
      expect(new Set(alts).size).toBe(5);
    }
  });
});

describe("landing example: what does not count as completion", () => {
  it("claiming, confirming, dropping, and releasing never add a completed task", () => {
    const s0 = ok(saveClinic(ok(claim(initialExample(), "clinic", "misa")), CLINIC, "misa"));
    const claimed = ok(claim(s0, "glasses", "yui"));
    const dropped = ok(dropClaim(claimed, "visit", "kenta"));
    const along = ok(claim(s0, "visit", "yui"));
    const confirmed = ok(confirm(along, "visit", "misa"));
    const released = ok(release(claimed, "glasses", "yui"));
    for (const [prev, next] of [
      [s0, claimed],
      [claimed, dropped],
      [s0, along],
      [along, confirmed],
      [claimed, released],
    ] as const) {
      expect(isNewCompletion(prev, next)).toBe(false);
    }
  });

  it("starting over goes back to the first state, 0 of 4, and is not a completion", () => {
    let s = initialExample();
    s = ok(complete(s, "card", "misa"));
    s = ok(complete(ok(claim(s, "glasses", "yui")), "glasses", "yui"));
    expect(progress(s).done).toBe(2);
    const fresh = initialExample();
    expect(isNewCompletion(s, fresh)).toBe(false);
    expect(progress(fresh)).toEqual({ done: 0, total: 4 });
    expect(photoFor(fresh)).toBe("/landing/grandma-ready.png");
    expect(fresh).toEqual(initialExample());
  });
});

/** The suggested path to 4 of 4: Yui does the clinic, goes along, and gets the glasses; Misa the card; Kenta the visit. */
function fullRun(): ExampleState {
  let s = initialExample();
  s = ok(claim(s, "clinic", "yui"));
  s = ok(saveClinic(s, CLINIC, "yui"));
  s = ok(claim(s, "visit", "yui"));
  s = ok(claim(s, "glasses", "yui"));
  s = ok(complete(s, "glasses", "yui"));
  s = ok(complete(s, "card", "misa"));
  s = ok(confirm(s, "visit", "misa"));
  s = ok(complete(s, "visit", "kenta"));
  return s;
}

function sent(r: ReturnType<typeof sendThanks>): ThanksList {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.thanks;
}

describe("thank-you stickers", () => {
  it("offers exactly three stickers", () => {
    expect(STICKERS).toEqual(["helped", "ride", "hardWork"]);
    expect(EXAMPLE_COPY.ja.stickers.label).toEqual({ helped: "助かった！", ride: "送迎ありがとう", hardWork: "おつかれさま" });
    expect(Object.keys(EXAMPLE_COPY.en.stickers.label)).toEqual([...STICKERS]);
  });

  it("works on the demo path: Yui does the clinic, Kenta finishes the visit, then thanks Yui", () => {
    let s = initialExample();
    s = ok(claim(s, "clinic", "yui"));
    s = ok(saveClinic(s, CLINIC, "yui"));
    s = ok(claim(s, "visit", "yui"));
    s = ok(confirm(s, "visit", "misa"));
    s = ok(complete(s, "visit", "kenta"));
    expect(thanksRecipient(task(s, "clinic"), "kenta")).toBe("yui");
    const thanks = sent(sendThanks(s, [], "clinic", "kenta", "helped"));
    expect(thanks).toEqual([{ task: "clinic", from: "kenta", to: "yui", sticker: "helped" }]);
  });

  it("goes only to another person's finished task, addressed to its owner", () => {
    const s = fullRun();
    expect(thanksRecipient(task(s, "visit"), "yui")).toBe("kenta");
    expect(thanksRecipient(task(s, "card"), "kenta")).toBe("misa");
    expect(thanksRecipient(task(s, "clinic"), "yui")).toBeNull();
    expect(sendThanks(s, [], "clinic", "yui", "helped")).toEqual({ ok: false, code: "thanks_not_allowed" });
    const unfinished = ok(claim(initialExample(), "glasses", "yui"));
    expect(thanksRecipient(task(unfinished, "glasses"), "kenta")).toBeNull();
    expect(sendThanks(unfinished, [], "glasses", "kenta", "helped")).toEqual({ ok: false, code: "thanks_not_allowed" });
  });

  it("keeps one sticker per sender per task, which can be changed or removed", () => {
    const s = fullRun();
    let list = sent(sendThanks(s, [], "clinic", "kenta", "helped"));
    list = sent(sendThanks(s, list, "clinic", "misa", "hardWork"));
    list = sent(sendThanks(s, list, "visit", "yui", "ride"));
    list = sent(sendThanks(s, list, "clinic", "kenta", "ride"));
    expect(thanksOn(list, "clinic")).toEqual([
      { task: "clinic", from: "kenta", to: "yui", sticker: "ride" },
      { task: "clinic", from: "misa", to: "yui", sticker: "hardWork" },
    ]);
    list = removeThanks(list, "clinic", "kenta");
    expect(sentThanks(list, "clinic", "kenta")).toBeNull();
    expect(sentThanks(list, "clinic", "misa")?.sticker).toBe("hardWork");
    expect(sentThanks(list, "visit", "yui")?.sticker).toBe("ride");
  });

  it("never changes progress, owners, or approval", () => {
    const s = fullRun();
    const before = structuredClone(s);
    let list = sent(sendThanks(s, [], "clinic", "kenta", "helped"));
    list = sent(sendThanks(s, list, "clinic", "kenta", "hardWork"));
    removeThanks(list, "clinic", "kenta");
    expect(s).toEqual(before);
    expect(progress(s)).toEqual({ done: 4, total: 4 });
  });

  it("starts empty after starting over, because stickers live outside the task state", () => {
    expect(initialExample()).not.toHaveProperty("thanks");
  });
});

describe("the family celebration at 4 of 4", () => {
  it("appears only when every task is done", () => {
    expect(allDone(initialExample())).toBe(false);
    expect(allDone(fullRun())).toBe(true);
  });

  it("lists what each person really did in this run", () => {
    expect(contributions(fullRun())).toEqual([
      { person: "misa", items: [{ kind: "finished", task: "card" }, { kind: "confirmed" }] },
      { person: "kenta", items: [{ kind: "finished", task: "visit" }, { kind: "drove" }] },
      {
        person: "yui",
        items: [{ kind: "finished", task: "clinic" }, { kind: "finished", task: "glasses" }, { kind: "went_along" }],
      },
    ]);
  });

  it("leaves out someone who did nothing, and makes nothing up", () => {
    let s = initialExample();
    s = ok(claim(s, "clinic", "kenta"));
    s = ok(saveClinic(s, CLINIC, "kenta"));
    s = ok(complete(ok(claim(s, "glasses", "kenta")), "glasses", "kenta"));
    s = ok(complete(s, "card", "misa"));
    // Misa goes along herself, so Yui has done nothing in this run.
    s = ok(complete(ok(confirm(ok(claim(s, "visit", "misa")), "visit", "misa")), "visit", "kenta"));
    expect(allDone(s)).toBe(true);
    expect(contributions(s).map((c) => c.person)).toEqual(["misa", "kenta"]);
  });

  it("names each contribution in both languages", () => {
    for (const lang of ["ja", "en"] as const) {
      const d = EXAMPLE_COPY[lang].party.did;
      expect([d.finished("x"), d.drove, d.wentAlong, d.confirmed].every((t) => t.length > 0)).toBe(true);
    }
    expect(EXAMPLE_COPY.ja.party.title).toBe("みんなでできた！");
  });
});

describe("「今週のありがとう」 board", () => {
  const rowsOf = (s: ExampleState) => leaderboard(s).map(({ person, done, rank, tied, best }) => [person, done, rank, tied, best]);

  it("is empty at 0 of 4, and after starting over", () => {
    expect(leaderboard(initialExample())).toEqual([]);
  });

  it("counts one per finished task for its actual owner", () => {
    let s = ok(complete(initialExample(), "card", "misa"));
    expect(rowsOf(s)).toEqual([["misa", 1, 1, false, false]]);
    // Misa gives the card back before finishing it, Kenta takes it: the count follows the owner.
    s = ok(complete(ok(claim(ok(release(initialExample(), "card", "misa")), "card", "kenta")), "card", "kenta"));
    expect(rowsOf(s)).toEqual([["kenta", 1, 1, false, false]]);
  });

  it("gives equal counts the same rank: Yui 2, Misa 1, Kenta 1 is 1st, tied 2nd, tied 2nd", () => {
    let s = ok(saveClinic(ok(claim(initialExample(), "clinic", "yui")), CLINIC, "yui"));
    s = ok(complete(ok(claim(s, "glasses", "yui")), "glasses", "yui"));
    s = ok(complete(s, "card", "misa"));
    // Misa is alone in 2nd until Kenta also has one.
    expect(rowsOf(s)).toEqual([
      ["yui", 2, 1, false, false],
      ["misa", 1, 2, false, false],
    ]);
    // Going along adds nothing to the board; only Kenta's finished visit does.
    s = ok(complete(ok(confirm(ok(claim(s, "visit", "yui")), "visit", "misa")), "visit", "kenta"));
    expect(rowsOf(s)).toEqual([
      ["yui", 2, 1, false, true],
      ["misa", 1, 2, true, false],
      ["kenta", 1, 2, true, false],
    ]);
    expect(EXAMPLE_COPY.ja.thanks.rank(1, false)).toBe("1位");
    expect(EXAMPLE_COPY.ja.thanks.rank(2, true)).toBe("同率2位");
    expect(EXAMPLE_COPY.en.thanks.rank(1, false)).toBe("1st");
    expect(EXAMPLE_COPY.en.thanks.rank(2, true)).toBe("Tied 2nd");
  });

  it("names no Best Supporter before 4 of 4", () => {
    let s = ok(complete(initialExample(), "card", "misa"));
    s = ok(saveClinic(ok(claim(s, "clinic", "yui")), CLINIC, "yui"));
    s = ok(complete(ok(claim(s, "glasses", "yui")), "glasses", "yui"));
    expect(progress(s).done).toBe(3);
    expect(leaderboard(s).some((r) => r.best)).toBe(false);
  });

  it("names each joint first as Best Supporter at 4 of 4", () => {
    let s = ok(saveClinic(ok(claim(initialExample(), "clinic", "misa")), CLINIC, "misa"));
    s = ok(complete(s, "card", "misa"));
    s = ok(complete(ok(claim(s, "glasses", "kenta")), "glasses", "kenta"));
    s = ok(complete(ok(confirm(ok(claim(s, "visit", "yui")), "visit", "misa")), "visit", "kenta"));
    expect(rowsOf(s)).toEqual([
      ["misa", 2, 1, true, true],
      ["kenta", 2, 1, true, true],
    ]);
    expect(EXAMPLE_COPY.ja.thanks.best).toBe("ベストサポーター");
    expect(EXAMPLE_COPY.en.thanks.best).toBe("Best Supporter");
  });

  it("does not count claims, confirmation, switching person, or stickers", () => {
    let s = ok(claim(initialExample(), "clinic", "yui"));
    s = ok(claim(s, "glasses", "kenta"));
    s = ok(claim(s, "visit", "yui"));
    expect(leaderboard(s)).toEqual([]);
    s = ok(saveClinic(s, CLINIC, "yui"));
    const afterClinic = leaderboard(s);
    s = ok(confirm(s, "visit", "misa"));
    expect(leaderboard(s)).toEqual(afterClinic);
    // The board reads only the tasks; the selected person is not an input.
    expect(leaderboard.length).toBe(1);
    const thanks = sent(sendThanks(s, [], "clinic", "kenta", "helped"));
    sent(sendThanks(s, thanks, "clinic", "misa", "hardWork"));
    expect(leaderboard(s)).toEqual(afterClinic);
    expect(afterClinic).toEqual([{ person: "yui", done: 1, rank: 1, tied: false, best: false }]);
  });
});
