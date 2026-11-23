# Requirements Document

## Introduction

Today the signed-in Fudepan app (`/notes`, note detail, and Care Chain pages) assumes one caregiver uploads a note, reviews it, and does everything. This feature rebuilds the flow and the UI so that a note becomes a shared family activity:

1. The care recipient (for example, Grandma) does one thing: she photographs her handwritten note. Taking the photo starts recognition. There is no separate "upload" step.
2. One note becomes one **Shared Care Event** that the whole household can see, like an order that can be passed around. The event appears in the family's feed as soon as the photo is saved, labelled "Being read".
3. Family members see new events in a **Family Feed** and each person can **claim** a part: accompany Grandma, drive, pick up medicine, take her shopping, and so on.
4. Everyone, including Grandma in a very simple view, can see who claimed each part, whether it is done, what is still missing, and what happens if nobody responds.
5. A part can be **handed over** to another household member. The receiver always has to accept.
6. Claiming a part and approving a high-risk part are separate acts. Only a primary caregiver approves.

Example note: "Fri, Nov 27, 2026 — Clinic visit at 2:30 pm. Ask Misa which clinic. Bring my insurance card. Pick up my glasses on the way home."

**Scope.** This is a rebuild of the UI and the flow only (decision "option A"). It builds on the existing foundation and does not redesign it:

- Supabase Auth, `households`, `household_members` with roles, and row-level security (RLS) that limits each person to their own households.
- Private Supabase Storage for note photos, file signature validation, and the membership-checked image route.
- Server-side ai& extraction with Zod validation, and normalization that never stores a model-guessed deadline on an appointment step. A literal date or time from the note quote is only a suggestion that a person confirms in a shown timezone.
- `care_chains`, `care_steps`, the immutable `audit_events` trail, appointment clarification through the `save_appointment_clarification` SQL function, and escalation detection.

**Rules that also change the existing pages.** The approval, assignment, and completion rules in Requirements 9, 11, and 21 are enforced by shared server-side checks that the new routes and the existing `/care` server actions both call. The existing `approveStep` action currently has no primary-caregiver check, `assignStepOwner` lets any member change the owner and the backup owner directly, and `completeStep` checks `status = 'approved'` instead of a separate approval state. These behaviors change in this feature.

New tables and columns (claims, helper roles, handovers, approval state, time provenance, feed events, feed read state) are added only through additive migrations. The database is not reset, and existing QA rows are not rewritten. New pages live on new routes next to the old pages; old pages are removed only after the new flow works end to end.

Visual restyling is a separate, later concern. The new UI must be usable on phones first.

**Mapping to the existing data model.** A Shared Care Event is presented from one `notes` row and its newest `care_chains` row. A Part is presented from one `care_steps` row. These are presentation terms; the stored objects stay the same.

## Glossary

- **Fudepan**: The whole web application, deployed to Vercel.
- **Household**: A family unit stored in `households`. All care data belongs to exactly one Household.
- **Member**: An active row in `household_members` for the signed-in person in a given Household.
- **Care_Recipient**: A Member with the role `care_recipient` (for example, Grandma).
- **Family_Member**: Any Member whose role is not `care_recipient`, for example `primary_caregiver`, `family_member`, `transport_coordinator`, `finance_coordinator`, `medical_coordinator`, `emergency_contact`, or `professional_caregiver`.
- **Primary_Caregiver**: An active Member with the role `primary_caregiver` in the Household of the Part in question.
- **Authorized_Household_Members**: The active Members of a Household who may see that Household's care data under RLS. This is the wording used in the UI to describe who can see a note.
- **Note_Photo**: The original image of a handwritten note, stored in private Supabase Storage. Only its storage path is stored in the database.
- **Shared_Care_Event**: The family-facing view of one note: the Note_Photo, its recognized text, and its newest Care Chain with all Parts. One note produces one Shared_Care_Event.
- **Care_Chain**: The existing `care_chains` record derived from one note.
- **Usable_Draft**: A Care_Chain for a note whose Parts have all been written and whose status is not `extraction_failed`.
- **Part**: One unit of work inside a Shared_Care_Event, stored as one `care_steps` row (for example "Go to the clinic at 2:30 pm" or "Pick up glasses").
- **High_Risk_Part**: A Part whose risk level is `high`, or whose category is appointment, medication, payment, transport of the Care_Recipient, or insurance or government paperwork. A High_Risk_Part always has `approval_required = true`.
- **Progress_Status**: The work state of a Part, stored in `care_steps.status` (for example `pending_review`, `in_progress`, `evidence_required`, `escalated`, `completed`, `failed`, `cancelled`).
- **Approval_State**: The approval outcome of a Part, stored separately from Progress_Status. The values are `not_required`, `pending`, `approved`, and `rejected`.
- **Key_Fact**: A fact of a High_Risk_Part that an Approval depends on: the location (for example the clinic), the Appointment_Time, or a required amount.
- **Actual_Performer**: The Member who physically carries out a High_Risk_Part: the Owner, and for transport or accompaniment also the Driver and the Companion.
- **Missing_Detail**: A critical fact that the note does not state clearly: date, time, location, responsible person, required document, required amount, or required contact.
- **Person_To_Ask**: A person named in the note as the source of a missing fact (for example "Misa" in "Ask Misa which clinic"). A Person_To_Ask is information only and is never an Owner or Helper because of being named.
- **Claim**: A Member's own act of taking responsibility for a Part, or one Helper_Role on a Part.
- **Owner**: The Member who holds the main Claim on a Part. Stored as `care_steps.owner_id`.
- **Backup_Owner**: The Member stored as `care_steps.backup_owner_id`, notified when the Owner does not respond. A Member becomes Backup_Owner only by volunteering or by accepting a Backup_Request. A Part may have no Backup_Owner.
- **Backup_Request**: A request that a specific Member become the Backup_Owner of a Part. A Backup_Request takes effect only when the receiving Member accepts.
- **Helper**: A Member who holds a Claim on a Part.
- **Helper_Role**: The kind of help a Helper provides on a Part. The set is Owner, Companion, and Driver.
- **Companion**: A Helper who goes with the Care_Recipient (for example, to the clinic).
- **Driver**: A Helper who transports the Care_Recipient.
- **Suggested_Role**: A household role that ai& proposes for a Part. A Suggested_Role is a hint only and never creates a Claim.
- **Assignment**: A request by a Primary_Caregiver that a specific Member take the Owner Claim of a Part. An Assignment takes effect only when the receiving Member accepts.
- **Handover**: A request from the current Helper of a Part to pass that Claim to another Member of the same Household. A Handover takes effect only when the receiving Member accepts.
- **Handover_Expiry_Time**: The time after which a pending Handover can no longer be accepted: the Part's Task_Due_Time if the Part has a `human_confirmed` Task_Due_Time, otherwise 24 hours after the Handover was requested.
- **Approval**: An explicit decision by a Primary_Caregiver that a High_Risk_Part may proceed. Approval is a separate act from claiming.
- **Self_Approval**: An Approval given by the Owner of the Part, allowed only when that Owner is the only active Primary_Caregiver of the Household at the moment the server processes the approval.
- **Resubmission**: An explicit request by the Owner of a Part with the Approval_State `rejected` to have the Part approved again, together with at least one of: a written explanation, Evidence, or a changed plan (a changed Key_Fact or Actual_Performer).
- **Closed_Part**: A Part whose Progress_Status is `completed`, `cancelled`, or `failed`.
- **Reopen**: An explicit action by a Member that moves a `failed` Part back to an open Progress_Status.
- **Evidence**: A photo, file, or written confirmation that a Part was done, as listed in `care_steps.evidence_required`.
- **Appointment_Time**: The date and time at which a visit or appointment takes place, in a stated timezone. Appointment_Time is a fact about the event and is never used as a deadline by itself.
- **Respond_By_Time**: The claim deadline of a Part: the time by which the Part must have an Owner who has accepted the Part. Respond_By_Time checks only whether someone has claimed the Part.
- **Task_Due_Time**: The completion deadline of a Part, confirmed by a person in the Household: the time by which the Part must be `completed`.
- **Time_Provenance**: A marker stored with each Respond_By_Time and Task_Due_Time value that records whether a person set or confirmed the value (`human_confirmed`) or the value came from ai& or legacy model output (`model_suggested`).
- **Escalation**: The process of notifying the responsible Members, marking the Part as `escalated`, and recording an audit event.
- **Family_Feed**: The in-app, newest-first list of Feed_Items for a Household.
- **Feed_Item**: One entry in the Family_Feed, for example "New note from Grandma", "Ken will drive", or "Nobody has claimed the clinic visit yet".
- **In_App_Reminder**: A Feed_Item addressed to one Member that the Member sees when the Member opens Fudepan.
- **Capture_Screen**: The phone-first screen where a Member takes a photo of a note.
- **Recipient_View**: The simplified, large-text screen for the Care_Recipient.
- **Event_View**: The full Shared_Care_Event screen for Family_Members.
- **Recognizer**: The existing server-side pipeline that sends the Note_Photo to ai&, validates the result with Zod, normalizes it, and saves a Care_Chain draft.
- **Action_Guard**: The shared server-side checks for claim, Assignment, Handover, Approval, and completion that both the new routes and the existing `/care` server actions call.
- **Escalation_Checker**: The existing server-side escalation detection, extended to cover unclaimed Parts, completion deadlines, and pending Handovers.
- **Audit_Trail**: The append-only `audit_events` table.
- **Timeline**: The plain-language, per-Shared_Care_Event list of audit events shown in the Event_View, gathered from events linked to the note and events linked to the note's Care_Chains.
- **Risk_Label**: The text that names a Part's risk level: "Low priority" (low), "Needs attention" (medium), or "High risk" (high).
- **Approval_Label**: The text that names a Part's approval or completion outcome: "Requires confirmation" (Approval_State `pending`), "Confirmed" (`approved`), "Not approved" (`rejected`), or "Done" (Progress_Status `completed`).
- **Masked_Log**: Server log output in which names, addresses, insurance numbers, government IDs, medication names, bank and payment data, and image bytes are masked or removed.

## Requirements

### Requirement 1: Photographing a note starts everything

**User Story:** As a Care_Recipient, I want to take a photo of my handwritten note and be done, so that I do not have to learn an app.

#### Acceptance Criteria

1. THE Capture_Screen SHALL present one primary action labelled in plain language (for example "Take a photo of your note") that opens the phone's rear camera.
2. WHERE the device has no camera or the person declines camera access, THE Capture_Screen SHALL offer choosing an existing photo from the device as an alternative.
3. WHEN a Member confirms a photo on the Capture_Screen, THE Fudepan SHALL store the original photo as the Note_Photo in private Supabase Storage and start the Recognizer without any further action from the Member.
4. THE Fudepan SHALL allow a Care_Recipient to create a Note_Photo in the Care_Recipient's own Household.
5. IF the photo fails file signature validation or exceeds the existing size limit, THEN THE Capture_Screen SHALL show a plain-language message that names the problem and offers "Take the photo again".
6. IF storing the Note_Photo fails, THEN THE Capture_Screen SHALL keep the photo on the screen and offer "Try again" without asking the Member to take the photo again.
7. WHEN the Note_Photo is stored and the Shared_Care_Event is visible in the Family_Feed under Requirement 4.8, THE Capture_Screen SHALL tell the Member in plain language that the family can now see the note (for example "Sent to your family. You're done.").
8. WHEN a Note_Photo is stored, THE Fudepan SHALL record a `note.uploaded` audit event with the actor Member and no image data.
9. WHILE a photo is shown for confirmation and before the Member confirms the photo, THE Capture_Screen SHALL state in plain language that the photo will be sent to ai& for reading and will be visible to Authorized_Household_Members.

### Requirement 2: Recognition runs on the server and never guesses

**User Story:** As a Family_Member, I want the note to be read automatically and safely, so that the family gets a clear list of Parts without made-up details.

#### Acceptance Criteria

1. WHEN the Recognizer starts for a note, THE Recognizer SHALL record an extraction-attempted audit event.
2. THE Recognizer SHALL call ai& only from server-side code and SHALL send only the Note_Photo of the current note and the minimum household context needed.
3. WHEN ai& returns output that passes Zod validation, THE Recognizer SHALL save one Care_Chain draft with all of its Parts for the note and record an extraction-succeeded audit event.
4. IF ai& returns invalid, incomplete, or unsafe output, THEN THE Recognizer SHALL save no Care_Chain from that output, record an extraction-failed audit event, and mark the note as `extraction_failed`.
5. WHEN a note is marked `extraction_failed`, THE Family_Feed SHALL show the same Shared_Care_Event with the text "Could not read this note", an action to retry recognition, and an action to view the original Note_Photo.
6. THE Recognizer SHALL store no model-guessed due time, Respond_By_Time, Task_Due_Time, or escalation time on an appointment Part.
7. WHEN the note quote contains a literal date or time, THE Event_View SHALL show that date or time as a suggestion together with its source quote and the timezone it will be saved in, and SHALL require a person to confirm it.
8. WHEN ai& proposes a Suggested_Role for a Part, THE Event_View SHALL label the Suggested_Role as a suggestion and SHALL leave the Part unclaimed.
9. WHEN the note contains a medical question, THE Recognizer SHALL produce a Part to ask a qualified professional and SHALL produce no answer, diagnosis, dosage, or medication change.
10. WHEN the Recognizer saves a Care_Chain draft, THE Recognizer SHALL, in one database transaction and in this order, write the Care_Chain, write all of its Parts with an empty `care_steps.audit_event_id`, write the extraction-succeeded audit event, set the `audit_event_id` of every Part of the draft to that audit event, and mark the note as ready for review.
11. IF any write in the draft-saving transaction of Requirement 2.10 fails, THEN THE Recognizer SHALL roll back the whole transaction so that no Care_Chain, Part, or extraction-succeeded audit event of that draft remains, then mark the note as `extraction_failed` and record an extraction-failed audit event.
12. WHEN recognition is requested more than once for the same note, including repeated taps, retries, and concurrent requests, THE Recognizer SHALL keep at most one Usable_Draft for that note.
13. WHILE a recognition run for a note is in progress, THE Recognizer SHALL refuse to start a second run for that note and SHALL report the note as "Being read".
14. WHEN the Member closes or leaves the Capture_Screen after the Note_Photo is stored, THE Recognizer SHALL continue the recognition run to success or failure.
15. WHEN a Member retries recognition from a Shared_Care_Event whose note is `extraction_failed`, THE Recognizer SHALL run on the same note and Note_Photo, and THE Fudepan SHALL show the result in the same Shared_Care_Event.
16. WHEN the draft-saving transaction of Requirement 2.10 commits, THE Recognizer SHALL have linked every Part of that draft to the draft's extraction-succeeded audit event through `care_steps.audit_event_id`.

### Requirement 3: One note becomes one Shared Care Event

**User Story:** As a Family_Member, I want each note to appear as one shared event with its Parts, so that the family can see the whole picture in one place.

#### Acceptance Criteria

1. WHEN a Care_Chain draft is saved for a note, THE Fudepan SHALL present the note as exactly one Shared_Care_Event built from that note and its newest Usable_Draft.
2. THE Event_View SHALL show, for every Part: what needs to happen, the Helpers and their Helper_Roles, the Progress_Status in words, the Approval_State in words, the Missing_Details, the Evidence required, and whether Approval is required.
3. THE Event_View SHALL show a link to view the original Note_Photo through the membership-checked image route, with meaningful alt text.
4. THE Event_View SHALL show, for each Part with a Respond_By_Time, what happens if nobody claims the Part, in plain language (for example "If nobody accepts by Thu 6 pm, Misa and Ken will be notified").
5. WHEN a Member opens a Shared_Care_Event, THE Fudepan SHALL show the data only if the Member belongs to the Shared_Care_Event's Household.
6. THE Event_View SHALL show the Appointment_Time, the Respond_By_Time, and the Task_Due_Time of a Part as three separately labelled values, each with its timezone, and SHALL show "Not set yet" for each value that is absent.

### Requirement 4: Family Feed

**User Story:** As a Family_Member, I want a feed of what is new in my family's care, so that I notice new notes and changes without being told by someone.

#### Acceptance Criteria

1. THE Family_Feed SHALL list Feed_Items for the Member's Household in newest-first order.
2. WHEN a Shared_Care_Event is created, a Part is claimed or released, an Assignment or Handover is requested, accepted, or declined, a Part is approved or rejected, a Part needs re-approval, a Part is completed, Evidence is added, a Missing_Detail is resolved, or a Part is escalated, THE Fudepan SHALL add one Feed_Item that names the Member who acted and the Part affected.
3. THE Family_Feed SHALL mark Feed_Items that the Member has not yet seen as new, using text in addition to any color.
4. WHILE a Shared_Care_Event has unclaimed Parts or unresolved Missing_Details, THE Family_Feed SHALL show that Shared_Care_Event in a "Needs someone" section above other Feed_Items.
5. THE Family_Feed SHALL show Feed_Items only from Households the Member belongs to.
6. THE Feed_Item text SHALL contain no medication names, insurance numbers, government IDs, addresses, or bank or payment data.
7. WHEN the Family_Feed has new Feed_Items while open, THE Family_Feed SHALL announce the update to screen readers through a polite live region.
8. WHEN a Note_Photo is stored, THE Family_Feed SHALL show the note's Shared_Care_Event to Authorized_Household_Members labelled "Being read" before the Recognizer finishes.
9. WHEN the Recognizer saves a Usable_Draft for a note, THE Family_Feed SHALL replace the "Being read" label of that Shared_Care_Event with the event's Parts.
10. WHEN a Backup_Request is made, accepted, or declined, a Handover closes as not accepted, a Part is resubmitted for Approval, or a Part is Reopened, THE Fudepan SHALL add one Feed_Item that names the Member who acted (or states that the request expired) and the Part affected.

### Requirement 5: Claiming a Part

**User Story:** As a Family_Member, I want to claim a Part myself, so that the family knows who is taking care of it.

#### Acceptance Criteria

1. WHEN a Family_Member selects "I'll do this" on an unclaimed Part, THE Fudepan SHALL record that Family_Member as the Owner of the Part.
2. THE Fudepan SHALL create a Claim only from an explicit action by the claiming Member, or from an Assignment that the receiving Member accepts.
3. THE Fudepan SHALL create no Claim from a Suggested_Role, a Person_To_Ask, or any other ai& output.
4. IF two Members claim the same Helper_Role on the same Part at the same time, THEN THE Fudepan SHALL keep the first committed Claim and SHALL tell the other Member who already claimed the Part.
5. WHEN a Claim is recorded on a High_Risk_Part, THE Fudepan SHALL keep the Part's Approval requirement unchanged, and SHALL keep the Approval_State unchanged unless Requirement 9.22 resets the Approval_State.
6. WHEN a Claim is recorded, THE Fudepan SHALL record a claim audit event with the Member, the Part, and the Helper_Role.
7. WHEN a Primary_Caregiver starts an Assignment of a Part to another Member, THE Fudepan SHALL show the Part as "Waiting for {name} to accept" until that Member accepts or declines.
8. WHEN a Member claims a Part that has no Backup_Owner, THE Event_View SHALL ask whether another Member will be the backup, and SHALL allow continuing without one.
9. WHILE an Assignment is waiting for acceptance, THE Fudepan SHALL keep the Part's current Owner, or no Owner, unchanged.
10. WHEN the receiving Member accepts an Assignment, THE Fudepan SHALL record the receiving Member as Owner and record an assignment-accepted audit event.
11. WHEN the receiving Member declines an Assignment, THE Fudepan SHALL keep the Part's Owner unchanged, record an assignment-declined audit event, and add an In_App_Reminder for the Primary_Caregiver who started the Assignment.
12. IF a Member who is not a Primary_Caregiver attempts to start an Assignment, THEN THE Action_Guard SHALL refuse the request with a plain-language reason.
13. IF a Care_Recipient attempts to claim a Part, THEN THE Action_Guard SHALL refuse the request with a plain-language reason.
14. WHEN the Owner of a Part or a Primary_Caregiver names another Member as Backup_Owner, THE Action_Guard SHALL record a pending Backup_Request, keep the Part's current Backup_Owner (or no Backup_Owner) unchanged, record a backup-requested audit event, and add an In_App_Reminder for the receiving Member.
15. WHEN the receiving Member accepts a Backup_Request, THE Fudepan SHALL record the receiving Member as Backup_Owner and record a backup-accepted audit event.
16. WHEN the receiving Member declines a Backup_Request, THE Fudepan SHALL keep the Part's current Backup_Owner (or no Backup_Owner) unchanged, record a backup-declined audit event, and add an In_App_Reminder for the Member who made the Backup_Request.
17. WHEN a Family_Member volunteers as Backup_Owner of a Part, THE Fudepan SHALL record that Family_Member as Backup_Owner directly and record a backup-accepted audit event.
18. THE Fudepan SHALL allow a Part to have no Backup_Owner, and SHALL treat a Part without a Backup_Owner as valid for claiming, Approval, and completion.
19. THE Action_Guard SHALL apply Requirements 5.14 through 5.17 to Backup_Owner changes from both the new routes and the existing `/care` owner assignment action.

### Requirement 6: Helper roles: Companion and Driver

**User Story:** As a Family_Member, I want to volunteer to accompany or drive Grandma, so that the visit is covered by more than one person when needed.

#### Acceptance Criteria

1. WHERE a Part involves the Care_Recipient going somewhere, THE Event_View SHALL offer "I'll go with her" (Companion) and "I'll drive" (Driver) in addition to the Owner Claim.
2. WHEN a Member volunteers as Companion or Driver, THE Fudepan SHALL record a Claim with that Helper_Role and record an accompany-volunteered or driver-volunteered audit event.
3. THE Fudepan SHALL allow, on one Part, exactly one Owner at most, one Driver at most, and one Companion at most.
4. THE Fudepan SHALL allow the same Member to hold more than one Helper_Role on one Part.
5. WHILE a Part involving transport of the Care_Recipient has no Driver, THE Event_View SHALL show "No driver yet" as a Missing_Detail of that Part.
6. THE Fudepan SHALL treat a Driver Claim for transport of the Care_Recipient as a High_Risk_Part claim that requires Approval before the transport is marked done.
7. THE Recognizer SHALL produce shopping and medicine pickup as separate Parts, and THE Fudepan SHALL offer no Helper_Role for shopping or medicine pickup.

### Requirement 7: Releasing a Claim

**User Story:** As a Helper, I want to give back a Part I can no longer do, so that someone else can take it in time.

#### Acceptance Criteria

1. WHEN a Helper selects "I can't do this anymore" on a Part that has no Task_Due_Time within the next 24 hours and is not past its Task_Due_Time, THE Fudepan SHALL remove the Helper's Claim and mark that Helper_Role as unclaimed.
2. WHILE a High_Risk_Part has a Task_Due_Time within the next 24 hours or is past its Task_Due_Time without being `completed`, THE Fudepan SHALL keep the current Helper in the Helper_Role until another Member accepts a Handover of that Helper_Role.
3. WHEN a Claim is released, THE Fudepan SHALL record an unclaim audit event and add a Feed_Item that says the Part needs someone.
4. IF a release is refused under Requirement 7.2, THEN THE Event_View SHALL explain in plain language that the Part is due soon or overdue and offer "Hand this to someone".

### Requirement 8: Handing a Part over

**User Story:** As a Helper, I want to pass my Part to another family member, so that responsibility moves cleanly instead of being dropped.

#### Acceptance Criteria

1. WHEN a Helper requests a Handover of a Claim to another Member of the same Household, THE Fudepan SHALL record a pending Handover and show the Part as "Being handed to {name}".
2. THE Fudepan SHALL offer only active Family_Members of the Part's Household as Handover recipients.
3. WHILE a Handover is pending, THE Fudepan SHALL keep the requesting Helper as the holder of the Claim.
4. WHEN the receiving Member accepts the Handover, THE Fudepan SHALL move the Claim to the receiving Member and record a handover-accepted audit event.
5. WHEN the receiving Member declines the Handover, THE Fudepan SHALL keep the Claim with the requesting Helper, record a handover-declined audit event, and add an In_App_Reminder for the requesting Helper.
6. IF a pending Handover of the Owner Claim reaches the Handover_Expiry_Time without acceptance, THEN THE Fudepan SHALL close that Handover as not accepted, keep the requesting Helper as Owner, record a handover-not-accepted audit event that names the Owner Helper_Role, and add an In_App_Reminder for the requesting Helper and the receiving Member.
7. WHEN a Handover of a High_Risk_Part with the Approval_State `approved` changes the Owner or another Actual_Performer, THE Fudepan SHALL reset the Approval_State under Requirement 9.22, record an approval-reset audit event that names the changed Helper_Role, and add an In_App_Reminder for every Primary_Caregiver that the Part needs confirmation again.
8. WHEN a Handover is requested, THE Fudepan SHALL record a handover-requested audit event.
9. IF a pending Handover of a Driver or Companion Claim reaches the Handover_Expiry_Time without acceptance, THEN THE Fudepan SHALL close that Handover as not accepted, keep the requesting Helper in that Helper_Role, keep the Owner unchanged, record a handover-not-accepted audit event that names the Helper_Role, and add an In_App_Reminder for the requesting Helper and the receiving Member.
10. WHEN a Handover is requested on a Part without a `human_confirmed` Task_Due_Time, THE Fudepan SHALL set the Handover_Expiry_Time to 24 hours after the request and show that time with its timezone on the Handover.
11. IF a Member accepts a Handover after the Handover's Handover_Expiry_Time, THEN THE Action_Guard SHALL refuse the acceptance, close the Handover as not accepted under Requirement 8.6 or 8.9, keep the Claim with the requesting Helper, and tell the Member in plain language that the request has expired, whether or not the Escalation_Checker has run since the Handover_Expiry_Time.
12. WHEN a Handover closes as not accepted, THE Fudepan SHALL keep every other Claim, Handover, Assignment, and Backup_Request of the Part unchanged.
13. WHEN a Handover of the Owner Claim of a High_Risk_Part closes as not accepted and the Part is past its Task_Due_Time, THE Escalation_Checker SHALL escalate the Part under Requirement 12.2 with the requesting Helper as Owner.

### Requirement 9: Approval stays separate from claiming

**User Story:** As a Primary_Caregiver, I want high-risk Parts to need an explicit confirmation, so that nothing risky happens just because someone clicked "I'll do this".

#### Acceptance Criteria

1. WHILE a High_Risk_Part has the Approval_State `pending`, THE Event_View SHALL show "Requires confirmation" in text and SHALL disable "Mark as done" with a visible reason.
2. WHEN a Primary_Caregiver approves or rejects a High_Risk_Part, THE Fudepan SHALL set the Approval_State to `approved` or `rejected` and record a human-approved or human-rejected audit event with that Primary_Caregiver as actor.
3. IF a request to complete a Part with `approval_required = true` arrives while the Approval_State is not `approved`, THEN THE Action_Guard SHALL refuse the completion and return a plain-language reason.
4. THE Fudepan SHALL perform no payment, external message, medication change, appointment cancellation, care record deletion, or external data sharing on behalf of the Household.
5. IF a Member who is not a Primary_Caregiver of the Part's Household attempts to approve or reject a High_Risk_Part, THEN THE Action_Guard SHALL refuse the request, keep the Approval_State unchanged, and return a plain-language reason.
6. IF the Owner of a High_Risk_Part attempts to approve that Part while the Household has two or more active Primary_Caregivers, THEN THE Action_Guard SHALL refuse the approval, keep the Approval_State unchanged, and state that another Primary_Caregiver needs to confirm.
7. WHEN the Owner of a High_Risk_Part is the only active Primary_Caregiver of the Household and explicitly approves the Part, THE Fudepan SHALL set the Approval_State to `approved` and record the human-approved audit event marked as a Self_Approval.
8. THE Fudepan SHALL store the Approval_State of a Part independently of the Part's Progress_Status, so that a change of Progress_Status (for example to `evidence_required` or `escalated`) leaves the Approval_State unchanged.
9. WHEN a Key_Fact of a High_Risk_Part with the Approval_State `approved` changes, THE Fudepan SHALL set the Approval_State to `pending`, record an approval-reset audit event that names the changed Key_Fact without its value, and add an In_App_Reminder for every Primary_Caregiver.
10. WHEN a Part's Approval_State becomes `approved`, THE Fudepan SHALL show "Confirmed" instead of "Requires confirmation" for that Part.
11. WHEN a Part's Approval_State becomes `rejected`, THE Fudepan SHALL show "Not approved" for that Part together with the name of the Primary_Caregiver who rejected the Part.
12. WHILE a Part is `completed`, THE Fudepan SHALL show "Done" for that Part and SHALL show no "Requires confirmation" or other pending-approval text for that Part.
13. THE Action_Guard SHALL apply Requirements 9.3, 9.5, 9.6, and 9.7 to approval requests from both the new routes and the existing `/care` server actions.
14. WHEN the server processes an approval or rejection request, THE Action_Guard SHALL evaluate the acting Member's active status, the acting Member's role, and the count of active Primary_Caregivers of the Part's Household at that moment, and SHALL use no earlier cached value.
15. WHEN the Timeline shows a human-approved audit event marked as a Self_Approval, THE Timeline SHALL label the event "Self-approval" in text.
16. IF a Primary_Caregiver attempts to approve a Part whose Approval_State is `rejected` and no Resubmission has been made since the rejection, THEN THE Action_Guard SHALL refuse the approval, keep the Approval_State `rejected`, and state in plain language that the Owner must resubmit the Part first.
17. WHEN the Owner of a Part with the Approval_State `rejected` makes a Resubmission, THE Fudepan SHALL set the Approval_State to `pending`, record an approval-resubmitted audit event that names which kinds of content were added (explanation, Evidence, or changed plan) without their values, and add an In_App_Reminder for every Primary_Caregiver.
18. IF a Resubmission contains no explanation, no new Evidence, and no changed plan, THEN THE Action_Guard SHALL refuse the Resubmission, keep the Approval_State `rejected`, and state that an explanation, Evidence, or a changed plan is needed.
19. WHEN the Owner makes a Resubmission that keeps the original plan and includes a written explanation, THE Fudepan SHALL accept the Resubmission under Requirement 9.17.
20. WHEN a Resubmission is accepted, THE Audit_Trail SHALL keep the earlier human-rejected audit event, and THE Timeline SHALL show both the rejection and the Resubmission.
21. WHILE a High_Risk_Part has the Approval_State `rejected`, THE Fudepan SHALL keep the Approval_State `rejected` when a Key_Fact or an Actual_Performer of the Part changes, until the Owner makes a Resubmission.
22. WHEN a change of the Owner or of another Actual_Performer of a High_Risk_Part with the Approval_State `approved` is saved through any path, including Claim, Claim release, Assignment acceptance, Handover acceptance, and the existing `/care` owner assignment action, THE Fudepan SHALL set the Approval_State to `pending` in the same database transaction as the change.
23. IF the Approval_State reset of Requirement 9.22 cannot be saved, THEN THE Fudepan SHALL roll back the change of the Owner or Actual_Performer and tell the Member in plain language that the change was not saved.
24. WHEN a Key_Fact change resets the Approval_State under Requirement 9.9, THE Fudepan SHALL save the reset in the same database transaction as the Key_Fact change.

### Requirement 10: Filling in missing details

**User Story:** As a Family_Member, I want to see exactly what the note did not say and fill it in, so that nobody has to guess.

#### Acceptance Criteria

1. THE Event_View SHALL list each Missing_Detail of a Part as a plain-language question (for example "Which clinic?") with the reason the detail is needed.
2. WHEN a Member saves an appointment's date, time, timezone, or location, THE Fudepan SHALL save the value through the existing `save_appointment_clarification` function and record the change in the Audit_Trail.
3. IF a Member submits a Missing_Detail form with an empty or invalid value, THEN THE Event_View SHALL keep the entered values and name the field and the problem in the error message.
4. WHEN the note names a Person_To_Ask (for example "Ask Misa which clinic"), THE Event_View SHALL show "Ask {name}" as a hint on an unclaimed Part that any Family_Member may claim.
5. WHILE a Part has an unresolved Missing_Detail of date, time, or location, THE Fudepan SHALL show the Part as "Needs details" and SHALL set no Respond_By_Time or Task_Due_Time derived from that detail.
6. THE Recognizer SHALL record a Person_To_Ask only as text on the Part and SHALL set no Owner, Helper, Assignment, or Claim for the Person_To_Ask.
7. WHEN a Member saves a Respond_By_Time or Task_Due_Time for a Part, THE Fudepan SHALL store the value with the Time_Provenance `human_confirmed`, the timezone, and the acting Member, and record a time-confirmed audit event.

### Requirement 11: Completion and Evidence

**User Story:** As a Helper, I want to mark my Part done and attach proof, so that the family knows it really happened.

#### Acceptance Criteria

1. WHEN the Owner of a Part marks the Part done and all required Evidence is attached and the Approval_State is `approved` or `not_required`, THE Fudepan SHALL set the Part to `completed` and record a task-completed audit event.
2. WHEN a Helper attaches Evidence, THE Fudepan SHALL store the Evidence file in private Supabase Storage, store only its path in the database, and record an evidence-uploaded audit event.
3. IF Evidence is required and missing when the Owner marks the Part done, THEN THE Fudepan SHALL set the Part's Progress_Status to `evidence_required`, keep the Approval_State unchanged, and list the missing Evidence by name.
4. WHEN a Helper reports that a Part could not be done, THE Fudepan SHALL set the Part to `failed`, record a task-failed audit event, and add a Feed_Item that the Part needs attention.
5. WHEN every Part of a Shared_Care_Event is `completed` or `cancelled`, THE Family_Feed SHALL show the Shared_Care_Event as done.
6. IF a Member who is not the current Owner of a Part attempts to mark the Part done, THEN THE Action_Guard SHALL refuse the request and return a plain-language reason that names the Owner.
7. WHEN the Owner marks a Part done whose Progress_Status is `evidence_required` or `escalated`, THE Action_Guard SHALL decide completion from the Approval_State and the Evidence only.
8. THE Action_Guard SHALL apply Requirements 11.1, 11.6, and 11.7 to completion requests from both the new routes and the existing `/care` server actions.

### Requirement 12: Nobody silently drops a Part

**User Story:** As a family, we want to know what happens if nobody responds, so that care responsibilities never quietly expire.

#### Acceptance Criteria

1. WHEN the Escalation_Checker runs and finds a High_Risk_Part past its Respond_By_Time with no Owner who has accepted the Part, THE Escalation_Checker SHALL add an In_App_Reminder for every Primary_Caregiver and for the Backup_Owner if one is set, mark the Part as `escalated`, and record a task-escalated audit event that names the Respond_By_Time as the reason.
2. WHEN the Escalation_Checker runs and finds a High_Risk_Part past its Task_Due_Time that is not a Closed_Part, THE Escalation_Checker SHALL add an In_App_Reminder for the Owner and the Backup_Owner, mark the Part as `escalated`, and record a task-escalated audit event that names the Task_Due_Time as the reason.
3. WHEN the Escalation_Checker runs more than once for the same overdue Part, THE Escalation_Checker SHALL produce exactly one escalation for each Respond_By_Time value and each Task_Due_Time value.
4. WHILE a High_Risk_Part has no `human_confirmed` Respond_By_Time and no `human_confirmed` Task_Due_Time, THE Event_View SHALL show "No deadline yet. Someone needs to confirm the date." and THE Family_Feed SHALL keep the Part in the "Needs someone" section.
5. WHEN a Part is escalated, THE Family_Feed SHALL add a Feed_Item that states, in words, that the Part is overdue and who was notified.
6. THE Escalation_Checker SHALL use only Respond_By_Time and Task_Due_Time values with the Time_Provenance `human_confirmed`.
7. IF an appointment Part has a due time or escalation time without the Time_Provenance `human_confirmed`, including legacy model-guessed values, THEN THE Escalation_Checker SHALL ignore that value.
8. THE Escalation_Checker SHALL use Respond_By_Time only to check whether a Part has an accepted Owner, and SHALL use Task_Due_Time only to check whether a Part is closed.
9. WHEN the Escalation_Checker marks a Part as `escalated`, THE Escalation_Checker SHALL keep the Part's Approval_State unchanged.
10. WHILE a low-risk Part is unclaimed, THE Family_Feed SHALL show the Part in the "Needs someone" section, and THE Escalation_Checker SHALL create no scheduled reminder for that Part.
11. WHILE a Part's Progress_Status is `completed` or `cancelled`, THE Escalation_Checker SHALL skip the Part in every Respond_By_Time and Task_Due_Time check and SHALL leave the Part's Progress_Status unchanged.
12. WHILE a Part's Progress_Status is `failed`, THE Escalation_Checker SHALL skip the Part in every Respond_By_Time and Task_Due_Time check until a Member Reopens the Part.
13. WHEN the Owner of a `failed` Part or a Primary_Caregiver Reopens the Part, THE Fudepan SHALL set the Part's Progress_Status to `in_progress`, keep the Approval_State unchanged, record a task-reopened audit event, and add a Feed_Item that the Part is open again.
14. WHEN a Part has been Reopened, THE Escalation_Checker SHALL include the Part in its next run under Requirements 12.1 and 12.2.

### Requirement 13: Simple view for the Care Recipient

**User Story:** As a Care_Recipient, I want to see in big, simple words who is helping me and what is still open, so that I feel informed without managing anything.

#### Acceptance Criteria

1. THE Recipient_View SHALL show the Capture_Screen action and the Care_Recipient's Shared_Care_Events, and no other navigation.
2. THE Recipient_View SHALL describe each Part in one plain sentence, for example "Ken will drive you to the clinic on Fri, Nov 27 at 2:30 pm" or "Nobody has said they will pick up your glasses yet".
3. THE Recipient_View SHALL show every Part's status in words and SHALL use color only in addition to words.
4. THE Recipient_View SHALL use body text of at least 20 CSS pixels and touch targets of at least 48 by 48 CSS pixels.
5. THE Recipient_View SHALL present Shared_Care_Events as read-only, with the Capture_Screen action as the only action.
6. THE Recipient_View SHALL show no confidence scores, raw ai& output, or technical status codes.
7. IF a Care_Recipient attempts to claim, approve, hand over, or complete a Part, THEN THE Action_Guard SHALL refuse the request with a plain-language reason.

### Requirement 14: Household-only sharing and access

**User Story:** As a family, we want sharing to stay inside our household, so that private care information does not leak.

#### Acceptance Criteria

1. THE Fudepan SHALL limit every Claim, Assignment, Handover, Feed_Item, and Shared_Care_Event to Members of the same Household, enforced by RLS or by server-side membership checks.
2. IF a Member attempts to claim, assign, hand over, approve, or complete a Part outside the Member's Households, THEN THE Action_Guard SHALL refuse the request and reveal no data about the Part.
3. THE Fudepan SHALL offer no action that shares a Shared_Care_Event, Part, or Note_Photo with a person outside the Household.
4. THE Audit_Trail SHALL accept new rows and SHALL refuse updates and deletes from client roles.
5. THE Fudepan SHALL describe who can see a note as "authorized household members" wherever the UI states the sharing scope.

### Requirement 15: Audit Trail coverage

**User Story:** As a family, we want every important action recorded, so that we can see what happened and who did it.

#### Acceptance Criteria

1. THE Fudepan SHALL record an audit event for each of: note photo stored, extraction attempted, extraction succeeded, extraction failed, Care_Chain created, Care_Chain edited, Claim recorded, Claim released, Assignment started, Assignment accepted, Assignment declined, Companion volunteered, Driver volunteered, Handover requested, Handover accepted, Handover declined, Handover not accepted by the deadline, Approval given, Self_Approval given, Approval rejected, Approval reset, time confirmed, Missing_Detail resolved, Evidence uploaded, Part completed, Part failed, Part escalated, and In_App_Reminder sent.
2. THE Fudepan SHALL record the actor type and, for human actions, the acting Member in every audit event.
3. THE Fudepan SHALL store in audit event payloads no raw note text, image data, medication names, insurance numbers, government IDs, addresses, or bank or payment data.
4. THE Event_View SHALL provide a Timeline of the Shared_Care_Event's audit events in plain language, newest first.
5. THE Timeline SHALL name, for each human event, the acting Member and the affected Part, and for each Approval whether the Approval was a Self_Approval.
6. THE Fudepan SHALL also record an audit event for each of: Backup_Request made, Backup_Request accepted, Backup_Request declined, Approval resubmitted, and Part reopened.
7. WHEN the Fudepan records an audit event about a note before any Care_Chain exists for that note (for example note photo stored or extraction attempted), THE Fudepan SHALL link the audit event to the note through the note's identifier.
8. THE Timeline SHALL gather the audit events linked to the Shared_Care_Event's note together with the audit events linked to any Care_Chain of that note, and SHALL show each audit event exactly once.

### Requirement 16: Privacy in logs and errors

**User Story:** As a family, we want our sensitive details kept out of logs, so that operators and tools never see them in plain text.

#### Acceptance Criteria

1. THE Fudepan SHALL write server logs for capture, recognition, claim, Assignment, Handover, approval, completion, and escalation only as Masked_Log output.
2. IF a server error occurs in any new flow, THEN THE Fudepan SHALL show the Member a plain-language message without prompt contents, raw ai& output, or stack traces.
3. THE Fudepan SHALL keep `AIAND_API_KEY` and the Supabase service role key out of every client bundle.

### Requirement 17: Phone-first and accessible

**User Story:** As a busy caregiver or an older adult, I want the screens to work well on my phone with large text and screen readers, so that I can act in a few taps.

#### Acceptance Criteria

1. THE Capture_Screen, Family_Feed, Event_View, and Recipient_View SHALL render without horizontal scrolling at a viewport width of 360 CSS pixels.
2. THE Fudepan SHALL show a Part's risk level as the Risk_Label "Low priority", "Needs attention", or "High risk" in text wherever risk is shown, and SHALL show the Approval_Label "Requires confirmation" only for a Part whose Approval_State is `pending`, "Confirmed" for `approved`, and "Done" for a `completed` Part under Requirements 9.10 and 9.12.
3. THE Fudepan SHALL make every action in the new screens reachable and operable by keyboard with a visible focus indicator.
4. THE Fudepan SHALL give every form control in the new screens a programmatic label and mark required fields in text and programmatically.
5. WHEN a Claim, Assignment, Handover, Approval, or completion succeeds or fails, THE Fudepan SHALL announce the result to screen readers.
6. THE Fudepan SHALL use plain language with no technical terms such as "step", "chain", "extraction", or "status code" in the new screens.
7. THE Fudepan SHALL show the new screens in the UI language of each Member's language setting.
8. THE Fudepan SHALL show the Capture_Screen, Family_Feed, Event_View including its approval and Handover actions, Recipient_View, and all error messages of the new flow in Japanese for Members whose language setting is Japanese.
9. THE Event_View and Recipient_View SHALL show the note's recognized original text as written, without translation, regardless of the Member's UI language.
10. WHEN the core flow is accepted for the first release, THE Fudepan SHALL pass the acceptance checks of photo capture, Family_Feed, Approval, Handover, and error messages with the UI language set to Japanese.
11. THE Fudepan SHALL show a Japanese equivalent of each Risk_Label and Approval_Label to Members whose language setting is Japanese, and SHALL keep each label distinct from every other label.

### Requirement 18: New routes next to the old pages

**User Story:** As the product team, we want the new flow built alongside the current pages, so that we can switch over safely without losing data.

#### Acceptance Criteria

1. THE Fudepan SHALL serve the Capture_Screen, Family_Feed, Event_View, and Recipient_View on new routes while the existing `/notes` and `/care` routes keep working.
2. THE Fudepan SHALL add new tables and columns only through additive migrations that keep existing rows and existing constraints valid.
3. WHEN the new flow is used on a note created by the old flow, THE Fudepan SHALL show that note as a Shared_Care_Event with its existing owners shown as Owners.
4. THE Fudepan SHALL remove the old `/notes` and `/care` pages only in a separate, later change after the new flow passes `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
5. THE existing `/care` server actions for owner assignment, approval, and completion SHALL call the Action_Guard and follow Requirements 5, 9, 11, and 21.
6. WHEN the Fudepan reads a legacy Part that has no stored Approval_State, THE Fudepan SHALL derive the Approval_State as `not_required` if `approval_required = false`, `approved` if the Part's status is `approved` or `completed`, and `pending` otherwise, without rewriting the legacy row.
7. WHEN a Key_Fact change or a change of the Owner or another Actual_Performer is saved on a legacy Part, THE Fudepan SHALL apply Requirements 9.9, 9.21, and 9.22 using the Approval_State derived under Requirement 18.6, and SHALL store the resulting Approval_State on that Part in the same database transaction as the change.
8. WHEN a legacy Part has a Backup_Owner set by the old flow, THE Fudepan SHALL keep that Backup_Owner, and SHALL apply Requirements 5.14 through 5.17 to every later Backup_Owner change on that Part.

### Requirement 19: In-app notifications for the Alpha

**User Story:** As a Family_Member, I want to see what needs me when I open Fudepan, so that I can respond even without email or SMS.

#### Acceptance Criteria

1. THE Fudepan SHALL deliver every notification in this feature as an In_App_Reminder.
2. WHEN a Member opens Fudepan and has In_App_Reminders that are unseen, THE Fudepan SHALL show the count of those In_App_Reminders in text on the main navigation.
3. WHEN a notification is created for a Member, THE Fudepan SHALL record a reminder-sent audit event that names the channel as `in_app`.
4. WHEN the Fudepan tells a Member that another Member was notified, THE Fudepan SHALL use the wording "{name} has an in-app reminder" so that the text does not imply email, SMS, or push delivery.

### Requirement 20: End-to-end shared flow is traceable

**User Story:** As the product team, we want one complete family scenario to work and be visible step by step, so that we know the shared flow holds together.

#### Acceptance Criteria

1. WHEN the Care_Recipient takes a photo of a note and closes the page before recognition finishes, THE Fudepan SHALL store the Note_Photo, finish the recognition run, and record the note-uploaded, extraction-attempted, and extraction-succeeded events in the Timeline.
2. WHEN a Family_Member opens the Family_Feed after the photo is stored, THE Family_Feed SHALL show the same Shared_Care_Event that the Care_Recipient's note created.
3. WHEN a Family_Member who is not a Primary_Caregiver claims a High_Risk_Part of that Shared_Care_Event, THE Fudepan SHALL record that Family_Member as Owner, keep the Approval_State `pending`, and record the claim in the Timeline.
4. IF that Family_Member then attempts to approve the High_Risk_Part, THEN THE Action_Guard SHALL refuse the approval and THE Timeline SHALL show no approval event for that attempt.
5. WHEN that Family_Member requests a Handover of the Owner Claim to a second Family_Member, THE Fudepan SHALL keep the requesting Family_Member as Owner and record the handover-requested event in the Timeline.
6. WHEN the second Family_Member accepts the Handover, THE Fudepan SHALL record the second Family_Member as Owner, keep the Approval_State `pending`, and record the handover-accepted event in the Timeline.
7. WHEN a Primary_Caregiver who is not the Owner approves the High_Risk_Part, THE Fudepan SHALL set the Approval_State to `approved`, show "Confirmed", and record the human-approved event in the Timeline.
8. WHEN the second Family_Member, as Owner, marks the High_Risk_Part done with all required Evidence attached, THE Fudepan SHALL set the Part to `completed`, show "Done", and record the task-completed event in the Timeline.
9. THE Timeline SHALL show the events of Requirements 20.1 through 20.8 in the order they happened, each with the acting Member or `ai` as actor.
10. THE Timeline of Requirement 20.9 SHALL include the note-uploaded and extraction-attempted events, which are linked to the note under Requirement 15.7 because no Care_Chain exists when they are recorded.

### Requirement 21: Owner changes always need the receiver's acceptance

**User Story:** As a Family_Member, I want nobody to be made responsible for a Part without agreeing, so that every Owner has actually accepted the Part.

#### Acceptance Criteria

1. IF a request sets the Owner of a Part to a Member other than the requesting Member, THEN THE Action_Guard SHALL record a pending Assignment or Handover instead of changing the Owner.
2. WHEN a Member sets the Member's own Claim on an unclaimed Part, THE Action_Guard SHALL record the Member as Owner directly.
3. THE Action_Guard SHALL apply Requirements 21.1 and 21.2 to owner changes from both the new routes and the existing `/care` owner assignment action.
4. IF an owner change request would remove the Owner of a Part, THEN THE Action_Guard SHALL apply the release rules of Requirement 7.
5. IF a request sets the Backup_Owner of a Part to a Member other than the requesting Member, including a request from the existing `/care` owner assignment action, THEN THE Action_Guard SHALL record a pending Backup_Request under Requirement 5.14 instead of changing `care_steps.backup_owner_id`.
6. WHEN an Assignment acceptance changes the Owner of a High_Risk_Part with the Approval_State `approved`, THE Fudepan SHALL reset the Approval_State under Requirement 9.22.

## Assumptions and Decisions (Alpha defaults)

- **D1. Approval rights (new, enforced on old and new pages).** Only an active Primary_Caregiver of the same Household may approve or reject a High_Risk_Part (Requirement 9.2, 9.5). With two or more active Primary_Caregivers, the Owner of a High_Risk_Part may not approve the Owner's own Part. With exactly one active Primary_Caregiver who is also the Owner, an explicit approval is allowed and is recorded and labelled in the Timeline as a Self_Approval (Requirement 9.6, 9.7, 9.15). Active status, role, and the count of active Primary_Caregivers are evaluated on the server when the approval is processed (Requirement 9.14). This is new behavior; the current `approveStep` action has no role check.
- **D2. Completion rights.** Only the current Owner may mark a Part done (Requirement 11.6). Completion checks the Approval_State and Evidence, not the Progress_Status (Requirement 11.7).
- **D3. Approval state is separate.** Approval_State (`not_required`, `pending`, `approved`, `rejected`) is stored apart from Progress_Status. An approved High_Risk_Part needs re-approval when the Owner changes, when the Driver or Companion changes, or when a Key_Fact changes, through any path (Claim, release, Assignment acceptance, Handover acceptance, old `/care` actions). The reset is saved in the same transaction as the change (Requirements 8.7, 9.9, 9.22 to 9.24, 21.6). A rejected Part stays rejected until the Owner makes a Resubmission with an explanation, Evidence, or a changed plan; keeping the original plan with an explanation is allowed, and the rejection stays in the Timeline (Requirements 9.16 to 9.21).
- **D4. Three times.** Appointment_Time is when the visit happens. Respond_By_Time is the claim deadline. Task_Due_Time is the family-confirmed completion deadline. Escalation for "nobody claimed" uses Respond_By_Time; escalation for "not done" uses Task_Due_Time (Requirement 12). The 24-hour release protection uses Task_Due_Time (Requirement 7).
- **D5. Time provenance.** Human-set deadlines carry `human_confirmed` provenance. Model-guessed and legacy values on appointment Parts stay ignored by the Escalation_Checker (Requirement 12.6, 12.7).
- **D6. Notifications.** In-app only. The UI says "{name} has an in-app reminder"; the family sees it when they open the app (Requirement 19). Sharing scope wording is "authorized household members" (Requirement 14.5). Before the photo is confirmed, the Capture_Screen says the photo will be sent to ai& for reading (Requirement 1.9).
- **D7. Roles per Part.** One Owner, at most one Driver, at most one Companion; the same person may hold more than one role. Shopping and medicine pickup are separate Parts, not Helper_Roles (Requirement 6.3, 6.7).
- **D8. Care_Recipient in the Alpha.** The Care_Recipient can take or upload the photo and view progress. Claiming, approving, handing over, and completing are done by Family_Members (Requirement 13.5, 13.7). The existing `private.can_upload_notes` function excludes `care_recipient` today; this feature changes that rule for the Care_Recipient's own Household (Requirement 1.4).
- **D9. Handover and Assignment.** The receiver always has to accept (Requirement 8, 21). Only a Primary_Caregiver may start an Assignment; `transport_coordinator`, `finance_coordinator`, and other roles get no extra assignment rights in the Alpha (Requirement 5.12). When a high-risk Handover changes the Actual_Performer, a Primary_Caregiver must re-approve (Requirement 8.7). A pending Handover expires at the Task_Due_Time, or 24 hours after the request when no Task_Due_Time is confirmed. On expiry only that request closes, the original holder stays responsible, and both Members get an In_App_Reminder. Acceptance re-checks expiry on the server (Requirements 8.6, 8.9 to 8.12). The Backup_Owner also has to accept, on old and new pages; the previous Backup_Owner stays until then, and a Part may have no Backup_Owner (Requirements 5.14 to 5.19, 21.5).
- **D10. Unclaimed low-risk Parts.** Shown in the "Needs someone" section only; no scheduled reminders in the Alpha (Requirement 12.10).
- **D11. UI language.** The UI language follows each Member's language setting, and the note's original text is always shown as written (Requirement 17.7, 17.9). Japanese families are the first target: the core flow (photo capture, Family_Feed, Approval, Handover, error messages) is accepted in Japanese (Requirement 17.8, 17.10, 17.11). The actual tester list is not yet confirmed.
- **D12. Person_To_Ask.** "Ask Misa which clinic" makes Misa the person to ask, not the assignee. Any Family_Member may claim that Part; ai& never assigns or pre-claims it (Requirement 10.4, 10.6).
- **D13. Recognition lifecycle.** The Shared_Care_Event appears as "Being read" as soon as the photo is stored, recognition continues if the page is closed, failures are retried from the same event, and repeated requests produce one Usable_Draft. The draft is saved in one transaction: Care_Chain, Parts (with `care_steps.audit_event_id` empty, which the existing schema allows), extraction-succeeded event, backfill of the Parts' `audit_event_id`, then the note's ready state (Requirement 2.10, 2.11, 2.16). Events recorded before a Care_Chain exists are linked to the note, and the Timeline gathers events by note and by Care_Chain (Requirement 15.7, 15.8, 20.10).
- **D14. Closed Parts.** `completed` and `cancelled` Parts are never escalated. `failed` Parts are re-checked only after an explicit Reopen by the Owner or a Primary_Caregiver (Requirement 12.2, 12.11 to 12.14).
- **D15. Risk and approval wording.** The risk level labels are "Low priority", "Needs attention", and "High risk". "Requires confirmation" is used only while approval is pending; approved shows "Confirmed", completed shows "Done" (Requirement 17.2). The accessibility steering uses the same labels.
- **D16. Legacy rows.** Approval_State is derived on read without rewriting legacy rows. Any later Key_Fact or people change on a legacy Part follows the new approval rules and stores the resulting Approval_State in the same transaction (Requirement 18.6 to 18.8).
- **A1. Mobile camera as the primary entry.** The Capture_Screen uses the browser's camera capture (`capture="environment"`) with a gallery fallback. The full original photo is stored unchanged as the Note_Photo.
- **A2. Escalation trigger.** The Escalation_Checker keeps its current trigger (manual check plus any existing schedule). A scheduled run on Vercel Cron is a design decision for the next phase.
- **A3. Release window.** The 24-hour window in Requirement 7 is a starting value for the Alpha.

## Open Questions

1. **Tester list not confirmed.** Japanese families are the first target (D11), but the actual tester households are not yet confirmed.
2. **Real notification channel.** Is a real push channel (web push, email, LINE, or SMS) in scope for a later feature? Any external channel counts as external communication and must not carry medical details.
3. **Pending Assignment and Backup_Request timeout.** Handovers now expire (D9), but a pending Assignment or Backup_Request has no expiry. Should they use the same rule (Task_Due_Time, otherwise 24 hours)?
4. **Who may Reopen and who may request a backup.** This revision assumes the Owner or a Primary_Caregiver may Reopen a `failed` Part (Requirement 12.13) and may make a Backup_Request (Requirement 5.14). Confirm or narrow.
5. **Re-escalation after Reopen.** Requirement 12.3 allows one escalation per Task_Due_Time value. A Reopened Part with an unchanged, already-escalated Task_Due_Time is not escalated again until someone confirms a new Task_Due_Time. Is that acceptable?

## Out of Scope

- Visual restyling of the new screens beyond phone-first usability.
- Sharing anything with people outside the Household.
- Real email, SMS, or push delivery (see Open Question 2).
- Calendar integration.
- Any automatic payment, messaging to clinicians, medication change, appointment cancellation, or deletion of care records.
- Removing the old `/notes` and `/care` pages (a later change, see Requirement 18.4).
