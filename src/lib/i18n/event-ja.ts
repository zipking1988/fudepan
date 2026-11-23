/**
 * Japanese words for the Event_View at /family/events/[noteId]. Same keys and `{param}` placeholders
 * as `event-en.ts`. Spread into `ja`. Polite everyday Japanese (です・ます), short sentences.
 * The part of a note is called 「やること」 everywhere.
 */
import type { eventEn } from "./event-en";

export const eventJa: { readonly [K in keyof typeof eventEn]: string } = {
  // Action results the server returns as keys
  "outcome.requestExpired": "お願いの期限が切れました。何も変更していません。",
  "outcome.evidenceRequired": "まだ完了にできません。必要な記録が足りません：{missing}",
  "evidence.empty": "そのファイルは空です。別のファイルを選んでください。",
  "evidence.tooLarge": "そのファイルは大きすぎます。小さいファイルを選んでください。",
  "evidence.unsupportedType": "そのファイルは使えません。写真かPDFを選んでください。",
  "evidence.notUploaded": "ファイルが届きませんでした。もう一度お試しください。",
  "evidence.contentMismatch": "写真やPDFではないようです。別のファイルを選んでください。",
  "evidence.unavailable": "今は記録を追加できません。もう一度お試しください。",

  // Page
  "event.back": "家族のお知らせに戻る",
  "event.fallbackTitle": "ご家族からのメモ",
  "event.beingRead.title": "AIが読み取り中",
  "event.beingRead.body": "メモを読み取っています。終わるとこの画面が新しくなります。",
  "event.uploaded.body": "メモを保存しました。読み取りはまだ始まっていません。",
  "event.failed.title": "メモを読み取れませんでした",
  "event.failed.body": "メモを読み取れませんでした。何も変更していません。もう一度試すか、元の写真を開いてください。",
  "event.failed.retry": "もう一度読み取る",
  "event.retryStarted": "もう一度読み取りを始めました。",
  "event.original.link": "元のメモの写真を大きく開く",
  "event.original.alt": "アップロードされたままの手書きメモ",
  "event.timeline.link": "これまでの出来事を見る（経過）",
  "event.parts.heading": "やること",
  "event.parts.none": "このメモからやることは見つかりませんでした。",
  "event.allDone": "このメモのやることはすべて完了です。",

  // Part card
  "event.part.fromNote": "メモより",
  "event.part.quoteLabel": "メモの内容",
  "event.part.helpers": "手伝う人",
  "event.part.progress": "進み具合",
  "event.part.needsSomeone": "担当する人が必要です",
  "event.part.location": "場所",
  "event.part.noLocation": "まだ決まっていません",
  "event.progress.pending_review": "確認待ち",
  "event.progress.needs_clarification": "もっと情報が必要です",
  "event.progress.in_progress": "進行中",
  "event.progress.evidence_required": "記録を待っています",
  "event.progress.escalated": "期限までに返事がありませんでした",
  "event.progress.completed": "完了",
  "event.progress.failed": "できませんでした",
  "event.progress.cancelled": "取りやめ",
  "event.progress.other": "未完了",
  "event.helper.line": "{role}：{name}",
  "event.helper.you": "あなた",
  "event.helper.someone": "家族の方",
  "event.suggestedRole":
    "メモからは「{role}」が考えられます。これは目安です。誰かが引き受けるまで、担当者は決まっていません。",
  "event.askPerson": "メモには{name}さんに聞くようにあります。これは目安です。まだ誰にも聞いていません。",

  // Times
  "event.time.heading": "日時",
  "event.time.appointment": "予約の日時",
  "event.time.respondBy": "返事の期限",
  "event.time.taskDue": "終わらせる期限",
  "event.time.notSet": "まだ決まっていません",
  "event.ifNobody":
    "期限までに返事がないときは、担当の人と控えの人に知らせます。このやることは「助けが必要」になります。",
  "event.ifNobody.noDeadline": "期限がまだないため、お知らせは届きません。下で期限を決めてください。",

  // Evidence
  "event.evidence.heading": "記録",
  "event.evidence.required": "必要な記録：{list}",
  "event.evidence.noneRequired": "記録は必要ありません。",
  "event.evidence.attached.one": "記録が{count}件あります",
  "event.evidence.attached.other": "記録が{count}件あります",
  "event.evidence.none": "まだ何もありません。",
  "event.evidence.textLabel": "したことを書く",
  "event.evidence.textLabelName": "この記録の名前",
  "event.evidence.textDefaultLabel": "メモ",
  "event.evidence.saveText": "このメモを記録として保存する",
  "event.evidence.fileLabel": "記録として写真かPDFを追加する",
  "event.evidence.upload": "ファイルを送る",
  "event.evidence.uploading": "送っています…",
  "event.evidence.saved": "記録を保存しました。",
  "event.evidence.chooseFirst": "先にファイルを選んでください。",

  // Buttons
  "event.btn.claim.owner": "私がやります",
  "event.btn.claim.driver": "私が運転します",
  "event.btn.claim.companion": "私が付き添います",
  "event.btn.release": "担当をやめる：{role}",
  "event.btn.handover": "ほかの人に引き継ぐ…",
  "event.btn.handover.choose": "{role}の担当を引き継ぐ人",
  "event.btn.handover.send": "引き継ぎをお願いする",
  "event.btn.choosePerson": "人を選ぶ",
  "event.btn.assign.label": "このやることを誰かにお願いする",
  "event.btn.assign.send": "お願いする",
  "event.btn.backup.label": "控えの人を誰かにお願いする",
  "event.btn.backup.send": "控えをお願いする",
  "event.btn.backup.volunteer": "私が控えになります",
  "event.btn.accept": "引き受ける",
  "event.btn.decline": "ことわる",
  "event.btn.approve": "このやることを確認済みにする",
  "event.btn.reject": "承認しない",
  "event.btn.resubmit": "もう一度確認をお願いする",
  "event.btn.complete": "完了にする",
  "event.btn.fail": "できなかったと知らせる",
  "event.btn.reopen": "もう一度開く",
  "event.btn.working": "処理中…",
  "event.releaseBlocked":
    "このやることは期限が近いため、担当をやめられません。「ほかの人に引き継ぐ…」を使ってください。",
  "event.backupPrompt":
    "あなたが担当になりました。ひとりに任せきりにならないよう、控えの人をお願いしてください。",
  "event.completeWaiting": "確認が済むまで、完了にはできません。",
  "event.noActions": "ここでできることはありません。内容はすべてご覧いただけます。",
  "event.approval.note": "あなたもこのやることに関わっている場合、確認は自己承認として記録されます。",
  "event.approval.rejected":
    "このやることは承認されていません。担当の人が変わったことを説明して、もう一度送ってください。",
  "event.resubmit.label": "変わったことを説明する",
  "event.resubmit.hint": "必須：何が変わったかを書くか、先に記録を追加してください。",

  // Requests
  "event.request.heading": "返事を待っています",
  "event.request.assignment": "{from}さんが、このやることをお願いしています。",
  "event.request.handover": "{from}さんが、{role}の担当を引き継ぐようお願いしています。",
  "event.request.backup": "{from}さんが、控えになるようお願いしています。",
  "event.request.expires": "返事の期限：",
  "event.request.other": "{from}さんが{to}さんにお願いしました。返事を待つ期限：",
  "event.request.kind.assignment": "このやることを引き受けること",
  "event.request.kind.handover": "担当を引き継ぐこと",
  "event.request.kind.backup": "控えになること",

  // Missing information
  "event.missing.heading": "まだわからないこと",
  "event.missing.why": "お聞きする理由：{reason}",
  "event.missing.answer": "答え",
  "event.missing.save": "答えを保存する",
  "event.missing.driverHint": "運転する場合は、上の「私が運転します」を押してください。",
  "event.missing.clinic": "病院やクリニックの名前",
  "event.missing.date": "日付",
  "event.missing.time": "時間",
  "event.missing.appointmentSave": "予約の内容を保存する",
  "event.missing.appointmentFromNote":
    "日付と時間はメモから入れました。メモにはタイムゾーンが書かれていないので、確かめてください。",
  "event.missing.zoneConfirm": "予約は{when}（{zone} 時間）で間違いありません。",
  "event.missing.zoneReading": "この端末のタイムゾーンを確認しています…",
  "event.missing.zoneHint":
    "{zone}（この端末のタイムゾーン）での時間を入れてください。そのタイムゾーンで保存されます。",
  "event.missing.zoneHintUnknown": "この端末がある場所での時間を入れてください。タイムゾーンも一緒に保存されます。",
  "event.missing.zoneNeeded": "保存する前に、日付と時間が表示のタイムゾーンで合っているか確認するか、直してください。",
  "event.missing.needClinic": "病院やクリニックの名前を入れてください。",
  "event.missing.needDate": "日付を入れてください。",
  "event.missing.needTimeValue": "時間を入れてください。",
  "event.missing.amount": "金額",
  "event.missing.currency": "通貨",
  "event.missing.amountHint":
    "書かれているとおりに金額を入力してください。例：3500 または 12.50。Fudepanは記録するだけで、支払いはしません。",
  "event.missing.amountSave": "金額を保存する",
  "event.missing.needAmount": "金額を入れてください。",
  "event.missing.amountInvalid": "金額は数字で入力してください。例：3500 または 12.50。円には小数点はありません。",
  "event.missing.deadlineKind": "これは",
  "event.missing.deadline.task_due": "終わらせる期限",
  "event.missing.deadline.respond_by": "返事の期限",
  "event.missing.deadlineSave": "この時間で確定する",
  "event.missing.deadlineConfirm": "これは{when}（{zone} 時間）で間違いありません。",

  // Results
  "event.result.saved": "保存しました。この画面は最新です。",
  "event.result.error": "うまくいきませんでした。何も変更していません。",
  "event.result.checkField": "ここを確認してください：{field}",
};
