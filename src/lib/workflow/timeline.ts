import { maskSensitive } from "@/lib/safety/mask-sensitive";

export interface TimelineSourceEvent {
  id: string;
  event_type: string;
  actor_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

export interface TimelineEntry {
  id: string;
  at: string;
  text: string;
  details: string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const safe = (v: unknown): string | null => {
  const s = str(v);
  return s ? maskSensitive(s).text : null;
};

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  category: "category",
  due_date: "due date",
  due_time: "due time",
  due_at: "due date",
  location: "location",
  notes: "notes",
  assignee_id: "assignee",
};

function fieldList(v: unknown): string | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.map((f) => FIELD_LABELS[String(f)] ?? String(f)).join(", ");
}

/**
 * Turns an audit event into a readable sentence. Only known payload fields are shown, and free text
 * is masked again, so raw sensitive values never appear in the timeline.
 */
export function describeAuditEvent(
  event: TimelineSourceEvent,
  names: ReadonlyMap<string, string>,
): TimelineEntry {
  const p = event.payload ?? {};
  const who = (event.actor_id && names.get(event.actor_id)) || "A household member";
  const details: string[] = [];
  let text: string;

  switch (event.event_type) {
    case "note_created":
      text = `${who} added a ${p.source_type === "image" ? "photo" : "text"} note.`;
      break;
    case "task_extracted": {
      const model = safe(p.model);
      if (p.status === "failed" || p.status === "unavailable") {
        text = "Fudepan could not read the note automatically.";
      } else {
        const conf =
          typeof p.confidence === "number"
            ? ` (confidence ${Math.round(p.confidence * 100)}%)`
            : "";
        text = `Fudepan suggested a task from the note${conf}.`;
        if (model) details.push(`AI model: ${model}`);
        const parsed = p.parsed as Record<string, unknown> | null | undefined;
        if (parsed && safe(parsed.title)) details.push(`Suggested title: ${safe(parsed.title)}`);
      }
      break;
    }
    case "task_updated": {
      switch (p.action) {
        case "draft_created": {
          text = `${who} saved a draft task.`;
          const edited = fieldList(p.edited_fields);
          if (edited) details.push(`Changed from the suggestion: ${edited}`);
          break;
        }
        case "claim":
          text = `${who} took this task.`;
          break;
        case "assign":
          text = `${who} changed who the task is assigned to.`;
          break;
        case "edit": {
          text = `${who} edited the task.`;
          const edited = fieldList(p.edited_fields);
          if (edited) details.push(`Changed: ${edited}`);
          break;
        }
        default:
          text = `${who} updated the task.`;
      }
      break;
    }
    case "task_confirmation_requested":
      text = `${who} asked for approval.`;
      break;
    case "task_approved":
      text = `${who} approved the task.`;
      details.push("Approval only marks the task as confirmed. Nothing was paid, booked, or sent.");
      break;
    case "task_rejected": {
      text = `${who} rejected the task.`;
      const reason = safe(p.reason);
      if (reason) details.push(`Reason: ${reason}`);
      break;
    }
    case "task_completed":
      text = `${who} marked the task as done.`;
      break;
    case "task_cancelled": {
      text = `${who} cancelled the task.`;
      const reason = safe(p.reason);
      if (reason) details.push(`Reason: ${reason}`);
      break;
    }
    case "calendar_event_created":
      text = `${who} downloaded a calendar file for this task.`;
      details.push("Added to their own calendar app. Fudepan is not connected to any calendar.");
      break;
    default:
      text = `${who} made a change.`;
  }
  return { id: event.id, at: event.created_at, text, details };
}

export function buildTimeline(
  events: TimelineSourceEvent[],
  names: ReadonlyMap<string, string>,
): TimelineEntry[] {
  return [...events]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((e) => describeAuditEvent(e, names));
}
