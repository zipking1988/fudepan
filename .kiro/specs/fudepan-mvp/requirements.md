# Fudepan MVP Requirements

## Product goal

Fudepan turns a photo or text of a handwritten family note into a safe, reviewable household task. It is designed for older adults and their family caregivers.

## Users

- Elder: creates notes and receives simple reminders.
- Caregiver: reviews, approves, assigns, and completes tasks.
- Household coordinator: manages members and household settings.

## Core user stories

### US-1: Upload a handwritten note

As an elder,  
I want to photograph or upload a handwritten note,  
so that Fudepan can understand what my family needs to do.

**Acceptance criteria**

- The user can upload JPG, PNG, or HEIC images.
- The user can paste plain text instead of uploading an image.
- The original image remains visible beside the extracted task.
- Upload failures show a clear, non-technical error message.

### US-2: Extract a structured task

As a caregiver,  
I want the system to extract dates, times, places, people, and actions,  
so that I do not need to retype the note.

**Acceptance criteria**

- The system extracts title, category, due date/time, location, assignee suggestion, and notes.
- Supported categories are `medication`, `payment`, `appointment`, `pickup`, `reminder`, and `other`.
- Low-confidence OCR fields are marked as needing review.
- The user can edit every extracted field before saving.

### US-3: Apply risk-based confirmation

As a family member,  
I want risky tasks to require explicit approval,  
so that AI cannot make irreversible decisions on behalf of my family.

**Acceptance criteria**

- `medication`, `payment`, `appointment`, and `pickup` tasks default to `high` risk.
- High-risk tasks enter `awaiting_confirmation`, not `confirmed`.
- At least one household member must approve before a calendar event or notification workflow is created.
- Payment tasks never execute a payment; they only create a review task.
- Every approval, rejection, edit, completion, and cancellation creates an audit event.

### US-4: Coordinate the household

As a caregiver,  
I want to see all family tasks in one place,  
so that I can assign, track, and complete them.

**Acceptance criteria**

- A household has multiple members with roles: elder, caregiver, coordinator.
- Members can view tasks, claim unassigned tasks, complete tasks, or cancel tasks with permission.
- The task board shows status, due time, assignee, risk level, and original note.
- Members only see tasks belonging to their household.

### US-5: Remind the right person

As a household member,  
I want reminders before a task is due,  
so that important family tasks are not missed.

**Acceptance criteria**

- Confirmed tasks create a calendar event when calendar integration is enabled.
- The assignee and selected household members receive email or web push reminders.
- Reminders can be disabled per member.
- Reminder delivery attempts and outcomes are recorded in the audit log.

### US-6: Preserve an audit trail

As a coordinator,  
I want a complete history of each task,  
so that I can understand what AI extracted, what humans changed, and what was approved.

**Acceptance criteria**

- The system stores the original image or text, OCR output, parsed JSON, edits, approvals, notifications, and final status.
- Audit records cannot be silently deleted by regular users.
- The task detail page displays a readable activity timeline.

## Non-functional requirements

- The primary UI must support Japanese and English.
- Primary task text must use at least 18px font size.
- The interface must meet WCAG AA contrast requirements.
- Sensitive values must be masked in logs, previews, and exports.
- The app must work on mobile Safari and Chrome.
- The demo must be usable without uploading real personal documents.
