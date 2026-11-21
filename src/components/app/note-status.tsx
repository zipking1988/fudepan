import { NOTE_STATUS_TEXT, type NoteStatus } from "@/lib/notes/status";

/** Status as words plus a dot; the color only repeats what the words say. */
export function NoteStatusBadge({ status }: { status: NoteStatus }) {
  return (
    <span className={`app-status app-status--${status}`}>{NOTE_STATUS_TEXT[status].label}</span>
  );
}
