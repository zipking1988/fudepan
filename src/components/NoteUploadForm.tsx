"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { MAX_NOTE_TEXT_LENGTH } from "@/lib/schemas/note";
import { t } from "@/lib/i18n/messages";
import { checkFileClientSide } from "@/lib/uploads/validate";

const buttonClass =
  "inline-flex min-h-12 min-w-12 items-center justify-center rounded-md bg-sage-800 px-6 py-3 text-lg font-semibold text-white hover:bg-sage-900 disabled:cursor-not-allowed disabled:bg-ink-soft";
const fieldClass = "mt-2 block w-full rounded-md border-2 border-edge p-3 text-lg";

export function NoteUploadForm() {
  const router = useRouter();
  const photoId = useId();
  const textId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [textError, setTextError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"photo" | "text" | null>(null);

  // Releases the preview URL when it changes or the form unmounts.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function send(body: FormData, kind: "photo" | "text") {
    const setError = kind === "photo" ? setPhotoError : setTextError;
    setError(null);
    setBusy(kind);
    try {
      const res = await fetch("/api/notes", { method: "POST", body });
      const json = (await res.json().catch(() => null)) as {
        noteId?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.noteId) {
        setError(json?.error?.message ?? t.upload.genericError);
        return;
      }
      router.push(`/notes/${json.noteId}`);
    } catch {
      setError(t.upload.networkError);
    } finally {
      setBusy(null);
    }
  }

  function onPhotoSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return setPhotoError("Please choose a photo first.");
    const problem = checkFileClientSide(file);
    if (problem) return setPhotoError(problem);
    const body = new FormData();
    body.set("kind", "image");
    body.set("file", file);
    void send(body, "photo");
  }

  function onTextSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = String(new FormData(event.currentTarget).get("text") ?? "").trim();
    if (!text) return setTextError("Please type or paste a note first.");
    const body = new FormData();
    body.set("kind", "text");
    body.set("text", text);
    void send(body, "text");
  }

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <form
        onSubmit={onPhotoSubmit}
        noValidate
        aria-labelledby={`${photoId}-title`}
        className="paper-card p-4 sm:p-6"
      >
        <h2 id={`${photoId}-title`} className="text-2xl font-semibold">
          {t.upload.photoTitle}
        </h2>
        <p className="mt-2 text-lg">{t.inbox.photoWarning}</p>
        <label htmlFor={photoId} className="mt-4 block text-lg font-semibold">
          {t.upload.photoLabel}
        </label>
        <input
          id={photoId}
          name="file"
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
          aria-describedby={photoError ? `${photoId}-error` : undefined}
          aria-invalid={photoError ? true : undefined}
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            setPreviewUrl(
              chosen && /^image\/(jpeg|png)$/.test(chosen.type)
                ? URL.createObjectURL(chosen)
                : null,
            );
            setPhotoError(null);
          }}
          className={fieldClass}
        />
        {file ? (
          <div className="mt-4">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob URL preview
              <img
                src={previewUrl}
                alt={t.upload.photoPreviewAlt}
                className="max-h-64 w-full rounded-md border-2 border-line object-contain"
              />
            ) : (
              <p className="text-lg">
                {file.name}. {t.upload.photoNoPreview}
              </p>
            )}
          </div>
        ) : null}
        {photoError ? (
          <p
            id={`${photoId}-error`}
            role="alert"
            className="mt-4 text-lg font-semibold text-danger"
          >
            <span aria-hidden="true">⚠ </span>
            {photoError}
          </p>
        ) : null}
        <button type="submit" disabled={busy !== null} className={`${buttonClass} mt-4`}>
          {busy === "photo" ? t.upload.working : t.upload.photoSubmit}
        </button>
      </form>

      <form
        onSubmit={onTextSubmit}
        noValidate
        aria-labelledby={`${textId}-title`}
        className="paper-card p-4 sm:p-6"
      >
        <h2 id={`${textId}-title`} className="text-2xl font-semibold">
          {t.upload.textTitle}
        </h2>
        <label htmlFor={textId} className="mt-4 block text-lg font-semibold">
          {t.upload.textLabel}
        </label>
        <p id={`${textId}-help`} className="text-lg">
          {t.upload.textHelp}
        </p>
        <textarea
          id={textId}
          name="text"
          rows={6}
          maxLength={MAX_NOTE_TEXT_LENGTH}
          aria-describedby={`${textId}-help${textError ? ` ${textId}-error` : ""}`}
          aria-invalid={textError ? true : undefined}
          className={fieldClass}
        />
        {textError ? (
          <p id={`${textId}-error`} role="alert" className="mt-4 text-lg font-semibold text-danger">
            <span aria-hidden="true">⚠ </span>
            {textError}
          </p>
        ) : null}
        <button type="submit" disabled={busy !== null} className={`${buttonClass} mt-4`}>
          {busy === "text" ? t.upload.working : t.upload.textSubmit}
        </button>
      </form>
    </div>
  );
}
