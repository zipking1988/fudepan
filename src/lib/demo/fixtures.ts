import type { TaskCategory } from "@/lib/schemas/task";
import type { ExtractionField, ExtractionWarning } from "@/lib/task-schema";

/**
 * Fictional example data for the public demo. It is never written to a database and no AI
 * service is called to produce it. People, places and medicine are invented.
 */
export const DEMO_NOTE_LINES = [
  "木曜",
  "さくら薬局で",
  "血圧の薬をもらう",
  "5時までに",
  "(アキにたのむ?)",
  "— ばあば",
];

export const DEMO_NOTE_TEXT = DEMO_NOTE_LINES.join("\n");

/** English glosses for the Japanese example values. */
export const DEMO_GLOSSES = {
  title: "English: Pick up blood pressure medicine",
  location: "English: Sakura Pharmacy",
  notes: "English: Grandma's note says “by 5 o'clock” and “Thursday”.",
} as const;

export interface DemoSuggestion {
  title: string;
  category: TaskCategory;
  dueTime: string;
  location: string;
  assigneeSuggestion: string;
  notes: string;
  uncertainFields: ExtractionField[];
  warnings: ExtractionWarning[];
}

export const DEMO_SUGGESTION: DemoSuggestion = {
  title: "血圧の薬を受け取る",
  category: "medication",
  dueTime: "17:00",
  location: "さくら薬局",
  assigneeSuggestion: "Aki",
  notes: "ばあばのメモ：「5時までに」「木曜」",
  uncertainFields: ["dueDate", "assigneeSuggestion"],
  warnings: ["uncertain_fields"],
};

export const DEMO_MEMBERS = [
  { id: "demo-grandma", display_name: "Grandma (example)" },
  { id: "demo-aki", display_name: "Aki (example)" },
  { id: "demo-ren", display_name: "Ren (example)" },
] as const;

/** The next given weekday (0 = Sunday) on or after `from`, as YYYY-MM-DD in UTC terms. */
export function nextWeekday(fromLocalDate: string, weekday: number): string {
  const [y, m, d] = fromLocalDate.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const delta = (weekday - date.getUTCDay() + 7) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/* ---- The Living Note: how each part of the example note becomes a field ---- */

export type LivingFieldId = "task" | "place" | "when" | "deadline" | "who";

export interface NoteSegment {
  text: string;
  field?: LivingFieldId;
}

/** The same note as DEMO_NOTE_LINES, split into the phrases Fudepan reads. */
export const LIVING_NOTE: NoteSegment[][] = [
  [{ text: "木曜", field: "when" }],
  [{ text: "さくら薬局", field: "place" }, { text: "で" }],
  [{ text: "血圧の薬をもらう", field: "task" }],
  [{ text: "5時までに", field: "deadline" }],
  [{ text: "(" }, { text: "アキにたのむ?", field: "who" }, { text: ")" }],
  [{ text: "— ばあば" }],
];

export interface LivingField {
  id: LivingFieldId;
  number: number;
  label: string;
  /** The words in the note this field comes from (Japanese). */
  source: string;
  /** How the phrase is understood, in English. Kept literal: no invented certainty. */
  meaning: string;
  uncertain: boolean;
  /** Shown when uncertain: what a person must check. */
  check?: string;
  caption: string;
}

/**
 * Field meanings for the example. `when.meaning` is completed with the visible reference date at
 * render time, so Thursday is never turned into a date without showing where the date came from.
 */
export const LIVING_FIELDS: LivingField[] = [
  {
    id: "task",
    number: 1,
    label: "Task",
    source: "血圧の薬をもらう",
    meaning: "Pick up blood pressure medicine",
    uncertain: false,
    caption:
      "「血圧の薬をもらう」 means “pick up blood pressure medicine”. It is about medicine, so it is high risk.",
  },
  {
    id: "place",
    number: 2,
    label: "Place",
    source: "さくら薬局",
    meaning: "Sakura Pharmacy",
    uncertain: false,
    caption: "「さくら薬局で」 means “at Sakura Pharmacy”. That becomes the place.",
  },
  {
    id: "when",
    number: 3,
    label: "Day",
    source: "木曜",
    meaning: "Thursday",
    uncertain: true,
    check: "「木曜」 is a day, not a date. Confirm which Thursday.",
    caption:
      "「木曜」 means Thursday: a day, not a date. The example uses the next Thursday after the reference date and asks you to confirm it.",
  },
  {
    id: "deadline",
    number: 4,
    label: "Deadline",
    source: "5時までに",
    meaning: "By 5:00 at the latest",
    uncertain: true,
    check: "No 午前 or 午後 is written. Confirm 5 AM or 5 PM; pharmacy hours suggest 5 PM.",
    caption:
      "「5時までに」 means “by 5 o'clock”: a deadline, not an appointment at 5:00. It does not say AM or PM, so a person must confirm it.",
  },
  {
    id: "who",
    number: 5,
    label: "Suggested helper",
    source: "アキにたのむ?",
    meaning: "Aki",
    uncertain: true,
    check: "「アキにたのむ?」 is a question: “ask Aki?”. Aki has not agreed yet.",
    caption:
      "「アキにたのむ?」 means “ask Aki?”. It is a question, so Aki is suggested, but nobody is assigned until Aki agrees.",
  },
];

/** Labels for the example's visible reference date (today) and the Thursday that follows it. */
export function exampleDates(
  now: Date,
  timeZone: string,
  localDateFn: (d: Date, tz: string) => string,
) {
  const reference = localDateFn(now, timeZone);
  const thursday = nextWeekday(reference, 4);
  const label = (iso: string, weekday: "short" | "long") =>
    new Intl.DateTimeFormat("en", {
      timeZone: "UTC",
      weekday,
      day: "numeric",
      month: "short",
    }).format(new Date(`${iso}T12:00:00Z`));
  return {
    reference,
    thursday,
    referenceLabel: label(reference, "short"),
    thursdayLabel: label(thursday, "long"),
  };
}
