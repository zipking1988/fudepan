import type { RiskLevel } from "@/lib/care/risk";

/**
 * All landing copy lives here so it can be reviewed in one place.
 * People and events are fictional and match the demo household in supabase/seed.sql.
 */

export const NAV = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#follow-up", label: "Follow-up" },
  { href: "#safety", label: "Safety" },
];

export const SIGN_IN_HREF = "/login";

/** A title with one accent phrase set in the serif italic. */
export type AccentTitle = { text: string; accent: string };

export const HERO = {
  eyebrow: "For families caring for an older parent",
  title: {
    text: "Turn Grandma’s handwritten notes into care tasks your family won’t miss.",
    accent: "care tasks",
  } satisfies AccentTitle,
  lede: "Snap a photo of the note. Fudepan drafts the tasks, asks what’s missing, and your family approves what matters.",
  primaryCta: "Try the sample note",
  /** The interactive draft in the hero (see draft-demo.tsx). */
  primaryHref: "#sample-draft",
  secondaryCta: "Sign in",
  promises: ["No medical advice", "Family approves risky steps", "Every step recorded"],
};

/** The lines of Grandma's note. Each task below points back to one of these. */
export type NoteLineId = "visit" | "medicine" | "insurance" | "pills";

export const NOTE = {
  lines: [
    { id: "visit", text: "Thursday. Hospital." },
    { id: "medicine", text: "Pick up blood-pressure medicine." },
    { id: "insurance", text: "Bring the insurance card." },
    { id: "pills", text: "Ask if I can stop the sleeping pills." },
  ] satisfies { id: NoteLineId; text: string }[],
  signature: "— Grandma",
  caption: "Grandma’s handwritten note on the fridge",
};

export type DraftTask = {
  id: NoteLineId;
  title: string;
  owner: string | null;
  due: string;
  /** Says what `due` is, e.g. the family's own deadline, so it is never read as the appointment time. */
  dueLabel?: string;
  /** The actual appointment time, kept apart from `due`. "To be confirmed" until a person adds it. */
  appointment?: string;
  /** Shown on the card: the task cannot be marked done before a family member approves it. */
  gate?: string;
  risk: RiskLevel;
  /** What the note leaves out. Fudepan asks instead of guessing. */
  question?: string;
  /** Shown when a task needs a qualified professional, not Fudepan. */
  professional?: string;
};

export const DRAFT = {
  label: "Fudepan draft",
  summary: "4 tasks from 1 note",
  tasks: [
    {
      id: "visit",
      title: "Confirm the hospital visit",
      owner: "Misa",
      due: "Wed 6 PM",
      dueLabel: "Family-set confirmation deadline",
      appointment: "To be confirmed",
      gate: "It can’t be marked done until a family member approves it.",
      risk: "high",
      question: "Which hospital? What time is the appointment?",
    },
    {
      id: "medicine",
      title: "Pick up blood-pressure medicine",
      owner: "Kenta",
      due: "Thu 5 PM",
      risk: "high",
      question: "Which pharmacy?",
    },
    {
      id: "insurance",
      title: "Pack the insurance card",
      owner: null,
      due: "Thu 6 AM",
      risk: "high",
    },
    {
      id: "pills",
      title: "Ask the doctor about sleeping pills",
      owner: "Misa",
      due: "Thu visit",
      risk: "high",
      professional: "Only her doctor can answer this. Fudepan will not.",
    },
  ] satisfies DraftTask[],
  unowned: "No owner yet",
  missing: "Missing:",
  appointmentLabel: "Appointment time",
  gateLabel: "Approval first:",
  hint: "Tap a task to see where it came from.",
  footer: "Nothing happens until your family approves it.",
  replay: "Replay",
  source: "From the note",
  showAll: "Show all 4 tasks",
  showFewer: "Show fewer tasks",
};

export const HOW_IT_WORKS = {
  eyebrow: "How it works",
  title: { text: "Three steps from paper to a plan", accent: "a plan" } satisfies AccentTitle,
  steps: [
    { title: "Snap a photo", text: "Grandma keeps writing on paper. Anyone takes a picture." },
    { title: "Fudepan reads it", text: "It drafts the tasks and asks about anything missing." },
    { title: "Your family approves", text: "Every task gets a person and a deadline." },
  ],
};

/** A moment in the example week. `minutes` counts from Monday 00:00, for ordering. */
export type Moment = { label: string; minutes: number };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function at(day: (typeof DAYS)[number], hour: number, minute: number): Moment {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const label = `${day} ${h12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
  return { label, minutes: DAYS.indexOf(day) * 1440 + hour * 60 + minute };
}

/** Plain-language gap, e.g. "about 9 hours". */
export function gap(from: Moment, to: Moment): string {
  const minutes = Math.abs(to.minutes - from.minutes);
  if (minutes < 90) return `${minutes} minutes`;
  return `about ${Math.round(minutes / 60)} hours`;
}

export type FollowUpEvent = {
  at: Moment;
  text: string;
  /** What the event is: the family's decision, a nudge, the work itself, or its proof. */
  kind: "approval" | "reminder" | "handoff" | "accepted" | "done" | "proof";
  status: string;
};

const DEADLINE = at("Thu", 6, 0);
const APPROVED = at("Mon", 9, 20);
const DONE = at("Wed", 21, 2);
const PROOF = at("Wed", 21, 4);

export const FOLLOW_UP = {
  title: "If nobody responds, the task is escalated, not forgotten.",
  lede: "Every important task has a backup person and a time to escalate. When that time passes, Fudepan marks the task as escalated and names the backup person in your family’s record. Nothing quietly expires.",
  disclaimer:
    "This is a simulated example. The local Alpha build sends no notifications: reminders and escalations are only recorded in the family’s timeline.",
  points: [
    "A reminder for the person responsible is recorded.",
    "If they don’t respond in time, the task is escalated to the backup person.",
    "Who agreed, when, and the proof are saved for the whole family to see.",
  ],
  task: {
    title: "Put the insurance card in Grandma’s bag",
    deadline: DEADLINE,
    /** The family's decision. Separate from whether the work got done. */
    approval: {
      result: "Approved",
      by: "Misa",
      at: APPROVED,
      /** Neutral context: why this task needed a person's approval at all. */
      why: "Insurance paperwork always needs a family member’s approval.",
    },
    /** The work itself. On time is judged by this, never by when proof arrived. */
    done: { by: "Kenta", at: DONE },
    proof: { what: "Photo of the card in her bag", at: PROOF },
  },
  labels: {
    deadline: "Deadline",
    approval: "Family approval",
    status: "Task status",
    proof: "Proof",
    onTime: "Done on time",
    late: "Done late",
    log: "What was recorded (simulated example)",
  },
  log: [
    {
      at: APPROVED,
      text: "Misa approved the task and took it on. Kenta is the backup.",
      kind: "approval",
      status: "Approved",
    },
    {
      at: at("Wed", 20, 0),
      text: "Reminder for Misa recorded (not sent)",
      kind: "reminder",
      status: "Simulated",
    },
    {
      at: at("Wed", 20, 30),
      text: "No reply by the escalation time. Escalated to Kenta, the backup",
      kind: "handoff",
      status: "Recorded",
    },
    {
      at: at("Wed", 20, 41),
      text: "Kenta saw it in Fudepan: “I’ll put it in her bag tonight.”",
      kind: "accepted",
      status: "Accepted",
    },
    { at: DONE, text: "Kenta put the card in Grandma’s bag", kind: "done", status: "Done" },
    { at: PROOF, text: "Photo added: the card in her bag", kind: "proof", status: "Proof added" },
  ] satisfies FollowUpEvent[],
};

/** On time means the work was done by the deadline. Uploading proof later does not change it. */
export function isOnTime(task: typeof FOLLOW_UP.task): boolean {
  return task.done.at.minutes <= task.deadline.minutes;
}

export const SAFETY = {
  title: "AI prepares. Your family decides.",
  lede: "Fudepan helps you understand and organize a note. People make every decision that matters.",
  does: [
    "Reads the handwriting",
    "Finds dates, places, people, and documents",
    "Points out what is missing",
    "Drafts tasks for your family to check",
  ],
  never: [
    "Gives medical advice or answers medical questions",
    "Starts, stops, or changes medication",
    "Pays bills or messages a doctor for you",
    "Guesses a date, a hospital, or an amount",
  ],
  riskTitle: "Every task says how careful to be",
  risks: [
    { risk: "low", text: "Simple things, like telling the family what the doctor said." },
    { risk: "medium", text: "Something is missing or unclear. Please take a look." },
    {
      risk: "high",
      text: "Appointments, medication, money, paperwork, and rides. A person must approve.",
    },
  ] satisfies { risk: RiskLevel; text: string }[],
};

export const AUDIENCE = {
  title: "Made for Grandma’s habits, not a new app",
  cards: [
    {
      who: "For Grandma",
      points: [
        "She keeps writing notes on paper, like always.",
        "She can see the plan in large, simple text.",
        "Nothing is decided for her.",
      ],
    },
    {
      who: "For the family",
      points: [
        "One shared list instead of a group chat.",
        "Everyone knows who is doing what.",
        "Missing details show up before they cause a problem.",
      ],
    },
  ],
};

export const KIRO = {
  title: "Built with Kiro",
  text: "Written specs, safety rules, and automated checks keep every change to Fudepan within the rules above.",
  /**
   * One rule traced from the Kiro spec to the code that enforces it and the
   * tests that check it. landing.test.tsx confirms every file, quote, and test
   * name below exists, so this list cannot drift from the code.
   */
  verification: {
    title: "From spec to enforcement to test",
    items: [
      {
        rule: "A high-risk step cannot be marked done until a family member approves it",
        spec: {
          file: ".kiro/specs/fudepan-care-chain/requirements.md",
          section: "Mandatory human approval",
          quote:
            "These actions must remain in `pending_approval` until an authorized household member approves them.",
        },
        enforcement: [
          {
            file: "supabase/migrations/20261120160000_care_chain_schema.sql",
            code: "care_steps_high_risk_requires_approval",
            what: "Database check: every high-risk step has approval_required = true.",
          },
          {
            file: "src/app/(app)/care/actions.ts",
            code: "completeStep",
            what: "Sends the request to the same guarded service as the new pages; it writes no step or audit row itself.",
          },
          {
            file: "supabase/migrations/20261210000300_shared_care_functions.sql",
            code: "approval_pending",
            what: "Database function: refuses to mark a step done while a high-risk step still waits for approval, before any write.",
          },
        ],
        tests: [
          {
            file: "supabase/tests/database/care_chain_foundation.test.sql",
            name: "A high-risk step cannot be saved without approval_required",
          },
          {
            file: "src/lib/care/actions.test.ts",
            name: "refuses to complete a pending high-risk step that requires approval, and writes nothing",
          },
          {
            file: "src/lib/care/actions.test.ts",
            name: "completes an approved high-risk step and records step_completed in the audit trail",
          },
        ],
      },
    ],
  },
  parts: ["Specs", "Steering", "Hooks", "MCP", "Crew"],
};

export const FINAL_CTA = {
  title: "The next note on the fridge is a plan.",
  text: "Accounts are set up by the person who organizes your household.",
  cta: "Sign in",
};

export const FOOTER = {
  line: "Fudepan does not replace family care. It makes sure care is never lost between assumptions.",
  disclaimer:
    "Fudepan is not a medical service. In an emergency, call your local emergency number.",
};
