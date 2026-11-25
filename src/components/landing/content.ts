import type { Language } from "@/lib/i18n/format";
import { APPOINTMENT_LOCATION_MAX } from "@/lib/care/appointment";
import type { HelperRole } from "@/lib/care/rules/types";
import type { ExampleOnlyRefusal, PersonId, StickerId, TaskId } from "./example";

/**
 * All landing copy, in Japanese (default, at "/") and English (at "/en").
 * The family is fictional: Grandma wrote the note, Misa is the primary
 * caregiver, Kenta and Yui help. The visitor picks who they act as.
 *
 * Label rules (accessibility steering): risk labels and approval labels are
 * different words. 「確認待ち」 / "Requires confirmation" is only used while
 * approval is pending, never as a risk level.
 */

export const LINKS = {
  home: { ja: "/", en: "/en" } satisfies Record<Language, string>,
  /**
   * "Demo" from each landing. The full /demo is in Japanese only, so the English
   * landing keeps visitors on its own interactive example.
   */
  demo: { ja: "/demo", en: "/en#example" } satisfies Record<Language, string>,
  login: "/login",
  capture: "/family/capture",
  example: "#example",
  how: "#how",
};

/** One entry per number of completed tasks, 0 to 4. */
type FivePhotos<T> = readonly [T, T, T, T, T];

export const IMAGES = {
  hero: "/landing/grandma-hero.png",
  note: "/landing/handwritten-note-ja.png",
  /**
   * Grandma in the example, by number of completed tasks: calm at 0, then
   * looking down, at the camera, to the side, and laughing upward at 4.
   */
  grandmaByDone: [
    "/landing/grandma-ready.png",
    "/landing/grandma-task-1.png",
    "/landing/grandma-task-2.png",
    "/landing/grandma-task-3.png",
    "/landing/grandma-task-4.png",
  ] satisfies FivePhotos<string>,
  people: {
    misa: "/landing/misa.png",
    kenta: "/landing/kenta.png",
    yui: "/landing/yui.png",
  } satisfies Record<PersonId, string>,
};

/** Intrinsic sizes of the files in public/landing, for next/image. */
export const IMAGE_SIZE = {
  grandma: { width: 1402, height: 1122 },
  grandmaByDone: [
    { width: 1402, height: 1122 },
    { width: 1467, height: 1072 },
    { width: 1402, height: 1122 },
    { width: 1402, height: 1122 },
    { width: 1402, height: 1122 },
  ] satisfies FivePhotos<{ width: number; height: number }>,
  note: { width: 1536, height: 1024 },
  person: { width: 1254, height: 1254 },
};

type Title = { line1: string; before: string; mark: string; after: string };

export type LandingCopy = {
  meta: { title: string; description: string };
  skip: string;
  nav: {
    label: string;
    how: string;
    login: string;
    /** The link to the other language, written in that language. */
    other: { lang: Language; label: string };
  };
  hero: {
    title: Title;
    lede: [string, string];
    cta: string;
    photoAlt: string;
    noteAlt: string;
    familyLabel: string;
  };
  example: {
    title: { mark: string; after: string };
    lede: string;
    fictional: string;
    /** The full /demo. Only on the Japanese landing, because /demo is in Japanese. */
    fullDemo: { cta: string; note: string } | null;
    /** The real capture page, outside the fictional example. */
    actual: { link: string };
  };
  /** A short four-step overview above the example. Details are in `how`. */
  flow: { title: string; steps: { title: string; text: string }[]; more: string };
  how: {
    title: string;
    steps: { title: string; text: string }[];
    confirm: { title: string; text: string; items: string[]; medical: string };
    /** One requirement followed from the Kiro spec to the rule's test and the example. Paths are real files. */
    kiro: {
      title: string;
      lede: string;
      steps: { label: string; text: string; quote?: string; path: string; detail?: string }[];
      honest: string;
    };
  };
  footer: { navLabel: string; line: string; links: { how: string; demo: string; login: string } };
};

export type ExampleCopy = {
  region: string;
  appName: string;
  /** The bar at the top of the example: who you act as, and where to start. */
  start: {
    actingAs: (name: string) => string;
    /** Hidden words after 「病院名を確認する」: who starts it. */
    context: (name: string) => string;
  };
  recipient: string;
  progress: (done: number, total: number) => string;
  /** Grandma's photo, by number of completed tasks (0 to 4). */
  photoAlt: FivePhotos<string>;
  /** Shown under the progress: the photo changes after each completed task. */
  photoHint: string;
  viewNote: string;
  note: {
    title: string;
    imageAlt: string;
    transcriptTitle: string;
    transcript: string[];
    transcriptNote: string | null;
    close: string;
  };
  /** 「今週のありがとう」: a small board of finished tasks per person, for this made-up note only. */
  thanks: {
    title: string;
    /** Says what is counted, and that it is only this fictional note. */
    scope: string;
    empty: string;
    listLabel: string;
    rank: (rank: number, tied: boolean) => string;
    count: (done: number) => string;
    best: string;
  };
  event: { title: string; date: string; dateSource: string; tasksLabel: string };
  tasks: Record<TaskId, string>;
  people: Record<PersonId, string>;
  primaryCaregiver: string;
  roles: Record<HelperRole, string>;
  status: { pending: string; unassigned: string };
  missingHospital: string;
  /** On the visit while nobody has taken on going along with her. */
  missingCompanion: string;
  askPerson: (name: string) => string;
  /** On the clinic task: who the note says to ask, quoting the note. Never the owner. */
  askFromNote: (name: string, quote: string) => string;
  clinicLabel: string;
  filledBy: (name: string) => string;
  /** What a task is waiting for. See `waitingOn` in example.ts. */
  waiting: {
    clinic: (primary: string) => string;
    confirm: (primary: string) => string;
    /** Added when the visitor is not the primary caregiver. */
    switchToConfirm: (primary: string) => string;
    owner: (owner: string) => string;
    clinicOwner: (owner: string) => string;
  };
  /** Shown under a disabled 「完了にする」 on the visit. See `completionBlock` in example.ts. */
  completeBlocked: {
    /** The clinic name, the companion, or both are still missing. */
    missing: (clinic: boolean, companion: boolean) => string;
    confirm: (primary: string) => string;
    owner: (owner: string | null) => string;
  };
  clinicForm: {
    label: string;
    required: string;
    why: string;
    sample: string;
    sampleName: string;
    save: string;
  };
  claim: string;
  /** The visit's claim: it takes on the companion role, so it says so. */
  claimCompanion: string;
  /** Hidden words around 「付き添いを引き受ける」 that name the task. */
  companionContext: (task: string) => { before: string; after: string };
  /** The primary caregiver's approval button, naming who approves. */
  confirmAs: (name: string) => string;
  complete: string;
  release: string;
  /** On the confirmed visit: makes the owner the selected person, next to 「完了にする」. */
  switchTo: (name: string) => string;
  /** Hidden words after a button's label that name its task (the switch shortcuts, the sticker buttons). */
  switchContext: (task: string) => string;
  /** Thank-you stickers on finished tasks. Free and local; nothing is sent anywhere. */
  stickers: {
    label: Record<StickerId, string>;
    send: string;
    /** Hidden words after 「ありがとうを送る」: who it goes to, and for which task. */
    sendContext: (to: string, task: string) => string;
    change: string;
    remove: string;
    close: string;
    pick: (to: string) => string;
    received: string;
    fromTo: (from: string, to: string) => string;
  };
  /** The family celebration at 4 of 4. */
  party: {
    title: string;
    lede: (total: number) => string;
    peopleLabel: string;
    /** What comes next: this run is simulated; the links lead to the real app and the role demo. */
    next: {
      simulated: string;
      demoCta: string;
      demoNote: string;
      realCta: string;
      realNote: string;
      grandma: string;
    };
    did: { finished: (task: string) => string; drove: string; wentAlong: string; confirmed: string };
  };
  /** Hidden words that name the task in a button's accessible name, before or after the visible label. */
  taskContext: (task: string) => { before: string; after: string };
  /** Who the visitor acts as. Each face is one choice in a radio group. */
  persona: {
    legend: string;
    current: string;
    /** Hidden words around the name, so each choice reads "Act as Misa". */
    actAs: (name: string) => { before: string; after: string };
  };
  drop: string;
  dragHint: string;
  reset: string;
  /** Messages for refusals that only the example has. Rule refusals use the app dictionaries. */
  refusal: Record<ExampleOnlyRefusal, string>;
  said: {
    claimed: (task: string, name: string) => string;
    claimedClinic: (task: string, name: string, ask: string) => string;
    claimedNeedsConfirm: (task: string, name: string, primary: string) => string;
    claimedConfirmAgain: (task: string, name: string, primary: string) => string;
    confirmed: (task: string, primary: string, owner: string) => string;
    completed: (task: string, done: number, total: number) => string;
    clinicSaved: (clinic: string) => string;
    released: (task: string, name: string, role: string) => string;
    reset: (name: string) => string;
    switched: (task: string, name: string) => string;
    switchedToConfirm: (task: string, name: string) => string;
    companionClaimed: (name: string, primary: string) => string;
    thanksSent: (from: string, to: string, sticker: string) => string;
    thanksChanged: (from: string, to: string, sticker: string) => string;
    thanksRemoved: (from: string, to: string, sticker: string) => string;
    dropMissed: string;
  };
};

const NOTE_TRANSCRIPT_JA = ["11/27（金）14:30 通院", "病院はミサに聞く", "保険証", "帰りに眼鏡"];
const NOTE_ALT_JA = `おばあちゃんの手書きメモ。「${NOTE_TRANSCRIPT_JA.join("」「")}」と書いてあります。`;
const NOTE_TRANSCRIPT_EN = [
  "11/27 (Fri) 14:30, clinic visit",
  "Ask Misa which hospital",
  "Insurance card",
  "Glasses on the way home",
];
const NOTE_ALT_EN = `Grandma's handwritten note, in Japanese. In English it says: ${NOTE_TRANSCRIPT_EN.join("; ")}.`;

export const COPY: Record<Language, LandingCopy> = {
  ja: {
    meta: {
      title: "Fudepan｜おばあちゃんのこと、伝言ゲームにしない。",
      description:
        "おばあちゃんの手書きメモを写真に撮ると、家族で引き受けられる用事になります。分からないことは推測せず、大事なことは家族が確認します。",
    },
    skip: "本文へ移動",
    nav: {
      label: "ページの案内",
      how: "使い方",
      login: "ログイン",
      other: { lang: "en", label: "English" },
    },
    hero: {
      title: { line1: "おばあちゃんのこと、", before: "", mark: "伝言ゲーム", after: "にしない。" },
      lede: [
        "「金曜、病院だって。」何時に？ どこの病院？ 誰が付き添う？",
        "手書きのメモを撮ると、Fudepanがやることをリストに。家族で分担できます。",
      ],
      cta: "かんたんデモを試す",
      photoAlt: "大きく笑うおばあちゃん",
      noteAlt: NOTE_ALT_JA,
      familyLabel: "家族",
    },
    example: {
      title: { mark: "メモ1枚", after: "で、家族が動ける。" },
      lede: "手書きのメモから、家族で引き受けられる用事へ。",
      fictional: "架空の家族の例です。ミサ、ケンタ、ユイのだれとしても操作できます。何も保存されず、だれにも送られません。",
      fullDemo: {
        cta: "家族それぞれの視点で試す",
        note: "ミサ、ケンタ、ユイ、おばあちゃん。それぞれの立場で、最後まで試せます。",
      },
      actual: { link: "自分のメモで始める（ログインが必要です）" },
    },
    flow: {
      title: "Fudepanのしくみ",
      steps: [
        { title: "メモを撮る", text: "手書きのメモを、スマホで写真に撮ります。" },
        { title: "やることに分ける", text: "メモを読んで、やることのリストにします。書いていないことは推測せず、「未確認」と出します。" },
        { title: "家族で分担する", text: "だれがやるかは、家族が自分で決めます。" },
        { title: "大事なことは人が確認", text: "通院や支払いなどは、主介護者が確認するまで「完了」にできません。" },
      ],
      more: "くわしい使い方",
    },
    how: {
      title: "使い方",
      steps: [
        { title: "メモを撮る", text: "おばあちゃんの手書きメモを、スマホで写真に撮ります。" },
        {
          title: "Fudepan が読む",
          text: "メモをやることに分けます。病院名など、メモに書いていないことは推測しません。「未確認」と出して、家族に聞きます。",
        },
        {
          title: "家族が引き受ける",
          text: "だれがやるかは、家族が自分で決めます。終わったら「完了」にします。",
        },
      ],
      confirm: {
        title: "確認が必要なこと",
        text: "次のことは、だれかが引き受けた後も「確認待ち」のままです。主介護者が確認するまで、完了にはできません。Fudepan が自分で決めたり、実行したりすることはありません。",
        items: [
          "通院や、病院への質問",
          "送り迎えと付き添い",
          "薬の受け取り",
          "支払い",
          "保険や役所の手続き",
          "家族以外への連絡",
        ],
        medical: "Fudepan は診断や薬の助言をしません。体のことは「医師や薬剤師に聞く」やることにします。",
      },
      kiro: {
        title: "Kiro でつくりました",
        lede: "Kiro の仕様に書いたひとつの決まりを、ルールのテストと上の例までたどれます。",
        steps: [
          {
            label: "仕様",
            text: "高リスクのやることは、人がはっきり承認するまで止めておく、と決めています。",
            quote: "High-risk actions remain blocked until explicitly approved.",
            path: ".kiro/specs/fudepan-care-chain/requirements.md",
          },
          {
            label: "上の例",
            text: "病院名と付き添いの人が決まるまでは確認できず、ミサ（主介護者）が確認してはじめて、ケンタ（担当）が完了にできます。",
            path: "src/components/landing/example.ts",
            detail: "src/lib/care/rules/completion.ts の decideCompletion を使っています",
          },
          {
            label: "テスト",
            text: "承認待ちのあいだは、担当の人でも完了にできないことを確かめています。",
            path: "src/lib/care/rules/completion.test.ts",
            detail: "refuses with approval_pending when approval is pending or rejected",
          },
        ],
        honest:
          "上の例は、あらかじめ用意した架空のデータで、ブラウザの中だけで動いています。AI によるメモの読み取りや通知は、このページでは動いていません。",
      },
    },
    footer: {
      navLabel: "フッター",
      line: "写真の人物と家族は、説明のための架空の例です。",
      links: { how: "使い方", demo: "デモ", login: "ログイン" },
    },
  },
  en: {
    meta: {
      title: "Fudepan | Keep Grandma's plans out of the game of telephone",
      description:
        "Take a photo of Grandma's handwritten note and your family gets errands they can take on. Nothing missing is guessed, and your family confirms anything important.",
    },
    skip: "Skip to main content",
    nav: {
      label: "Site",
      how: "How it works",
      login: "Log in",
      other: { lang: "ja", label: "日本語" },
    },
    hero: {
      title: { line1: "Grandma’s care", before: "shouldn’t be a ", mark: "game of telephone", after: "." },
      lede: [
        "“Grandma has the clinic on Friday.” What time? Which clinic? Who's going with her?",
        "Take a photo of a handwritten note, and Fudepan turns it into a list of tasks your family can share.",
      ],
      cta: "Try the quick demo",
      photoAlt: "Grandma, laughing",
      noteAlt: NOTE_ALT_EN,
      familyLabel: "Family",
    },
    example: {
      title: { mark: "One note", after: ", and the family can act." },
      lede: "From a handwritten note to errands your family can take on.",
      fictional: "A made-up family. You can act as Misa, Kenta, or Yui. Nothing is saved or sent.",
      fullDemo: null,
      actual: { link: "Start with your own note (log in required)" },
    },
    flow: {
      title: "How Fudepan works",
      steps: [
        { title: "Take a photo", text: "Take a photo of the handwritten note with your phone." },
        { title: "Split into tasks", text: "It reads the note and makes a task list. It never guesses what the note doesn't say. It shows “not confirmed”." },
        { title: "Share the tasks", text: "Your family decides who does what." },
        { title: "A person confirms what matters", text: "Clinic visits, payments and similar tasks can't be marked as done until the primary caregiver confirms them." },
      ],
      more: "More about how it works",
    },
    how: {
      title: "How it works",
      steps: [
        { title: "Take a photo of the note", text: "Take a photo of Grandma's handwritten note with your phone." },
        {
          title: "Fudepan reads it",
          text: "It splits the note into tasks. It never guesses what the note doesn't say, like the hospital name. It shows “not confirmed” and asks your family.",
        },
        {
          title: "Your family takes it on",
          text: "Each person chooses what they will do. When a task is finished, they mark it as done.",
        },
      ],
      confirm: {
        title: "When confirmation is required",
        text: "These stay at “Requires confirmation” even after someone takes them on. They can't be marked as done until the primary caregiver confirms them. Fudepan never decides or does them by itself.",
        items: [
          "Clinic visits and questions for the hospital",
          "Rides and going along",
          "Picking up medicine",
          "Payments",
          "Insurance and government paperwork",
          "Messages to people outside the family",
        ],
        medical:
          "Fudepan does not diagnose or give advice about medicine. For health questions, it adds a task to ask a doctor or pharmacist.",
      },
      kiro: {
        title: "Built with Kiro",
        lede: "One rule from the Kiro spec, followed to the rule's test and to the example above.",
        steps: [
          {
            label: "Spec",
            text: "High-risk tasks wait until a person approves them.",
            quote: "High-risk actions remain blocked until explicitly approved.",
            path: ".kiro/specs/fudepan-care-chain/requirements.md",
          },
          {
            label: "Example above",
            text: "Until the clinic name is saved and someone is going along, nobody can confirm the visit. Only after Misa (primary caregiver) confirms it can Kenta (owner) mark it as done.",
            path: "src/components/landing/example.ts",
            detail: "uses decideCompletion from src/lib/care/rules/completion.ts",
          },
          {
            label: "Test",
            text: "Checks that while approval is pending, even the owner cannot mark the task as done.",
            path: "src/lib/care/rules/completion.test.ts",
            detail: "refuses with approval_pending when approval is pending or rejected",
          },
        ],
        honest:
          "The example above runs on prepared, made-up data, only in your browser. It does not read notes with AI or send notifications.",
      },
    },
    footer: {
      navLabel: "Footer",
      line: "The people in the photos and the family are made-up examples.",
      links: { how: "How it works", demo: "Demo", login: "Log in" },
    },
  },
};

const CLINIC_MAX = APPOINTMENT_LOCATION_MAX;

/** 1st, 2nd, 3rd, 4th. The board has at most three people. */
function ordinal(n: number): string {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

export const EXAMPLE_COPY: Record<Language, ExampleCopy> = {
  ja: {
    region: "操作できる例：金曜の通院",
    appName: "Fudepan",
    start: {
      actingAs: (name) => `${name}として操作中`,
      context: (name) => `（${name}としてはじめる）`,
    },
    recipient: "おばあちゃん",
    progress: (done, total) => `${done} / ${total} 完了`,
    photoAlt: [
      "おだやかにほほえむおばあちゃん",
      "少しうつむいて、ほほえむおばあちゃん",
      "こちらを見て、にっこり笑うおばあちゃん",
      "横を向いて、うれしそうに笑うおばあちゃん",
      "上を向いて、大笑いするおばあちゃん",
    ],
    photoHint: "やることが1つ完了するたびに、写真が変わります。",
    viewNote: "元のメモを見る",
    note: {
      title: "おばあちゃんの元のメモ",
      imageAlt: "おばあちゃんの手書きメモの写真。書いてあることは、下に文字でもあります。",
      transcriptTitle: "メモに書いてあること",
      transcript: NOTE_TRANSCRIPT_JA,
      transcriptNote: null,
      close: "閉じる",
    },
    thanks: {
      title: "今週のありがとう",
      scope: "この架空のメモで、完了したやることの数です。",
      empty: "まだ完了したやることはありません。完了すると、ここに出ます。",
      listLabel: "完了の数の順位",
      rank: (rank, tied) => (tied ? `同率${rank}位` : `${rank}位`),
      count: (done) => `${done}つ完了`,
      best: "ベストサポーター",
    },
    event: { title: "金曜の通院", date: "11月27日（金）14:30", dateSource: "メモより", tasksLabel: "やること" },
    tasks: {
      card: "保険証を用意する",
      clinic: "病院名を確認する",
      visit: "通院に付き添う",
      glasses: "帰りに眼鏡を受け取る",
    },
    people: { misa: "ミサ", kenta: "ケンタ", yui: "ユイ" },
    primaryCaregiver: "主介護者",
    roles: { owner: "担当", driver: "送迎", companion: "付き添い" },
    status: { pending: "確認待ち", unassigned: "未担当" },
    missingHospital: "病院名は未確認",
    missingCompanion: "付き添いの人が未定",
    askPerson: (name) => `（${name}に聞く）`,
    askFromNote: (name, quote) => `聞く相手：${name}（メモ「${quote}」より）`,
    clinicLabel: "病院",
    filledBy: (name) => `（${name}が入力）`,
    waiting: {
      clinic: (primary) => `病院名が分かってから、${primary}（主介護者）が確認します。`,
      confirm: (primary) => `${primary}（主介護者）が確認するまで、完了にはできません。`,
      switchToConfirm: (primary) => `${primary}を選ぶと、確認できます。`,
      owner: (owner) => `担当の${owner}が完了にできます。`,
      clinicOwner: (owner) => `担当の${owner}が病院名を入れると、完了します。`,
    },
    completeBlocked: {
      missing: (clinic, companion) =>
        clinic && companion
          ? "病院名と付き添いの人が決まるまで、確認も完了もできません。"
          : clinic
            ? "病院名が保存されるまで、確認も完了もできません。"
            : "付き添いの人が決まるまで、確認も完了もできません。",
      confirm: (primary) => `${primary}（主介護者）が確認するまで、完了にはできません。`,
      owner: (owner) => (owner ? `完了にできるのは、担当の${owner}だけです。` : "担当の人が決まるまで、完了にはできません。"),
    },
    clinicForm: {
      label: "病院名",
      required: "必須",
      why: "メモには病院名がありません。聞いた名前を入れると、通院の「病院名は未確認」が埋まります。この例では架空の名前を使います。",
      sample: "架空の名前を入れる",
      sampleName: "みどり台クリニック",
      save: "保存する",
    },
    claim: "引き受ける",
    claimCompanion: "付き添いを引き受ける",
    companionContext: (task) => ({ before: `「${task}」の`, after: "" }),
    confirmAs: (name) => `${name}として確認する`,
    complete: "完了にする",
    release: "やめる",
    switchTo: (name) => `${name}に切り替える`,
    switchContext: (task) => `（「${task}」）`,
    stickers: {
      label: { helped: "助かった！", ride: "送迎ありがとう", hardWork: "おつかれさま" },
      send: "ありがとうを送る",
      sendContext: (to, task) => `（${to}へ、「${task}」）`,
      change: "スタンプを変える",
      remove: "取り消す",
      close: "閉じる",
      pick: (to) => `${to}に送るスタンプを選んでください`,
      received: "ありがとうスタンプ",
      fromTo: (from, to) => `${from}から${to}へ`,
    },
    party: {
      title: "みんなでできた！",
      lede: (total) => `${total}つのやることが、ぜんぶ終わりました。おばあちゃんも大笑いです。`,
      peopleLabel: "今回がんばった人",
      next: {
        simulated: "ここまでは、この画面の中だけの疑似体験です。何も保存されません。",
        demoCta: "デモの家族を試す",
        demoNote: "実際のアプリで、架空の家族の世帯に入れます。",
        realCta: "ログインして実際のアプリへ",
        realNote: "実際のアプリでは、メモの写真から用事を作ります。",
        grandma: "おばあちゃんの画面を見る",
      },
      did: {
        finished: (task) => `「${task}」を完了`,
        drove: "通院の送迎",
        wentAlong: "通院の付き添い",
        confirmed: "通院を確認",
      },
    },
    taskContext: (task) => ({ before: `「${task}」を`, after: "" }),
    persona: {
      legend: "だれとして操作しますか？",
      current: "あなた",
      actAs: () => ({ before: "", after: "として操作" }),
    },
    drop: "ここにドロップ",
    dragHint:
      "顔をタップして、操作する人を選べます。顔をやることまでドラッグするか「引き受ける」を押すと、その人が引き受けます。",
    reset: "最初からやり直す",
    refusal: {
      clinic_unknown: "病院名がまだ分かりません。先に「病院名を確認する」を済ませてください。",
      companion_missing: "付き添いの人がまだ決まっていません。先にだれかが「付き添いを引き受ける」を押してください。",
      clinic_name_required: "病院名が入っていません。どこへ行くか分かるように、病院名を入れてください。",
      clinic_name_too_long: `病院名は${CLINIC_MAX}文字までにしてください。`,
      already_confirmed: "これは、もう確認済みです。",
      thanks_not_allowed: "このやることには、いまはありがとうを送れません。",
      no_target: "やることの上で指をはなすと、引き受けられます。",
    },
    said: {
      claimed: (task, name) => `「${task}」を${name}が引き受けました。終わったら「完了にする」を押してください。`,
      claimedClinic: (task, name, ask) =>
        `「${task}」を${name}が引き受けました。${ask}に聞いた病院名を入れて、保存してください。`,
      claimedNeedsConfirm: (task, name, primary) =>
        `「${task}」を${name}が引き受けました。高リスクなので、${primary}が確認するまで「確認待ち」のままです。`,
      claimedConfirmAgain: (task, name, primary) =>
        `「${task}」を${name}が引き受けました。手伝う人が変わったので、${primary}がもう一度確認します。`,
      confirmed: (task, primary, owner) =>
        `「${task}」を${primary}（主介護者）が確認しました。担当の${owner}が完了にできます。`,
      completed: (task, done, total) =>
        `「${task}」が完了しました。${total}つのうち${done}つ完了です。おばあちゃんの写真が変わりました。`,
      clinicSaved: (clinic) => `病院名「${clinic}」を保存しました。`,
      released: (task, name, role) => `${name}が「${task}」の${role}をやめました。いまは未担当です。`,
      reset: (name) => `最初の状態に戻しました。いまは${name}として操作しています。`,
      switched: (task, name) => `いまは${name}として操作しています。「${task}」の「完了にする」を押すと、完了になります。`,
      switchedToConfirm: (task, name) =>
        `いまは${name}として操作しています。「${task}」の「${name}として確認する」を押すと、確認済みになります。`,
      companionClaimed: (name, primary) =>
        `${name}が付き添いを引き受けました。高リスクなので、${primary}が確認するまで「確認待ち」のままです。`,
      thanksSent: (from, to, sticker) => `${from}から${to}へ「${sticker}」を送りました。`,
      thanksChanged: (from, to, sticker) => `${from}から${to}へのスタンプを「${sticker}」に変えました。`,
      thanksRemoved: (from, to, sticker) => `${from}から${to}への「${sticker}」を取り消しました。`,
      dropMissed: "やることの上で指をはなすと、引き受けられます。",
    },
  },
  en: {
    region: "Try it: Friday clinic visit",
    appName: "Fudepan",
    start: {
      actingAs: (name) => `Acting as ${name}`,
      context: (name) => ` (start as ${name})`,
    },
    recipient: "Grandma",
    progress: (done, total) => `${done} of ${total} done`,
    photoAlt: [
      "Grandma, smiling calmly",
      "Grandma, looking down with a small smile",
      "Grandma, smiling at the camera",
      "Grandma, turning aside with a happy smile",
      "Grandma, laughing with her head tilted back",
    ],
    photoHint: "Grandma's photo changes each time a task is done.",
    viewNote: "See the original note",
    note: {
      title: "Grandma's original note",
      imageAlt: "Photo of Grandma's handwritten note, in Japanese. The English transcript is below.",
      transcriptTitle: "English transcript",
      transcript: NOTE_TRANSCRIPT_EN,
      transcriptNote: "The note is handwritten in Japanese. This is a translation.",
      close: "Close",
    },
    thanks: {
      title: "Thanks this week",
      scope: "Tasks done on this made-up note.",
      empty: "No tasks are done yet. They show up here when they are.",
      listLabel: "Ranking by tasks done",
      rank: (rank, tied) => `${tied ? "Tied " : ""}${ordinal(rank)}`,
      count: (done) => `${done} ${done === 1 ? "task" : "tasks"} done`,
      best: "Best Supporter",
    },
    event: { title: "Friday clinic visit", date: "Fri, Nov 27, 2:30 PM", dateSource: "from the note", tasksLabel: "Tasks" },
    tasks: {
      card: "Get the insurance card ready",
      clinic: "Confirm the clinic",
      visit: "Go with her to the clinic",
      glasses: "Pick up glasses on the way home",
    },
    people: { misa: "Misa", kenta: "Kenta", yui: "Yui" },
    primaryCaregiver: "Primary caregiver",
    roles: { owner: "Owner", driver: "Driving", companion: "Going along" },
    status: { pending: "Requires confirmation", unassigned: "No one yet" },
    missingHospital: "Clinic name not confirmed",
    missingCompanion: "Nobody is going along yet",
    askPerson: (name) => ` (ask ${name})`,
    askFromNote: (name, quote) => `Person to ask: ${name} (the note says “${quote}”)`,
    clinicLabel: "Clinic",
    filledBy: (name) => ` (added by ${name})`,
    waiting: {
      clinic: (primary) => `Once the clinic name is known, ${primary} (primary caregiver) confirms it.`,
      confirm: (primary) => `This can't be marked as done until ${primary} (primary caregiver) confirms it.`,
      switchToConfirm: (primary) => `Choose ${primary} to confirm it.`,
      owner: (owner) => `${owner}, the owner, can mark it as done.`,
      clinicOwner: (owner) => `It is done when ${owner}, the owner, adds the clinic name.`,
    },
    completeBlocked: {
      missing: (clinic, companion) =>
        clinic && companion
          ? "Can't be confirmed or marked as done until the clinic name is saved and someone is going along."
          : clinic
            ? "Can't be confirmed or marked as done until the clinic name is saved."
            : "Can't be confirmed or marked as done until someone is going along.",
      confirm: (primary) => `Can't be marked as done until ${primary} (primary caregiver) confirms it.`,
      owner: (owner) => (owner ? `Only ${owner}, the owner, can mark it as done.` : "Can't be marked as done until someone owns it."),
    },
    clinicForm: {
      label: "Clinic name",
      required: "required",
      why: "The note doesn't name the clinic. Add the name you were told, and the visit's “Clinic name not confirmed” is filled in. This example uses a made-up name.",
      sample: "Fill in a made-up name",
      sampleName: "Midoridai Clinic",
      save: "Save",
    },
    claim: "I'll take it",
    claimCompanion: "Go as her companion",
    companionContext: (task) => ({ before: "", after: `: ${task}` }),
    confirmAs: (name) => `Confirm as ${name}`,
    complete: "Mark as done",
    release: "Give it back",
    switchTo: (name) => `Switch to ${name}`,
    switchContext: (task) => `: ${task}`,
    stickers: {
      label: { helped: "That helped!", ride: "Thanks for the ride", hardWork: "Thanks for all your work" },
      send: "Send thanks",
      sendContext: (to, task) => ` to ${to}: ${task}`,
      change: "Change sticker",
      remove: "Remove",
      close: "Close",
      pick: (to) => `Choose a sticker for ${to}`,
      received: "Thank-you stickers",
      fromTo: (from, to) => `From ${from} to ${to}`,
    },
    party: {
      title: "We did it together!",
      lede: (total) => `All ${total} tasks are done, and Grandma is laughing.`,
      peopleLabel: "Who helped this time",
      next: {
        simulated: "Everything above is simulated in this page. Nothing is saved.",
        demoCta: "Try the demo family",
        demoNote: "Opens a fictional household in the real app.",
        realCta: "Log in to the real app",
        realNote: "In the real app, a photo of your note becomes tasks.",
        grandma: "See Grandma’s view",
      },
      did: {
        finished: (task) => `Finished “${task}”`,
        drove: "Drove to the clinic",
        wentAlong: "Went along to the clinic",
        confirmed: "Confirmed the visit",
      },
    },
    taskContext: (task) => ({ before: "", after: `: ${task}` }),
    persona: {
      legend: "Who are you acting as?",
      current: "You",
      actAs: () => ({ before: "Act as ", after: "" }),
    },
    drop: "Drop here",
    dragHint: "Tap a face to choose who you are. Drag a face onto a task, or press “I'll take it”, to take it on as that person.",
    reset: "Start over",
    refusal: {
      clinic_unknown: "The clinic isn't known yet. Do “Confirm the clinic” first.",
      companion_missing: "Nobody is going along yet. Someone needs to press “Go as her companion” first.",
      clinic_name_required: "The clinic name is missing. Add it so everyone knows where to go.",
      clinic_name_too_long: `Please keep the clinic name to ${CLINIC_MAX} characters or fewer.`,
      already_confirmed: "This is already confirmed.",
      thanks_not_allowed: "You can't send thanks for this task right now.",
      no_target: "Let go over a task to take it on.",
    },
    said: {
      claimed: (task, name) => `${name} took on “${task}”. When it's finished, press “Mark as done”.`,
      claimedClinic: (task, name, ask) => `${name} took on “${task}”. Ask ${ask}, then add the clinic name and save it.`,
      claimedNeedsConfirm: (task, name, primary) =>
        `${name} took on “${task}”. It is high risk, so it stays at “Requires confirmation” until ${primary} confirms it.`,
      claimedConfirmAgain: (task, name, primary) =>
        `${name} took on “${task}”. The helpers changed, so ${primary} needs to confirm it again.`,
      confirmed: (task, primary, owner) =>
        `${primary} (primary caregiver) confirmed “${task}”. ${owner}, the owner, can now mark it as done.`,
      completed: (task, done, total) => `“${task}” is done. ${done} of ${total} tasks are done. Grandma's photo changed.`,
      clinicSaved: (clinic) => `Saved the clinic name “${clinic}”.`,
      released: (task, name, role) => `${name} gave back “${task}” (${role}). No one has it now.`,
      reset: (name) => `Back to the start. You are acting as ${name}.`,
      switched: (task, name) => `You are acting as ${name}. Press “Mark as done” on “${task}” to finish it.`,
      switchedToConfirm: (task, name) => `You are acting as ${name}. Press “Confirm as ${name}” on “${task}” to confirm it.`,
      companionClaimed: (name, primary) =>
        `${name} is going along. It is high risk, so it stays at “Requires confirmation” until ${primary} confirms it.`,
      thanksSent: (from, to, sticker) => `${from} sent “${sticker}” to ${to}.`,
      thanksChanged: (from, to, sticker) => `${from} changed the sticker for ${to} to “${sticker}”.`,
      thanksRemoved: (from, to, sticker) => `${from} removed “${sticker}” for ${to}.`,
      dropMissed: "Let go over a task to take it on.",
    },
  },
};
