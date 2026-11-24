import { describe, expect, it } from "vitest";

import { REFUSAL_MESSAGE_KEYS } from "@/lib/care/rules/refusals";
import { LABEL_TEXT_EN, labelMessageKey, type ApprovalLabelKey, type RiskLabelKey } from "@/lib/care/rules/labels";
import { MISSING_DETAIL_KINDS, type MissingDetailQuestionCode } from "@/lib/care/rules/missing-details";
import { oldActionMessage } from "@/lib/care/rules/messages-en";
import { TIMELINE_LABEL_KEYS } from "@/lib/care/timeline";

import { en } from "./en";
import { ja } from "./ja";
import { formatDateTimeInZone, formatList, pluralCategory } from "./format";
import {
  assertKeysExist,
  createTranslator,
  findUnknownKeys,
  findUntranslatedKeys,
  interpolate,
  MESSAGE_KEYS,
  type Dictionaries,
  type MessageKey,
} from "./messages";

const QUESTION_CODES = {
  which_clinic: true,
  which_date: true,
  which_time: true,
  which_amount: true,
  who_will_drive: true,
  when_is_deadline: true,
  which_person: true,
  which_document: true,
  which_contact: true,
  ai_question: true,
} satisfies Record<MissingDetailQuestionCode, true>;

const LABEL_KEYS: (RiskLabelKey | ApprovalLabelKey)[] = [
  "lowPriority",
  "needsAttention",
  "highRisk",
  "requiresConfirmation",
  "confirmed",
  "notApproved",
  "done",
];

describe("keys used by the rule modules", () => {
  it("resolves every refusal key and the two signed-out and error keys", () => {
    const keys = [...Object.values(REFUSAL_MESSAGE_KEYS), "refusal.signedOut", "refusal.error"];
    assertKeysExist(keys);
    const t = createTranslator("en").t;
    for (const key of keys) expect(t(key as MessageKey).length).toBeGreaterThan(0);
  });

  it("resolves every Timeline label key", () => {
    assertKeysExist(TIMELINE_LABEL_KEYS);
    const t = createTranslator("en").t;
    for (const key of TIMELINE_LABEL_KEYS) expect(t(key as MessageKey).length).toBeGreaterThan(0);
  });

  it("resolves every label key, and LABEL_TEXT_EN reads from the dictionary", () => {
    const t = createTranslator("en").t;
    for (const key of LABEL_KEYS) {
      expect(t(labelMessageKey(key))).toBe(LABEL_TEXT_EN[key]);
    }
    expect(LABEL_TEXT_EN.highRisk).toBe("High risk");
    expect(LABEL_TEXT_EN.done).toBe("Done");
  });

  it("resolves every missing-detail question and reason key", () => {
    const keys = [
      ...Object.keys(QUESTION_CODES).map((c) => `missing.question.${c}`),
      ...MISSING_DETAIL_KINDS.map((k) => `missing.reason.${k}`),
      "missing.reason.driver",
      "missing.reason.deadline",
    ];
    expect(findUnknownKeys(keys)).toEqual([]);
  });

  it("gives the old actions their refusal text from the dictionary", () => {
    expect(oldActionMessage("refusal.signedOut")).toBe("You must be signed in.");
    expect(oldActionMessage("refusal.error")).toBe(en["refusal.error"]);
  });

  it("holds the screen strings the requirements fix", () => {
    const t = createTranslator("en").t;
    expect(t("feed.heading.needsSomeone")).toBe("Needs someone");
    expect(t("feed.heading.beingRead")).toBe("Being read");
    expect(t("missing.noDeadline")).toBe("No deadline yet");
    expect(t("feed.inAppReminder", { name: "Misa" })).toBe("Misa has an in-app reminder");
    expect(t("capture.privacy")).toContain("sent to ai& to be read");
    expect(t("capture.privacy")).toContain("authorized household members");
    expect([t("role.owner"), t("role.driver"), t("role.companion"), t("role.backup")]).toEqual([
      "Owner",
      "Driver",
      "Companion",
      "Backup",
    ]);
  });
});

describe("dictionary quality", () => {
  it("has no empty strings", () => {
    for (const key of MESSAGE_KEYS) expect(en[key].trim().length, key).toBeGreaterThan(0);
  });

  it("uses no hype words", () => {
    const forbidden =
      /\b(delve|seamless(ly)?|effortless(ly)?|leverag\w*|empower\w*|robust|cutting-edge|revolutionary|magic(al)?|supercharge\w*|unlock\w*|game-chang\w*)\b/i;
    for (const key of MESSAGE_KEYS) expect(en[key], key).not.toMatch(forbidden);
  });

  it("avoids the jargon the design rules out", () => {
    for (const key of MESSAGE_KEYS) expect(en[key], key).not.toMatch(/\b(steps?|chains?|extraction|status code)\b/i);
  });

  it("has a one and an other form for every plural", () => {
    for (const key of MESSAGE_KEYS) {
      if (key.endsWith(".one")) expect(MESSAGE_KEYS).toContain(key.replace(/\.one$/, ".other"));
    }
  });
});

describe("translator", () => {
  it("fills {param} placeholders, once", () => {
    expect(interpolate("Hi {name}, {n} left", { name: "Misa", n: 3 })).toBe("Hi Misa, 3 left");
    expect(interpolate("Hi {name}", { name: "{n}", n: 3 })).toBe("Hi {n}");
    expect(interpolate("Hi {name}", {})).toBe("Hi {name}");
  });

  it("falls back to English when a test dictionary lacks a key", () => {
    const dictionaries: Dictionaries = { en, ja: { "role.owner": "担当者" } };
    const ja = createTranslator("ja", dictionaries);
    expect(ja.t("role.owner")).toBe("担当者");
    expect(ja.t("role.driver")).toBe("Driver");
    expect(findUntranslatedKeys("ja", dictionaries)).not.toContain("role.owner");
    expect(findUntranslatedKeys("ja", dictionaries)).toContain("role.driver");
    expect(findUntranslatedKeys("en")).toEqual([]);
  });

  it("reports unknown keys", () => {
    expect(findUnknownKeys(["role.owner", "nope.nothing"])).toEqual(["nope.nothing"]);
    expect(() => assertKeysExist(["nope.nothing"])).toThrow(/nope\.nothing/);
  });

  it("picks the plural form", () => {
    const { tCount } = createTranslator("en");
    expect(tCount("feed.newUpdates", 1)).toBe("1 new update");
    expect(tCount("feed.newUpdates", 0)).toBe("0 new updates");
    expect(tCount("feed.reminders", 2)).toBe("2 reminders");
    expect(pluralCategory(1, "en")).toBe("one");
    expect(pluralCategory(5, "ja")).toBe("other");
  });
});

describe("format", () => {
  it("writes the zone name after the time", () => {
    const at = new Date("2026-11-27T05:30:00Z");
    const tokyo = formatDateTimeInZone(at, "Asia/Tokyo", "en");
    expect(tokyo).toContain("2:30 PM");
    expect(tokyo.endsWith("(Asia/Tokyo time)")).toBe(true);
    expect(formatDateTimeInZone(at, "America/New_York", "en")).toContain("12:30 AM");
  });

  it("throws for an unknown zone instead of showing a wrong time", () => {
    expect(() => formatDateTimeInZone(new Date(), "Not/AZone", "en")).toThrow(RangeError);
  });

  it("joins lists", () => {
    expect(formatList(["a", "b", "c"], "en")).toBe("a, b, and c");
    expect(formatList(["a", "b"], "en", "or")).toBe("a or b");
    expect(formatList([], "en")).toBe("");
  });
});

const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text: string) => [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))].sort();
const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/;

describe("Japanese dictionary", () => {
  it("has every key and no key English lacks", () => {
    expect(findUntranslatedKeys("ja")).toEqual([]);
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  });

  it("has no empty strings", () => {
    for (const key of MESSAGE_KEYS) expect(ja[key].trim().length, key).toBeGreaterThan(0);
  });

  it("uses the same {param} placeholders as English for every key", () => {
    for (const key of MESSAGE_KEYS) expect(placeholders(ja[key]), key).toEqual(placeholders(en[key]));
  });

  it("has no English-only leftovers in user-facing text", () => {
    for (const key of MESSAGE_KEYS) {
      const letters = en[key].replace(PLACEHOLDER, "").replace(/[^A-Za-z]/g, "");
      const brandOnly = key === "timeline.actor.system";
      if (letters.length === 0 || brandOnly) continue;
      expect(ja[key], key).toMatch(JAPANESE);
    }
  });

  it("keeps plural forms in step: one and other say the same thing", () => {
    for (const key of MESSAGE_KEYS) {
      if (key.endsWith(".one")) expect(ja[key]).toBe(ja[key.replace(/\.one$/, ".other") as MessageKey]);
    }
    expect(createTranslator("ja").tCount("feed.newUpdates", 1)).toBe("新しいお知らせが1件あります");
    expect(createTranslator("ja").tCount("feed.newUpdates", 3)).toBe("新しいお知らせが3件あります");
  });

  it("writes risk labels and approval labels as seven different words", () => {
    const texts = LABEL_KEYS.map((key) => ja[labelMessageKey(key)]);
    expect(new Set(texts).size).toBe(LABEL_KEYS.length);
    expect(ja["label.requiresConfirmation"]).toBe("確認が必要");
    expect(ja["label.confirmed"]).toBe("確認済み");
    expect(ja["label.notApproved"]).toBe("承認されていません");
    expect(ja["label.done"]).toBe("完了");
    expect([ja["label.highRisk"], ja["label.needsAttention"], ja["label.lowPriority"]]).toEqual([
      "高リスク",
      "要注意",
      "優先度低",
    ]);
  });

  it("uses the confirmation wording only on the pending approval key", () => {
    const wording = ja["label.requiresConfirmation"];
    for (const key of MESSAGE_KEYS) {
      if (key === "label.requiresConfirmation") continue;
      expect(ja[key], key).not.toBe(wording);
      if (key.startsWith("label.")) expect(ja[key], key).not.toContain(wording);
    }
  });

  it("holds the fixed sentences the requirements name", () => {
    const t = createTranslator("ja").t;
    expect(t("feed.heading.beingRead")).toBe("AIが読み取り中");
    expect(t("feed.inAppReminder", { name: "ミサ" })).toBe("ミサさんにアプリ内のお知らせがあります");
    expect(t("capture.privacy")).toContain("ai&");
    expect(t("capture.privacy")).toContain("承認された世帯メンバー");
  });

  it("avoids the jargon the design rules out", () => {
    for (const key of MESSAGE_KEYS) expect(ja[key], key).not.toMatch(/ステップ|チェーン|抽出|ステータスコード/);
  });

  it("writes Japanese dates with the zone spelled out", () => {
    const at = new Date("2026-11-27T05:30:00Z");
    expect(formatDateTimeInZone(at, "Asia/Tokyo", "ja")).toBe("2026年11月27日(金) 14:30（Asia/Tokyo 時間）");
    expect(formatDateTimeInZone(new Date("2026-11-27T00:05:00Z"), "Asia/Tokyo", "ja")).toBe(
      "2026年11月27日(金) 9:05（Asia/Tokyo 時間）",
    );
    expect(() => formatDateTimeInZone(at, "Not/AZone", "ja")).toThrow(RangeError);
  });
});

describe("membership dictionaries (family-app-demo-parity 2.1)", () => {
  const ROLES = [
    "care_recipient",
    "primary_caregiver",
    "family_member",
    "medical_coordinator",
    "finance_coordinator",
    "transport_coordinator",
    "emergency_contact",
    "professional_caregiver",
  ];
  const required = [
    "nav.members",
    "member.leftSuffix",
    "welcome.left.body",
    "membership.error.generic",
    "firstRun.recipient.body",
    "reminder.kind.member_joined",
    "reminder.kind.member_role_changed",
    "reminder.kind.part_needs_someone",
    ...ROLES.flatMap((r) => [`role.${r}.label`, `role.${r}.description`]),
    ...["pending", "accepted", "revoked", "expired"].map((s) => `inviteState.${s}`),
    ...["household.created", "member.joined", "member.rejoined", "member.role_changed", "member.deactivated", "member.left", "member.display_name_changed", "invite.created", "invite.revoked", "invite.accepted", "invite.expired"].map((e) => `audit.membership.${e}`),
  ];
  it("has every required key, non-empty, in English and Japanese", () => {
    for (const key of required) {
      expect(en[key as MessageKey], key).toBeTruthy();
      expect(ja[key as MessageKey], key).toBeTruthy();
    }
    for (const group of ["signup.", "welcome.", "join.", "invites.", "members.", "firstRun.", "membership.refusal."]) {
      expect(MESSAGE_KEYS.some((k) => k.startsWith(group)), group).toBe(true);
    }
  });
  it("keeps the 'left the household' text", () => {
    expect(en["member.leftSuffix"]).toBe("(left the household)");
    expect(ja["member.leftSuffix"]).toBe("（世帯を離れました）");
  });
});
