"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./ui";

export type OriginalNoteLabels = {
  open: string;
  title: string;
  close: string;
  alt: string;
  quotesTitle?: string;
  quotesHint?: string;
  noQuotes?: string;
};

/**
 * The private original note, opened in a centered dialog. The photo comes only from the signed-in
 * `/notes/[noteId]/image` route, which checks the session and household on every request. It is
 * not requested until the dialog opens. Escape or the close button closes it and focus returns to
 * the button that opened it. The photo is never the only source of truth: the words the system read
 * are listed beside it.
 */
export function OriginalNote({
  noteId,
  labels,
  quotes = [],
  className = "",
  children,
}: {
  noteId: string;
  labels: OriginalNoteLabels;
  quotes?: string[];
  className?: string;
  /** The visible face of the trigger. Defaults to the label with an image icon. */
  children?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  function show() {
    setOpen(true);
    // The dialog exists in the DOM already; showModal makes it modal and traps focus.
    dialogRef.current?.showModal();
  }
  function onClosed() {
    setOpen(false);
    triggerRef.current?.focus();
  }
  const src = `/notes/${noteId}/image`;
  return (
    <>
      <button ref={triggerRef} type="button" className={className} onClick={show} aria-haspopup="dialog">
        {children ?? (
          <>
            <Icon name="image" size={20} /> {labels.open}
          </>
        )}
      </button>
      <dialog
        ref={dialogRef}
        className="pb-dialog"
        aria-label={labels.title}
        onClose={onClosed}
        onClick={(e) => {
          // A click on the backdrop (the dialog element itself) closes it.
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
      >
        <div className="pb-dialog__paper">
          <div className="pb-dialog__head">
            <h2 className="pb-dialog__title">{labels.title}</h2>
            <button type="button" className="pb-dialog__close" onClick={() => dialogRef.current?.close()}>
              <Icon name="close" size={20} /> {labels.close}
            </button>
          </div>
          {open && (
            <figure className="pb-dialog__figure">
              {/* The route checks the session and household on every request. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={labels.alt} className="pb-dialog__img" />
            </figure>
          )}
          {labels.quotesTitle && (
            <section className="pb-dialog__quotes" aria-label={labels.quotesTitle}>
              <h3>{labels.quotesTitle}</h3>
              {quotes.length > 0 ? (
                <ul>
                  {quotes.map((q, i) => (
                    <li key={`${i}-${q}`}>{q}</li>
                  ))}
                </ul>
              ) : (
                <p>{labels.noQuotes}</p>
              )}
              {labels.quotesHint && <p className="pb-dialog__hint">{labels.quotesHint}</p>}
            </section>
          )}
        </div>
      </dialog>
    </>
  );
}
