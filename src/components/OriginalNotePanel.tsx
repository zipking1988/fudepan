import { HandwrittenNote } from "@/components/HandwrittenNote";
import { t } from "@/lib/i18n/messages";
import { confidencePercent, isLowConfidence } from "@/lib/ocr/confidence";
import { MASK } from "@/lib/safety/mask-sensitive";

/**
 * The original note: photo (via a short-lived signed URL created by the caller under RLS) or the
 * typed text, plus the masked OCR text and its confidence. Sticky beside the form on wide screens.
 */
export function OriginalNotePanel(props: {
  sourceType: "image" | "text";
  imageUrl: string | null;
  /** Masked OCR text or typed text. */
  text: string | null;
  ocrConfidence: number | null;
  headingId?: string;
}) {
  const isImage = props.sourceType === "image";
  const low = isImage && Boolean(props.text) && isLowConfidence(props.ocrConfidence);
  const headingId = props.headingId ?? "original-note";
  const lines = (props.text ?? "").split("\n");

  return (
    <section
      aria-labelledby={headingId}
      className="paper-card grid content-start gap-4 p-4 sm:p-6 lg:sticky lg:top-4"
    >
      <h2 id={headingId} className="text-2xl font-semibold">
        {t.review.originalSection}
      </h2>

      {isImage ? (
        props.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
          <img
            src={props.imageUrl}
            alt={t.note.originalAlt}
            className="w-full rounded-md border border-line bg-paper object-contain"
          />
        ) : (
          <p className="text-lg">{t.note.imageUnavailable}</p>
        )
      ) : props.text ? (
        <HandwrittenNote lines={lines} label={t.review.textSection} />
      ) : null}

      {isImage ? (
        <div className="border-t border-line pt-4">
          <h3 className="text-xl font-semibold">{t.review.ocrSection}</h3>
          <p className="mt-1 text-lg text-ink-soft">
            {t.note.confidence}:{" "}
            <strong className="text-ink">
              {props.ocrConfidence === null
                ? t.note.unknownConfidence
                : `${confidencePercent(props.ocrConfidence)}%`}
            </strong>
          </p>
          {low ? (
            <p className="mt-2 flex gap-2 rounded-md bg-amber-50 px-3 py-2 text-lg text-amber">
              <span aria-hidden="true">⚠</span>
              <span>
                <strong>{t.note.lowConfidenceTitle}.</strong> {t.note.lowConfidenceBody}
              </span>
            </p>
          ) : null}
          <p className="mt-3 whitespace-pre-wrap text-lg">{props.text || t.review.noOcrText}</p>
        </div>
      ) : null}

      {props.text?.includes(MASK) ? (
        <p className="rounded-md bg-paper-shade p-3 text-lg">{t.note.maskedNotice}</p>
      ) : null}
    </section>
  );
}
