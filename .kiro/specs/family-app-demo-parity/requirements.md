# Requirements Document

## Introduction

The `/demo` flow shows a whole family sharing a note. The real app cannot reproduce that today because there is no way for a second person to get into a household: `src/app/login` supports email and password sign-in only, nobody can sign up, households and members exist only as seeded rows, and nobody can add, change, or remove a member.

This feature closes that gap so a real family can reach the same state as the demo:

1. Anyone can sign up with email and password and create a household, becoming its first Primary_Caregiver.
2. A Primary_Caregiver creates a single-use Invite_Link with a preset role, valid for 7 days and revocable, and shares it outside Fudepan (LINE, in person). Fudepan sends no email, SMS, or push message.
3. The invitee opens the link, signs up or signs in, and joins the household with the preset role.
4. The Care_Recipient (for example, Grandma) gets her own account through a `care_recipient` invite that a family member sets up once on her phone. She stays signed in and sees only the existing large-text Recipient_View.
5. A Members_Page lets Primary_Caregivers change roles and deactivate members, and lets every member edit the member's own display name and leave. The last active Primary_Caregiver can never be removed, demoted, or leave.
6. First-run empty states lead a new household to "Invite family" and "Take a photo".
7. A demo gap is fixed: once the main appointment Part is completed, the Event_Card keeps showing that Part as Done in the main slot instead of switching the main slot to another open Part that shows 「時間はまだ分かりません」.

**Builds on.** This feature extends the specs `fudepan-care-chain` and `family-shared-care` and does not restate them. Claims, Approval, Handover, Escalation, Feed_Items, In_App_Reminders, the Recipient_View, and Recipient_Reply keep the behavior those specs define. Decision D8 of `family-shared-care` (a Care_Recipient may upload notes in the Care_Recipient's own Household) stays in force.

**Existing foundation.** Supabase Auth (email and password), `households` and `household_members` (`supabase/migrations/20261120160000_care_chain_schema.sql`), row-level security through `private.current_user_household_ids()` (`20261120160100_row_level_security.sql`), and the audit writer `private.write_audit`. The newest migration is `20261210000600_recipient_reply.sql`. All schema changes in this feature are additive migrations.

**Out of scope.** Changes to email confirmation settings, password reset, a household switcher UI, and sending email, SMS, or push messages.

## Glossary

- **Fudepan**: The whole web application, deployed to Vercel.
- **Account**: A Supabase Auth user identified by email and password.
- **Household**: A family unit stored in `households`.
- **Member**: An active row in `household_members` for a given Account and Household.
- **Former_Member**: A row in `household_members` with `is_active = false`. The row is kept for history and audit.
- **Role**: The value of `household_members.role`, one of `care_recipient`, `primary_caregiver`, `family_member`, `medical_coordinator`, `finance_coordinator`, `transport_coordinator`, `emergency_contact`, or `professional_caregiver`.
- **Primary_Caregiver**: A Member with the Role `primary_caregiver`.
- **Care_Recipient**: A Member with the Role `care_recipient`.
- **Family_Member**: A Member whose Role is not `care_recipient`.
- **Sign_Up_Page**: The page where a person creates an Account with email and password.
- **Create_Household_Flow**: The screens where a signed-in Account without a Member row creates a Household.
- **Invite**: A stored, single-use offer to join one Household with one preset Role.
- **Invite_Token**: The secret random value that identifies an Invite inside an Invite_Link.
- **Invite_Link**: The URL that carries an Invite_Token and opens the Invite_Acceptance_Page.
- **Invite_State**: The state of an Invite: `pending`, `accepted`, `revoked`, or `expired`.
- **Invite_Expiry_Time**: The time 7 days after an Invite was created, after which the Invite cannot be accepted.
- **Invite_Page**: The page where a Primary_Caregiver creates, lists, and revokes Invites.
- **Invite_Acceptance_Page**: The page that an Invite_Link opens, where the invitee signs up or signs in and joins the Household.
- **Members_Page**: The page that lists a Household's Members and offers role changes, deactivation, display name editing, and leaving.
- **Deactivation**: Setting a Member's `is_active` to `false` by a Primary_Caregiver. The row is kept.
- **Leaving**: Deactivation of a Member by that Member.
- **Last_Primary_Caregiver**: A Primary_Caregiver who is the only active Primary_Caregiver of the Household at the moment the server processes a request.
- **Held_Part**: An open Part (not `completed`, `cancelled`, or `failed`) on which a Member is Owner, Driver, Companion, or Backup_Owner, or on which a Member is the sender or receiver of a pending Assignment, Handover, or Backup_Request.
- **Part**, **Owner**, **Driver**, **Companion**, **Backup_Owner**, **Assignment**, **Handover**, **Backup_Request**, **Approval_State**, **High_Risk_Part**, **Feed_Item**, **In_App_Reminder**, **Family_Feed**, **Event_View**, **Recipient_View**, **Escalation_Checker**, **Audit_Trail**, **Timeline**: As defined in `.kiro/specs/family-shared-care/requirements.md`.
- **Event_Card**: The family-facing summary of one Shared_Care_Event, built by `buildEventCard` in `src/lib/family/event-card.ts` and rendered by `events/[noteId]/event-card-view.tsx`.
- **Main_Slot**: The large top area of the Event_Card that shows one Part with its time, place, and helper slots.
- **Main_Part_Rule**: The shared rule that chooses which Part fills the Main_Slot. Both the real app and `/demo` use it.
- **Membership_Guard**: The server-side checks for household creation, Invite actions, role changes, Deactivation, Leaving, and display name changes.
- **Masked_Log**: Server log output in which names, email addresses, Invite_Tokens, addresses, insurance numbers, government IDs, medication names, bank and payment data, and image bytes are masked or removed.

## Requirements

### Requirement 1: Sign up

**User Story:** As a family member who has no account yet, I want to sign up with my email and a password, so that I can start using Fudepan for my family.

#### Acceptance Criteria

1. THE Sign_Up_Page SHALL offer creating an Account with an email address and a password, and SHALL link to the existing sign-in page.
2. THE login page SHALL link to the Sign_Up_Page.
3. WHEN a person submits a valid email address and a password of at least 8 characters, THE Fudepan SHALL create the Account through Supabase Auth from server-side code.
4. IF the email address or the password fails validation, THEN THE Sign_Up_Page SHALL name the field and the problem in plain language, keep the entered email address, and clear the password field.
5. IF Supabase Auth refuses the sign-up, THEN THE Sign_Up_Page SHALL show a plain-language message without raw error codes or stack traces.
6. WHERE the Supabase project requires email confirmation, THE Sign_Up_Page SHALL tell the person in plain language to confirm the email address before signing in.
7. WHEN a signed-in Account has no Member row in any Household and opened no Invite_Link, THE Fudepan SHALL send the Account to the Create_Household_Flow.
8. WHEN a person reaches the Sign_Up_Page from an Invite_Link, THE Fudepan SHALL return the person to the same Invite_Acceptance_Page after the Account is signed in.

### Requirement 2: Create a household

**User Story:** As a new user, I want to create my family's household, so that I can invite the rest of the family.

#### Acceptance Criteria

1. THE Create_Household_Flow SHALL ask for a household name and the creator's display name, each between 1 and 40 characters after trimming spaces.
2. WHEN the creator submits valid values, THE Fudepan SHALL, in one database transaction, create the Household, create a Member row for the creator with the Role `primary_caregiver`, record a `household.created` audit event, and record a `member.joined` audit event.
3. IF any write of the transaction in Requirement 2.2 fails, THEN THE Fudepan SHALL roll back the whole transaction and show a plain-language message that offers "Try again" with the entered values kept.
4. IF an Account that already has an active Member row in any Household requests household creation, THEN THE Membership_Guard SHALL refuse the request with a plain-language reason.
5. WHEN the Household is created, THE Fudepan SHALL open the Family_Feed of the new Household.

### Requirement 3: Create an invite

**User Story:** As a Primary_Caregiver, I want to create an invite link for a specific role, so that I can bring a family member into our household by sending the link myself.

#### Acceptance Criteria

1. THE Invite_Page SHALL let a Primary_Caregiver choose one Role for a new Invite, with each Role described in plain language.
2. WHEN a Primary_Caregiver creates an Invite, THE Fudepan SHALL generate an Invite_Token of at least 128 bits of cryptographic randomness, store the Invite with the Household, the Role, the creating Member, the creation time, and an Invite_Expiry_Time 7 days after creation, and record an `invite.created` audit event that names the Role.
3. WHEN an Invite is created, THE Invite_Page SHALL show the Invite_Link once, with a "Copy link" action and, where the device supports it, a "Share" action that uses the device's own share sheet.
4. THE Invite_Page SHALL tell the Primary_Caregiver in plain language that Fudepan sends no message, that the link works once, that the link expires at the shown Invite_Expiry_Time with its timezone, and that anyone holding the link can join with the chosen Role.
5. IF a Member who is not an active Primary_Caregiver of the Household attempts to create an Invite, THEN THE Membership_Guard SHALL refuse the request with a plain-language reason.
6. IF a Household already has 20 Invites in the Invite_State `pending`, THEN THE Membership_Guard SHALL refuse a new Invite and tell the Primary_Caregiver to revoke an unused Invite first.
7. WHEN a Primary_Caregiver creates an Invite with the Role `care_recipient`, THE Invite_Page SHALL tell the Primary_Caregiver that the link is meant to be opened on the Care_Recipient's own phone.

### Requirement 4: List and revoke invites

**User Story:** As a Primary_Caregiver, I want to see and cancel invites, so that a forgotten or misdirected link cannot be used.

#### Acceptance Criteria

1. THE Invite_Page SHALL list the Household's Invites newest first, each with its Role, the creating Member's display name, the creation time, the Invite_Expiry_Time with its timezone, and its Invite_State in words.
2. THE Invite_Page SHALL show no Invite_Token and no Invite_Link for an Invite after the creation screen of Requirement 3.3 is closed.
3. WHEN a Primary_Caregiver revokes an Invite in the Invite_State `pending`, THE Fudepan SHALL set the Invite_State to `revoked` and record an `invite.revoked` audit event that names the Role.
4. IF a Member who is not an active Primary_Caregiver of the Household attempts to revoke an Invite, THEN THE Membership_Guard SHALL refuse the request with a plain-language reason.
5. IF a Primary_Caregiver attempts to revoke an Invite whose Invite_State is not `pending`, THEN THE Membership_Guard SHALL keep the Invite_State unchanged and state the current Invite_State in plain language.
6. WHEN the Invite_Page lists an Invite in the Invite_State `pending` whose Invite_Expiry_Time has passed, THE Invite_Page SHALL show the Invite as expired.
7. THE Fudepan SHALL show the Invite_Page and Invite data only to active Primary_Caregivers of the Invite's Household.

### Requirement 5: Invite token protection

**User Story:** As a family, we want invite links to be hard to guess and never leak from Fudepan's own records, so that strangers cannot join our household.

#### Acceptance Criteria

1. THE Fudepan SHALL store only a one-way cryptographic hash of each Invite_Token in the database.
2. THE Fudepan SHALL keep the raw Invite_Token out of server logs, audit event payloads, Feed_Items, analytics, and error messages.
3. WHEN the Fudepan looks up an Invite by Invite_Token, THE Fudepan SHALL hash the presented Invite_Token and compare the hash using a constant-time comparison or an indexed equality lookup on the hash.
4. THE Fudepan SHALL make the Invite table readable and writable only through server-side code, with no select, insert, update, or delete grants for the `anon` or `authenticated` roles.
5. THE Invite_Link SHALL carry the Invite_Token so that the hosting platform's request logs do not record the raw Invite_Token.

### Requirement 6: Accept an invite

**User Story:** As an invited family member, I want to open the link, sign up or sign in, and join, so that I can see and help with my family's care.

#### Acceptance Criteria

1. WHEN a person opens a valid Invite_Link, THE Invite_Acceptance_Page SHALL show the Household name, the creating Member's display name, and the preset Role in plain language, and SHALL show no care data.
2. WHILE the person is not signed in, THE Invite_Acceptance_Page SHALL offer "Create an account" and "Sign in", and SHALL keep the Invite available after either one completes.
3. WHEN a signed-in Account accepts a pending Invite before its Invite_Expiry_Time and enters a display name between 1 and 40 characters after trimming spaces, THE Fudepan SHALL, in one database transaction, create a Member row with the Invite's Role, set the Invite_State to `accepted` with the accepting Account and time, and record an `invite.accepted` audit event and a `member.joined` audit event that name the Role.
4. WHEN two acceptances of the same Invite arrive at the same time, THE Fudepan SHALL complete only the first committed acceptance and SHALL tell the other person that the link has already been used.
5. IF the Invite_State is `accepted`, `revoked`, or `expired`, or the Invite_Expiry_Time has passed, THEN THE Invite_Acceptance_Page SHALL tell the person in plain language that the link can no longer be used and to ask the family for a new link, and SHALL reveal no Household name or Member names.
6. IF the presented Invite_Token matches no Invite, THEN THE Invite_Acceptance_Page SHALL show the same message as Requirement 6.5.
7. IF the accepting Account already has an active Member row in the Invite's Household, THEN THE Membership_Guard SHALL refuse the acceptance, keep the Invite_State `pending`, and tell the person that the person is already in this household.
8. IF the accepting Account has a Former_Member row in the Invite's Household, THEN THE Fudepan SHALL reactivate that row with the Invite's Role and the entered display name, instead of creating a second row, and record a `member.rejoined` audit event.
9. IF the accepting Account already has an active Member row in a different Household, THEN THE Membership_Guard SHALL refuse the acceptance, keep the Invite_State `pending`, and explain in plain language that one account can belong to one household in this version.
10. WHEN an acceptance succeeds, THE Fudepan SHALL add one Feed_Item to the Household that names the new Member and the Role, add an In_App_Reminder for every active Primary_Caregiver, and open the new Member's home screen.
11. WHEN the accepted Role is `care_recipient`, THE Fudepan SHALL open the Recipient_View as the new Member's home screen.

### Requirement 7: Invite expiry

**User Story:** As a family, we want unused links to stop working after a week, so that an old link found later cannot be used.

#### Acceptance Criteria

1. IF an acceptance request arrives after the Invite_Expiry_Time, THEN THE Membership_Guard SHALL refuse the acceptance and set the Invite_State to `expired`, whether or not any background job has run since the Invite_Expiry_Time.
2. WHEN the Fudepan first sets an Invite_State to `expired`, THE Fudepan SHALL record exactly one `invite.expired` audit event for that Invite that names the Role.
3. WHILE an Invite is in the Invite_State `accepted`, `revoked`, or `expired`, THE Fudepan SHALL keep that Invite_State unchanged.

### Requirement 8: The care recipient's own account

**User Story:** As a Care_Recipient, I want my own phone to stay signed in to a simple screen, so that I can photograph notes and see who is helping without learning an app.

#### Acceptance Criteria

1. WHEN an Account joins a Household with the Role `care_recipient`, THE Fudepan SHALL show that Account only the Recipient_View routes under `/family/me/` and the Capture_Screen in that Household.
2. WHILE the Care_Recipient's Account is signed in, THE Fudepan SHALL keep the Account signed in across browser restarts by refreshing the Supabase session until the Account signs out or the Account's Member row is deactivated.
3. IF a Care_Recipient requests the Members_Page, the Invite_Page, or a Family_Member route, THEN THE Fudepan SHALL redirect the Care_Recipient to the Recipient_View.
4. THE Fudepan SHALL let a Care_Recipient create Note_Photos in the Care_Recipient's own Household, as decided in `family-shared-care` D8.
5. THE Invite_Acceptance_Page SHALL use body text of at least 20 CSS pixels and touch targets of at least 48 by 48 CSS pixels when the Invite's Role is `care_recipient`.

### Requirement 9: Members page

**User Story:** As a Member, I want to see who is in my household and what role each person has, so that I know who can help and who can confirm.

#### Acceptance Criteria

1. THE Members_Page SHALL list the active Members of the current Household with display name and Role in plain language, and SHALL mark the signed-in Member as "You".
2. THE Fudepan SHALL offer the Members_Page to every Family_Member through the main navigation.
3. WHILE the signed-in Member is a Primary_Caregiver, THE Members_Page SHALL offer "Change role" and "Remove from household" for each other Member, and a link to the Invite_Page.
4. THE Members_Page SHALL offer every Family_Member "Edit my name" and "Leave household" for the Family_Member's own row.
5. THE Members_Page SHALL show only Members of Households the signed-in Account belongs to.
6. THE Members_Page SHALL show no email address of any Member.

### Requirement 10: Change a member's role

**User Story:** As a Primary_Caregiver, I want to change a member's role, so that the household reflects who does what.

#### Acceptance Criteria

1. WHEN a Primary_Caregiver changes the Role of an active Member of the same Household to another valid Role, THE Fudepan SHALL save the new Role and record a `member.role_changed` audit event that names the old Role and the new Role.
2. IF a Member who is not an active Primary_Caregiver of the Household attempts to change a Role, THEN THE Membership_Guard SHALL refuse the request with a plain-language reason.
3. IF a role change would leave the Household with no active Primary_Caregiver, THEN THE Membership_Guard SHALL refuse the change, keep every Role unchanged, and state that the household needs at least one primary caregiver.
4. WHEN a Member's Role changes, THE Fudepan SHALL apply the new Role to every request the server processes after the change commits.
5. WHEN a Member's Role changes to `care_recipient` while the Member holds Held_Parts, THE Fudepan SHALL apply the departure rules of Requirement 13 to those Held_Parts in the same database transaction.
6. WHEN a Member's Role changes, THE Fudepan SHALL add one Feed_Item that names the Member and the new Role, and add an In_App_Reminder for that Member.

### Requirement 11: Remove a member

**User Story:** As a Primary_Caregiver, I want to remove someone from the household without erasing history, so that access ends but the record of what happened stays.

#### Acceptance Criteria

1. WHEN a Primary_Caregiver confirms removal of another active Member of the same Household, THE Fudepan SHALL set that Member's `is_active` to `false`, keep the row, and record a `member.deactivated` audit event that names the removed Member's Role.
2. IF a Member who is not an active Primary_Caregiver of the Household attempts to remove another Member, THEN THE Membership_Guard SHALL refuse the request with a plain-language reason.
3. IF the removal targets the Last_Primary_Caregiver, THEN THE Membership_Guard SHALL refuse the removal and state that the household needs at least one primary caregiver.
4. THE Fudepan SHALL offer no action that hard-deletes a `household_members` row.
5. WHEN a Member is deactivated, THE Fudepan SHALL refuse every later request from that Account for the Household's data, through RLS and the Membership_Guard.
6. WHEN a Primary_Caregiver opens the removal confirmation, THE Members_Page SHALL list the Member's Held_Parts in plain language and state what happens to each under Requirement 13.
7. WHILE the Timeline or a Part shows an action by a Former_Member, THE Fudepan SHALL keep showing the Former_Member's display name with the text "(left the household)".

### Requirement 12: Leave a household and edit own name

**User Story:** As a Member, I want to fix my displayed name and to leave a household myself, so that I control how I appear and whether I take part.

#### Acceptance Criteria

1. WHEN a Member saves a display name between 1 and 40 characters after trimming spaces, THE Fudepan SHALL save the display name and record a `member.display_name_changed` audit event without the old or new name value.
2. IF a Member submits an empty or longer display name, THEN THE Members_Page SHALL keep the entered value and state the length rule in plain language.
3. THE Membership_Guard SHALL let a Member change only the Member's own display name.
4. WHEN a Family_Member confirms leaving, THE Fudepan SHALL set that Member's `is_active` to `false`, keep the row, and record a `member.left` audit event that names the Member's Role.
5. IF the Last_Primary_Caregiver attempts to leave, THEN THE Membership_Guard SHALL refuse the request and tell the Member to make another Member a primary caregiver first.
6. WHEN a Member has left, THE Fudepan SHALL show that Account the Create_Household_Flow on the next visit, with the text that a new Invite_Link is needed to join a household again.
7. WHEN a Family_Member opens the leave confirmation, THE Members_Page SHALL list the Family_Member's Held_Parts in plain language and state what happens to each under Requirement 13.

### Requirement 13: Responsibilities never silently disappear when someone leaves

**User Story:** As a family, we want a departing member's open responsibilities to come back to us visibly, so that no care task is dropped when someone leaves.

#### Acceptance Criteria

1. WHEN a Member is deactivated, leaves, or changes Role to `care_recipient`, THE Fudepan SHALL, in the same database transaction, remove the Member as Owner, Driver, Companion, and Backup_Owner of every Held_Part.
2. WHEN the Fudepan removes a departing Member from a Held_Part under Requirement 13.1, THE Fudepan SHALL close every pending Assignment, Handover, and Backup_Request that the departing Member sent or received on that Part as not accepted.
3. WHEN the removal of Requirement 13.1 changes the Owner or another Actual_Performer of a High_Risk_Part with the Approval_State `approved`, THE Fudepan SHALL set the Approval_State to `pending` under `family-shared-care` Requirement 9.22.
4. WHEN the removal of Requirement 13.1 leaves a Part without an Owner, THE Fudepan SHALL add a Feed_Item that the Part needs someone and add an In_App_Reminder for every active Primary_Caregiver.
5. THE Fudepan SHALL record an unclaim audit event for each Helper_Role removed under Requirement 13.1, with the system as actor and the departure as reason.
6. IF any write of the departure transaction fails, THEN THE Fudepan SHALL roll back the Deactivation, Leaving, or role change together with every Part change, and tell the Member in plain language that nothing was changed.
7. WHEN a departure leaves a High_Risk_Part unclaimed, THE Escalation_Checker SHALL include that Part in its next run under `family-shared-care` Requirement 12.1.
8. THE Fudepan SHALL apply Requirement 13.1 to Held_Parts within 24 hours of their Task_Due_Time, in place of the release protection of `family-shared-care` Requirement 7.2.

### Requirement 14: Last primary caregiver protection

**User Story:** As a family, we want our household always to have someone who can confirm high-risk tasks, so that approvals never become impossible.

#### Acceptance Criteria

1. THE Membership_Guard SHALL keep at least one active Primary_Caregiver in every Household after every role change, Deactivation, and Leaving.
2. WHEN the server processes a role change, Deactivation, or Leaving, THE Membership_Guard SHALL count the active Primary_Caregivers inside the same database transaction with the affected Member rows locked, and SHALL use no earlier cached value.
3. IF two requests at the same time would together leave the Household with no active Primary_Caregiver, THEN THE Membership_Guard SHALL commit at most one of them and refuse the other with the reason of Requirement 10.3.

### Requirement 15: Household isolation

**User Story:** As a family, we want membership data to stay inside our household, so that other families cannot see or change it.

#### Acceptance Criteria

1. THE Fudepan SHALL limit reads of Members, Invites, and membership audit events to Members of the same Household, enforced by RLS or by server-side membership checks.
2. THE Fudepan SHALL perform every membership write (household creation, Invite creation, revocation, acceptance, role change, Deactivation, Leaving, display name change) through server-side code that checks the acting Account's active membership and Role at the moment the request is processed.
3. IF a Member attempts a membership action on a Household the Member does not belong to, THEN THE Membership_Guard SHALL refuse the request and reveal no data about that Household.
4. THE Fudepan SHALL grant the `anon` and `authenticated` roles no direct insert, update, or delete on `households`, `household_members`, or the Invite table.

### Requirement 16: First-run empty states

**User Story:** As a new household, I want the empty screens to tell me what to do next, so that I can invite my family and send the first note without help.

#### Acceptance Criteria

1. WHILE a Household has no Shared_Care_Event, THE Family_Feed SHALL show a plain-language explanation and a primary "Take a photo" action that opens the Capture_Screen.
2. WHILE a Household has only one active Member and the signed-in Member is a Primary_Caregiver, THE Family_Feed SHALL show an "Invite family" action that opens the Invite_Page.
3. WHILE a Household has no active Care_Recipient and the signed-in Member is a Primary_Caregiver, THE Family_Feed SHALL offer "Invite the person you care for", which opens the Invite_Page with the Role `care_recipient` preselected.
4. WHILE a Care_Recipient's Household has no Shared_Care_Event, THE Recipient_View SHALL show the "Take a photo" action and a sentence that the family will see the note.
5. WHEN a Member dismisses an empty-state invitation prompt, THE Fudepan SHALL keep the "Invite family" link on the Members_Page.

### Requirement 17: The main slot keeps a completed appointment

**User Story:** As a Family_Member, I want the card to keep showing the clinic visit as Done after it is finished, so that the card matches what happened instead of showing an unrelated task with no time.

#### Acceptance Criteria

1. WHEN a Shared_Care_Event has at least one appointment Part, THE Main_Part_Rule SHALL choose the earliest open appointment Part for the Main_Slot, and SHALL choose an appointment Part even after every appointment Part is closed.
2. WHILE the Main_Slot Part is `completed`, THE Event_Card SHALL show the existing Done label ("Done", Japanese 「完了」, `label.done`) for the Main_Slot and the Part's confirmed or note-quoted time if one exists.
3. WHILE the Main_Slot Part is `completed`, THE Event_Card SHALL show no `card.timeUnknown` line (Japanese 「時間はまだ分かりません」) and no `card.dateUnknown` line and no open helper-slot prompts for that Part.
4. WHEN the appointment Part in the Main_Slot is completed, THE Event_Card SHALL keep every other Part, open or closed, in the item list with its own status.
5. WHEN a Shared_Care_Event has no appointment Part, THE Main_Part_Rule SHALL keep its current order: an open travel Part, then any open Part, then the first Part.
6. THE `/demo` flow and the real Event_Card SHALL use the same Main_Part_Rule, and a test SHALL show that both produce the same Main_Slot for the demo note after the appointment Part is completed.
7. WHERE the Recipient_View shows a "Coming up" Part, THE Recipient_View SHALL keep choosing the next open Part, unchanged by this requirement.

### Requirement 18: Audit coverage for membership

**User Story:** As a family, we want every membership change recorded, so that we can see who joined, left, or changed roles and who did it.

#### Acceptance Criteria

1. THE Fudepan SHALL record an audit event for each of: household created, member joined, member rejoined, invite created, invite revoked, invite accepted, invite expired, member role changed, member deactivated, member left, and member display name changed.
2. THE Fudepan SHALL record the actor type and, for human actions, the acting Account in every membership audit event.
3. THE Fudepan SHALL store in membership audit payloads only Role codes, Invite identifiers, Member identifiers, and reason codes, with no email address, display name value, Invite_Token, or Invite_Token hash.
4. THE Fudepan SHALL refuse updates and deletes of membership audit events from client roles, as for every row of the Audit_Trail.
5. THE Members_Page SHALL show Primary_Caregivers a plain-language, newest-first list of the Household's membership audit events.

### Requirement 19: Privacy in logs and errors

**User Story:** As a family, we want our identities and links kept out of logs, so that operators and tools never see them in plain text.

#### Acceptance Criteria

1. THE Fudepan SHALL write server logs for sign-up, household creation, Invite actions, role changes, Deactivation, Leaving, and display name changes only as Masked_Log output.
2. IF a server error occurs in any flow of this feature, THEN THE Fudepan SHALL show a plain-language message without raw Supabase error text, stack traces, or Invite_Tokens.
3. THE Fudepan SHALL keep the Supabase service role key and `AIAND_API_KEY` out of every client bundle.

### Requirement 20: Language and accessibility

**User Story:** As an older adult or a busy caregiver, I want the new screens in my language, readable, and usable on my phone, so that joining and managing the family is easy.

#### Acceptance Criteria

1. THE Sign_Up_Page, Create_Household_Flow, Invite_Page, Invite_Acceptance_Page, and Members_Page SHALL show every label, Role description, empty state, and error message in Japanese and in English through `src/lib/i18n`.
2. WHILE an Account has no Member row, THE Fudepan SHALL choose the UI language from the browser's Accept-Language header, falling back to English.
3. THE new screens SHALL render without horizontal scrolling at a viewport width of 360 CSS pixels.
4. THE new screens SHALL make every action reachable and operable by keyboard with a visible focus indicator.
5. THE new screens SHALL give every form control a programmatic label and mark required fields in text and programmatically.
6. WHEN an Invite is created, copied, revoked, or accepted, or a role change, removal, Leaving, or name change succeeds or fails, THE Fudepan SHALL announce the result to screen readers.
7. THE new screens SHALL ask for confirmation in plain language before removal, Leaving, revocation, and a role change that removes the Role `primary_caregiver`, and SHALL name the affected Member and the consequence.

### Requirement 21: Delivery constraints

**User Story:** As the product team, we want this feature added safely on top of the existing data, so that current households and QA data keep working.

#### Acceptance Criteria

1. THE Fudepan SHALL add every new table, column, function, and policy of this feature through additive migrations dated after `20261210000600_recipient_reply.sql`, keeping existing rows and constraints valid.
2. WHEN this feature is deployed, THE Fudepan SHALL keep existing seeded Households and Members working with their current Roles.
3. WHEN this feature is complete, THE Fudepan SHALL pass `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.

## Assumptions and Decisions (Alpha defaults)

- **M1. Joining.** Anyone may sign up and create a household and becomes its first Primary_Caregiver. Others join only through a single-use Invite_Link with a preset Role, valid 7 days, revocable. Fudepan sends nothing; the Primary_Caregiver shares the link through LINE or in person.
- **M2. One household per Account.** Because a household switcher is out of scope, an Account with an active membership cannot create a second household or accept an invite to a different household (Requirements 2.4, 6.9). See Open Question 1.
- **M3. Care_Recipient account.** Set up once on the Care_Recipient's phone through a `care_recipient` invite with email and password. The session stays signed in. No new login method. The Care_Recipient sees only the Recipient_View and the Capture_Screen and has no Members_Page; a Primary_Caregiver removes or renames the Care_Recipient's membership if needed (Requirements 8, 9.2).
- **M4. Membership rights.** Only active Primary_Caregivers create and revoke invites, change roles, and remove members. Every Family_Member may edit the Member's own display name and leave. The last active Primary_Caregiver cannot be removed, demoted, or leave, checked in the same transaction under row locks (Requirement 14).
- **M5. No hard delete.** Removal and leaving set `is_active = false`; the row stays so the Timeline keeps names. Rejoining through a new invite reactivates the same row (Requirement 6.8), which keeps the existing `unique (household_id, user_id)` constraint valid.
- **M6. Departure releases responsibilities.** A departing Member cannot carry out a Part, so the Part's Helper_Roles are cleared in the same transaction, pending requests close, approved High_Risk_Parts return to `pending`, and every Primary_Caregiver gets an In_App_Reminder. This overrides the 24-hour release protection of `family-shared-care` Requirement 7.2 for departures only (Requirement 13.8). The confirmation screen lists the affected Parts first.
- **M7. Token handling.** Invite_Tokens are random (at least 128 bits), stored only as a hash, never logged, and kept out of request logs (Requirement 5). Carrying the token in the URL fragment, which browsers do not send to the server, is the expected design; the design phase confirms it. The raw link is shown once at creation and cannot be shown again; a lost link is revoked and replaced.
- **M8. Pending invite cap.** At most 20 pending invites per household, to limit exposure from forgotten links (Requirement 3.6).
- **M9. Main slot.** The appointment Part stays in the Main_Slot after completion and shows Done. The Recipient_View "Coming up" rule is unchanged (Requirement 17).
- **M10. Existing auth settings.** Email confirmation behavior follows the current Supabase project settings; this feature only shows the right message (Requirement 1.6).

## Open Questions

1. **More than one household per Account.** Adult children may help two families. Allowing that needs a household switcher, which is out of scope. Confirm that refusing a second membership is acceptable for the Alpha.
2. **Invite to an email address.** Invites are not tied to an email address, so anyone holding the link can join. Should a later version bind an invite to an email address?
3. **Pending invite cap.** Is 20 pending invites per household the right limit?

## Out of Scope

- Changes to email confirmation settings.
- Password reset.
- A household switcher UI.
- Sending email, SMS, or push messages, including invite delivery.
- Hard deletion of members or households.
