# Implementation Plan: family-app-demo-parity

## Overview

Implementation is in TypeScript (Next.js App Router, Supabase, Zod, Vitest with fast-check) and SQL migrations with pgTAP tests. The order follows the design:

1. The Requirement 17 Main_Part_Rule fix ships first. It is small, self-contained, and closes the visible demo gap.
2. The pure membership modules and the reference model (`src/lib/membership/model.ts`) come next, with their property tests. They define the behavior that the SQL functions must match.
3. Migrations, regenerated `database.types.ts`, and the seed check follow.
4. The server-only service, queries, auth routing, and pages are wired on top.
5. Feed and first-run prompts, the concurrency tests, and the quality gates finish the plan.

The design keeps all Property 1 to 8 tests in a single `model.test.ts` file. Here each property gets its own file (`model.<topic>.test.ts`), and the files share generators from `model.arbitraries.ts`. This lets the tests run in parallel waves, and Vitest's `src/**/*.test.{ts,tsx}` include still picks them up.

## Tasks

- [x] 1. Keep the completed appointment in the Event_Card Main_Slot
  - [x] 1.1 Implement the Main_Part_Rule in `src/lib/family/event-card.ts`
    - Rename the current `pickMainPart` body to `pickNextOpenPart`, exported and unchanged
    - Add the new `pickMainPart`: earliest open appointment Part, then first completed appointment Part, then first appointment Part; with no appointment Part, keep the old order (open travel, open, first)
    - Add `buildEventCard(event, options?: { mainRule?: "main" | "nextOpen" })`, defaulting to `"main"`
    - Add `main.status: "open" | "completed" | "cancelled"` and `main.prompts: { timeUnknown, dateUnknown, placeUnknown, openSlots }`. When `status === "completed"`, set every prompt to false, keep only filled slots, and keep `when = whenOf(part)`
    - Keep every other Part in `items` with its own `done` state
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 1.2 Write property test for the Main_Part_Rule
    - **Property 19: The Main_Part_Rule keeps the appointment in the Main_Slot**
    - In `src/lib/family/event-card.test.ts`, keep a copy of the old `pickMainPart` as the reference; generate `EventPart` arrays with random categories, statuses, and times; at least 100 runs
    - **Validates: Requirements 17.1, 17.5, 17.7**

  - [x] 1.3 Update the card views to read `main.status` and `main.prompts`
    - `src/app/(family)/family/events/[noteId]/event-card-view.tsx` and `src/app/(family)/family/card-parts.tsx` (`DateTile`): read `prompts` instead of testing `when.kind === "unknown"`; show the `label.done` badge (text plus ✅ icon, never color alone) when `status === "completed"`
    - `src/app/(family)/family/recipient-view.tsx` `GrandmaCard`: call `buildEventCard(event, { mainRule: "nextOpen" })` so "Coming up" is unchanged
    - Keep the existing `recipient-view.test.tsx` "Coming up" cases passing
    - _Requirements: 17.2, 17.3, 17.7_

  - [x] 1.4 Write property test for the completed Main_Slot
    - **Property 20: A completed main Part shows Done without open prompts, and every other Part stays listed**
    - In `src/lib/family/event-card.test.ts`; at least 100 runs
    - **Validates: Requirements 17.2, 17.3, 17.4**

  - [x] 1.5 Write the demo parity test and the Done render test
    - New `src/lib/family/demo-main-slot.test.ts`: start from `initialDemoEvent("ja")`, complete the appointment Part with `applyDemoAction`, and assert that `buildEventCard` returns the appointment Part as `main` with `status: "completed"` and `prompts.timeUnknown === false`, with the same `partId` as a card built from equivalent rows through the real event mapper
    - In `event-card-view.test.tsx`, assert that 「完了」 is shown and 「時間はまだ分かりません」 is not
    - _Requirements: 17.6_

- [x] 2. Add membership i18n and the token, schema, refusal, and audit modules
  - [x] 2.1 Add the membership dictionaries
    - Create `src/lib/i18n/membership-en.ts` and `src/lib/i18n/membership-ja.ts`, and spread them into `en.ts` and `ja.ts` the same way as `event-en.ts`
    - Add the key groups `signup.*`, `welcome.*` (including the "left, a new link is needed" text), `join.*`, `invites.*`, `members.*`, `firstRun.*`, `role.<code>.label` and `role.<code>.description` for all eight Roles, `inviteState.<state>`, `membership.refusal.<code>`, `membership.error.generic`, `audit.membership.<event>`, `nav.members`, `member.leftSuffix`, and the reminder kinds `member_joined`, `member_role_changed`, `part_needs_someone`
    - Extend `messages.test.ts` if needed so that every new key is non-empty in both languages
    - _Requirements: 20.1, 1.5, 4.5, 12.6, 19.2_

  - [x] 2.2 Implement `src/lib/membership/invite-token.ts` and `invite-state.ts`
    - `generateInviteToken(random)` (32 bytes, base64url, 43 characters), `hashInviteToken` (sha256 via `node:crypto`, 32 bytes), `buildInviteLink(origin, token)` returning `${origin}/join#${token}`, `tokenFromFragment`, `INVITE_TOKEN_PATTERN`, `INVITE_TTL_MS`, `PENDING_INVITE_CAP = 20`
    - `effectiveInviteState(stored, expiresAt, now)`
    - _Requirements: 3.2, 3.6, 4.6, 5.1, 5.3, 5.5_

  - [x] 2.3 Write property test for invite tokens
    - **Property 9: Invite tokens are strong, round-trip through the fragment, and stay out of logged URL parts**
    - `src/lib/membership/invite-token.test.ts`; `fc.uint8Array({ minLength: 32, maxLength: 32 })` as the random source, origins from `fc.webUrl()`
    - **Validates: Requirements 3.2, 5.1, 5.5**

  - [x] 2.4 Implement `src/lib/membership/schemas.ts`
    - `name40`, `signUpInput`, `createHouseholdInput`, `createInviteInput`, `revokeInviteInput`, `openInviteInput`, `acceptInviteInput`, `changeRoleInput`, `memberTargetInput`, `renameInput`
    - Add a helper that maps Zod issues to field-named message keys and returns the entered values without the password
    - _Requirements: 1.3, 1.4, 2.1, 6.3, 12.1, 12.2_

  - [x] 2.5 Write property test for name and sign-up validation
    - **Property 13: Name and sign-up inputs follow the length rules and keep entered values**
    - `src/lib/membership/schemas.test.ts`; padded unicode strings of length 0 to 60
    - **Validates: Requirements 1.3, 1.4, 2.1, 12.1, 12.2**

  - [x] 2.6 Implement `src/lib/membership/refusals.ts` and `audit-payload.ts`
    - `membershipRefusalKey(code)`: total, so unknown codes return `membership.error.generic`
    - `membershipAuditPayload(event, ids)`: allow-listed UUID, Role, Invite_State, and reason-code fields only
    - Add the new `membership.*` log event names, checking that `maskLogFields` in `src/lib/log.ts` passes only `household_id`, `user_id`, `reason`, `code`, and `count` for them
    - _Requirements: 5.2, 12.1, 18.3, 19.1, 19.2_

  - [x] 2.7 Write property test for audit payloads and log masking
    - **Property 10: Audit payloads and logs carry no personal data or tokens**
    - `src/lib/membership/audit-payload.test.ts`; `fc.emailAddress()`, unicode names, generated tokens
    - **Validates: Requirements 5.2, 12.1, 18.3, 19.1**

  - [x] 2.8 Write property test for refusal mapping
    - **Property 11: Every failure maps to a plain-language message**
    - `src/lib/membership/refusals.test.ts`; arbitrary strings, raw Postgres-style messages, and strings that contain tokens
    - **Validates: Requirements 1.5, 19.2**

- [x] 3. Implement the membership rules and the reference model
  - [x] 3.1 Implement `src/lib/membership/rules.ts` and `member-actions.ts`
    - `guardMembershipAction`, `wouldLeaveNoPrimary`, `MemberRecord`, `MembershipAction`, `GuardRefusal`
    - `memberActionsFor(viewer, target)`
    - _Requirements: 3.5, 4.4, 9.3, 9.4, 10.2, 10.3, 11.2, 11.3, 12.3, 12.5, 14.1, 15.3_

  - [x] 3.2 Implement `src/lib/membership/held-parts.ts`
    - `heldParts(memberId, parts, requests)` returning roles to remove, pending request IDs, `ownerless`, and `approvalWillReset` (approved High_Risk_Part losing an owner, driver, or companion)
    - Include open Parts due within 24 hours (no release protection)
    - _Requirements: 11.6, 12.7, 13.1, 13.2, 13.3, 13.8_

  - [x] 3.3 Implement `src/lib/membership/routing.ts` and `first-run.ts`
    - `postAuthDestination` (invite cookie → `/join`; no active role → `/welcome`; allowed `next`, filtered by `recipientRouteDecision` for a Care_Recipient; otherwise `/family`)
    - `recipientRouteDecision`: stay on `/family`, `/family/capture`, and `/family/me/<uuid>`; redirect every other `/family/*` path to `/family`
    - `firstRunPrompts(...)`
    - _Requirements: 1.7, 1.8, 6.11, 8.1, 8.3, 8.4, 12.6, 16.1, 16.2, 16.3, 16.4_

  - [x] 3.4 Implement the reference model `src/lib/membership/model.ts`
    - `ModelState` and `applyModel(state, op, now)` for create household, create, list, preview, revoke, and accept invite, change role, deactivate, leave, and rename, with expiry on access, the pending cap, one active household per Account, rejoin by reactivation, the departure algorithm (using `heldParts`), and audit, feed, and reminder accounting that matches the design's function table
    - Create the shared fast-check generators in `src/lib/membership/model.arbitraries.ts` (households with 1 to 6 members, operation sequences of length 1 to 30, time steps that cross and land exactly on `expiresAt`, Parts with random holders, approval states, and due times within 24 hours, and "both checked against the starting state" interleavings)
    - _Requirements: 2.2, 2.4, 3.2, 3.6, 4.3, 4.5, 6.3, 6.4, 6.5, 6.7, 6.8, 6.9, 6.10, 7.1, 7.2, 7.3, 10.1, 10.5, 10.6, 11.1, 12.4, 13.1, 13.2, 13.3, 13.4, 13.5, 14.1, 18.1, 18.2_

  - [x] 3.5 Write property test for member row actions
    - **Property 16: Member row actions match the viewer's rights**
    - `src/lib/membership/member-actions.test.ts`
    - **Validates: Requirements 9.3, 9.4**

  - [x] 3.6 Write property test for post-auth routing
    - **Property 14: After authentication, each person lands in the right place**
    - `src/lib/membership/routing.test.ts`; Role (or none) × cookie × `next` paths from the allow-list and random paths
    - **Validates: Requirements 1.7, 1.8, 6.11, 12.6**

  - [x] 3.7 Write property test for first-run prompts
    - **Property 18: First-run prompts follow the household's state**
    - `src/lib/membership/first-run.test.ts`
    - **Validates: Requirements 16.1, 16.2, 16.3, 16.4**

  - [x] 3.8 Write property test for care recipient routes
    - **Property 15: A care recipient only reaches recipient routes**
    - `src/lib/membership/routing.test.ts`
    - **Validates: Requirements 8.1, 8.3**

  - [x] 3.9 Write property test for held parts
    - **Property 17: Held_Parts listed on confirmation match the departure**
    - `src/lib/membership/held-parts.test.ts`; compare with the model's departure diff
    - **Validates: Requirements 11.6, 12.7**

  - [x] 3.10 Write property test for authorization
    - **Property 2: Membership actions are authorized against the current state**
    - `src/lib/membership/rules.test.ts`; also assert that a refusal leaves the model state, audit, and feed unchanged
    - **Validates: Requirements 2.4, 3.5, 4.4, 4.7, 10.2, 11.2, 11.5, 12.3, 15.2, 15.3**

  - [x] 3.11 Write property test for last primary protection
    - **Property 1: A household always keeps an active primary caregiver**
    - `src/lib/membership/model.primary.test.ts`
    - **Validates: Requirements 10.3, 11.3, 12.5, 14.1, 14.3**

  - [x] 3.12 Write property test for single-use invites
    - **Property 3: Invites are single use and terminal states never change**
    - `src/lib/membership/model.single-use.test.ts`
    - **Validates: Requirements 4.3, 4.5, 6.3, 6.4, 7.3**

  - [x] 3.13 Write property test for expiry
    - **Property 4: Expiry is enforced on access and audited exactly once**
    - `src/lib/membership/model.expiry.test.ts`
    - **Validates: Requirements 3.2, 4.6, 7.1, 7.2**

  - [x] 3.14 Write property test for the pending invite cap
    - **Property 5: Pending invites stay within the cap**
    - `src/lib/membership/model.cap.test.ts`
    - **Validates: Requirements 3.6**

  - [x] 3.15 Write property test for membership rows
    - **Property 6: Membership rows are never duplicated or deleted, and an Account has at most one active household**
    - `src/lib/membership/model.rows.test.ts`
    - **Validates: Requirements 2.4, 6.7, 6.8, 6.9, 11.1, 11.4, 12.4**

  - [x] 3.16 Write property test for departures
    - **Property 7: A departure leaves nothing held by the departing member**
    - `src/lib/membership/model.departure.test.ts`
    - **Validates: Requirements 10.5, 13.1, 13.2, 13.3, 13.5, 13.8**

  - [x] 3.17 Write property test for audit, feed, and reminder accounting
    - **Property 8: Every successful membership action writes its audit, feed, and reminder records**
    - `src/lib/membership/model.accounting.test.ts`
    - **Validates: Requirements 2.2, 6.10, 10.1, 10.6, 13.4, 18.1, 18.2**

  - [x] 3.18 Write property test for unusable links
    - **Property 12: Unusable and unknown invite links look the same**
    - `src/lib/membership/model.unusable.test.ts`
    - **Validates: Requirements 6.5, 6.6**

- [x] 4. Checkpoint: pure modules and model
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Add the database schema, functions, types, and seed check
  - [x] 5.1 Create migration `supabase/migrations/20261215000000_household_invites.sql`
    - `public.household_invites` with every constraint and index from the design, RLS enabled with no policies, all grants revoked from `public`, `anon`, and `authenticated`, granted to `service_role`
    - Restate `revoke insert, update, delete, truncate` on `households` and `household_members` for `anon` and `authenticated`
    - _Requirements: 5.1, 5.4, 11.4, 15.4, 21.1_

  - [x] 5.2 Create migration `supabase/migrations/20261215000100_membership_helpers.sql`
    - `private.lock_active_members`, `private.expire_overdue_invites` (one `invite.expired` system audit per newly expired row), `private.notify_primaries`, and `private.release_departing_member` following the design's departure algorithm (clear roles, decline pending requests with system audits and reminders, `apply_people_change` for approval reset, `part_released` needs-someone Feed_Item and primary reminders, no 24-hour block)
    - Service role only, `security invoker`, `set search_path = ''`
    - _Requirements: 7.1, 7.2, 13.1, 13.2, 13.3, 13.4, 13.5, 13.7, 13.8, 14.2_

  - [x] 5.3 Create migration `supabase/migrations/20261215000200_membership_functions.sql`
    - `create_household`, `create_invite`, `list_invites`, `revoke_invite`, `preview_invite`, `accept_invite`, `change_member_role`, `deactivate_member`, `leave_household`, `set_member_display_name` as `security definer`, `set search_path = ''`, executable only by `service_role`, returning `jsonb` outcomes or raising `P0001` refusal codes as in the design table
    - Use the user advisory lock in `create_household` and `accept_invite`, keep the lock order user → invite → member rows → care_steps → care_requests, count primaries after `lock_active_members`, and keep audit payloads to UUIDs, Role codes, state codes, and reason codes
    - _Requirements: 2.2, 2.3, 2.4, 3.2, 3.5, 3.6, 4.1, 4.3, 4.4, 4.5, 4.7, 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 7.1, 7.3, 10.1, 10.2, 10.3, 10.5, 10.6, 11.1, 11.2, 11.3, 12.1, 12.3, 12.4, 12.5, 13.6, 14.1, 14.2, 14.3, 15.2, 15.3, 18.1, 18.2, 18.3_

  - [x] 5.4 Regenerate or extend `src/lib/supabase/database.types.ts`
    - Run `pnpm db:types` against the local Supabase. If that is not available, hand-extend the file with the `household_invites` table and the argument and return types of the ten public functions
    - _Requirements: 21.1, 21.3_

  - [x] 5.5 Review and update `supabase/seed.sql` for the demo household
    - Confirm that every seeded Household has at least one active `primary_caregiver` and that every seeded Account is active in at most one Household. Adjust the seed only if one of these fails
    - Keep existing IDs and Roles unchanged. Add no invite rows, because raw tokens cannot be recovered from hashes
    - _Requirements: 21.2_

  - [x] 5.6 Write pgTAP tests for grants, RLS, and seeded invariants
    - `supabase/tests/database/membership_grants.test.sql`: no client grants on `household_invites`; no client write grants on `households` and `household_members`; the ten functions executable only by `service_role`; no client update or delete on `audit_events`; a member of household A reads no members or audit events of B; a deactivated member reads nothing; seeded households each have an active primary
    - _Requirements: 5.4, 9.5, 11.4, 11.5, 15.1, 15.4, 18.4, 21.2_

  - [x] 5.7 Write pgTAP tests for departure rollback and escalation
    - `supabase/tests/database/membership_departure.test.sql`: a forced failure inside `release_departing_member` leaves member rows and Parts unchanged; a departure that leaves a High_Risk_Part unclaimed makes it selectable by the Escalation_Checker query
    - _Requirements: 13.6, 13.7_

  - [ ]* 5.8 Write pgTAP scenario tests comparing functions with the model
    - `supabase/tests/database/membership_functions.test.sql`: success accounting and each refusal code on fixed scenarios that match model outcomes
    - _Requirements: 2.2, 3.6, 4.5, 6.7, 6.8, 6.9, 7.2, 10.3, 18.1_

- [x] 6. Implement the server-only service and queries
  - [x] 6.1 Implement `src/lib/membership/service.ts`
    - `import "server-only"`; wrap `createAdminClient().rpc(...)` for each function; map `P0001` messages matching `^[a-z_]+$` to refusal codes and anything else to `"server_error"`; never return or log `error.message`
    - Hash tokens in Node before every call, so raw tokens never reach Postgres
    - _Requirements: 5.2, 5.3, 15.2, 19.1, 19.2, 19.3_

  - [x] 6.2 Implement `src/lib/membership/queries.ts` and the Former_Member suffix
    - `listMembers` (no `auth.users` read), `listHeldParts` (open `care_steps` and pending `care_requests`, then `heldParts`), `listMembershipAudit` (membership event types, newest first, limit 50), and `listInvites` through the service
    - Extend `memberNames` in `src/lib/households/queries.ts` to return `is_active`, and append `member.leftSuffix` for Former_Members in the Timeline formatters
    - _Requirements: 4.1, 9.1, 9.5, 9.6, 11.6, 11.7, 12.7, 15.1, 18.5_

  - [ ]* 6.3 Write unit tests for service error mapping
    - `src/lib/membership/service.test.ts` with a mocked admin client: refusal codes pass through, raw messages become `server_error`, and nothing is logged beyond allow-listed fields
    - _Requirements: 19.1, 19.2_

- [x] 7. Wire authentication and routing
  - [x] 7.1 Add the invite cookie, the auth callback, and the allowed paths
    - `src/lib/membership/invite-cookie.ts` (server-only): set, read, and clear `fudepan_invite` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, max age equal to the time left before expiry)
    - `src/app/auth/callback/route.ts`: exchange the confirmation code and redirect to `safeNextPath(next)`
    - `src/lib/auth/next-path.ts`: add `/join`, `/welcome`, `/family/members`, `/family/invites` to `ALLOWED_NEXT`, and `/welcome` to `isProtectedPagePath`. Update `next-path.test.ts`
    - _Requirements: 1.6, 1.8, 6.2_

  - [x] 7.2 Update the proxy and the login flow
    - `src/lib/supabase/proxy.ts`: a signed-in visit to `/signup` redirects like `/login`. Keep the existing session refresh so that a Care_Recipient stays signed in
    - `src/app/login/page.tsx`: link to `/signup?next=<next>`. `src/app/login/actions.ts` `signIn`: redirect with `postAuthDestination`
    - _Requirements: 1.2, 1.7, 1.8, 8.2_

  - [x] 7.3 Update the family session and navigation
    - `src/lib/family/session.ts` `requireFamilyContext`: on `no_household`, redirect to `/join` when the invite cookie is present and to `/welcome` otherwise
    - `src/lib/family/session-core.ts` `familyLinks`: add `{ href: "/family/members", labelKey: "nav.members" }` for Family_Members only. Update `session-core.test.ts`
    - Call `recipientRouteDecision` in `/family/settings/language`
    - _Requirements: 1.7, 8.1, 8.3, 9.2, 12.6_

- [x] 8. Build the onboarding pages
  - [x] 8.1 Build the Sign_Up_Page at `src/app/(onboarding)/signup/`
    - Page, view, and `signUp` Server Action: Zod validation, `supabase.auth.signUp` with `emailRedirectTo = <origin>/auth/callback?next=<path>`, the same "check your email" text for a null session or an obfuscated existing email, a separate rate-limit message, the email kept and the password cleared, a link to sign-in, and `getRequestLanguage()` for the language
    - Labeled required fields, `role="status"` results, 48 px targets, single-column layout
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.8, 19.1, 19.2, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6_

  - [x] 8.2 Build the Create_Household_Flow at `src/app/(onboarding)/welcome/`
    - Page, view, and `createHousehold` action calling `create_household` through the service; keep entered values with "Try again" on failure; clear the invite cookie; redirect to `/family`; show the "a new link is needed" text when `?left=1`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 12.6, 20.1, 20.2, 20.5, 20.6_

  - [x] 8.3 Build the Invite_Acceptance_Page at `src/app/(onboarding)/join/`
    - Client component reads `location.hash`, calls `history.replaceState(null, "", "/join")`, then calls `openInvite({ token })`. The page also works from the cookie alone
    - `openInvite` and `acceptInvite` actions: preview the Household name, creator name, and Role in words with no care data; "Create an account" and "Sign in" with `next=/join` when signed out; display name entry; one unusable message for every failure; clear the cookie on success or when the link is unusable; redirect to `/family` (Recipient_View for a Care_Recipient)
    - `data-size="large"` (text 20 px or more, targets 48 px or more) for a `care_recipient` invite
    - Add a `Referrer-Policy: no-referrer` header for `/join` in `next.config.ts`
    - _Requirements: 5.5, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.9, 6.10, 6.11, 8.5, 20.1, 20.2, 20.6_

  - [ ]* 8.4 Write view tests for the sign-up and join pages
    - Sign-up fields, labels, required markers, sign-in link, the confirmation-needed message; join preview, signed-out choices, large size for `care_recipient`, the unusable message
    - _Requirements: 1.1, 1.6, 6.1, 6.2, 6.5, 8.5_

- [x] 9. Build the Invite_Page and the Members_Page
  - [x] 9.1 Build the Invite_Page at `src/app/(family)/family/invites/`
    - Primary_Caregivers only (others are redirected; a Care_Recipient goes to `/family`); Role picker with plain-language descriptions and `?role=care_recipient` preselect
    - `createInvite` generates and hashes the token on the server and returns the raw token once; a creation panel builds the link with `location.origin` and offers "Copy link" and "Share" (`navigator.share` when present); it explains that Fudepan sends nothing, the link works once, it expires at the shown time with its timezone, and anyone holding it can join; it shows the care-recipient hint; the token is dropped from memory when the panel closes
    - The list shows Invites newest first with the Role, creator, created time, expiry time with timezone (small `Intl.DateTimeFormat` client component), and state in words; `revokeInvite` with a two-step confirmation; `not_pending` shows the current state
    - _Requirements: 3.1, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.3, 16.3, 20.1, 20.6, 20.7_

  - [x] 9.2 Build the Members_Page at `src/app/(family)/family/members/`
    - List active Members with name, Role in words, and "You"; no email; "Change role" and "Remove from household" for other Members when the viewer is a Primary_Caregiver (from `memberActionsFor`); "Edit my name" and "Leave household" on the viewer's own row; a link to the Invite_Page for Primary_Caregivers
    - Two-step confirmations for removal, leaving, and demoting a Primary_Caregiver that name the person and list Held_Parts with consequence text; rename keeps the entered value on a length error; `leaveHousehold` redirects to `/welcome?left=1`; departure failures say "Nothing was changed."
    - Membership audit history for Primary_Caregivers, newest first, in plain language
    - Care_Recipients are redirected through `recipientRouteDecision`
    - _Requirements: 8.3, 9.1, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.6, 12.1, 12.2, 12.4, 12.5, 12.7, 13.6, 16.5, 18.5, 20.1, 20.5, 20.6, 20.7_

  - [ ]* 9.3 Write view tests for the Invite_Page
    - Role descriptions in en and ja, the one-time panel with Copy and Share, the care-recipient hint, states in words with a timezone, no token after the panel closes
    - _Requirements: 3.1, 3.3, 3.4, 3.7, 4.1, 4.2_

  - [ ]* 9.4 Write view tests for the Members_Page
    - "You" marker, no email, confirmation steps naming the person and consequences, `role="status"` announcements, audit history list
    - _Requirements: 9.1, 9.6, 11.6, 18.5, 20.5, 20.6, 20.7_

- [x] 10. Add membership notices and first-run prompts to the feed
  - [x] 10.1 Extend `src/lib/family/feed.ts`
    - `FamilyFeed.notices` from household Feed_Items with `note_id is null` and a kind in `MEMBER_NOTICE_KINDS`, with `params` parsed by Zod and unknown shapes dropped
    - Message keys for the reminder kinds `member_joined`, `member_role_changed`, `part_needs_someone`
    - _Requirements: 6.10, 10.6, 13.4_

  - [x] 10.2 Render first-run prompts and notices
    - `src/app/(family)/family/family-feed-view.tsx`: render `firstRunPrompts(...)` and notices; "Take a photo" opens the Capture_Screen and cannot be dismissed; invite prompts can be dismissed, stored in `localStorage` under `fudepan.firstRun.dismissed.<householdId>`
    - The family page passes `activeMemberCount` and `hasActiveRecipient` from `listMembers`
    - `src/app/(family)/family/recipient-home.tsx`: the `recipient_take_photo` prompt with `firstRun.recipient.body` when the Household has no event
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_

  - [ ]* 10.3 Write unit and view tests for notices and prompts
    - `feed.test.ts`: notice parsing and dropped shapes; `family-feed-view.test.tsx`: prompts render and dismiss
    - _Requirements: 6.10, 16.1, 16.2, 16.3, 16.5_

- [x] 11. Checkpoint: app wiring
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Add integration tests against local Supabase
  - [x] 12.1 Write concurrency integration tests
    - `src/lib/membership/membership.integration.test.ts` (`pnpm test:integration`): two parallel `accept_invite` calls on one invite give exactly one `joined`; two parallel demotions of the last two Primary_Caregivers commit exactly one
    - _Requirements: 6.4, 14.2, 14.3_

  - [ ]* 12.2 Write integration test for role change timing
    - In the same file: a role change applies to the very next `claim_part` call
    - _Requirements: 10.4_

- [x] 13. Final checkpoint: quality gates
  - Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`, and fix every failure. Also run `pnpm test:db` and `pnpm test:integration` when local Supabase is running.
  - Ensure all tests pass, ask the user if questions arise.
  - _Requirements: 21.3_

## Notes

- Tasks marked with `*` are optional nice-to-have tests and can be skipped for a faster first pass. Every property test (Properties 1 to 20) is required.
- Each property test runs at least 100 fast-check iterations and is tagged in its `describe` name as `Feature: family-app-demo-parity, Property <n>: <title>`.
- Requirements 8.2 (session kept across restarts), 20.3 (360 px layout), and 20.4 (keyboard focus) are built in tasks 7.2, 8, and 9 and need a manual browser check, as the design states.
- `pnpm test` does not run pgTAP or integration tests. Tasks 5.6, 5.7, and 12.1 need local Supabase (`pnpm test:db`, `pnpm test:integration`).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.3", "2.4", "2.6", "3.1", "3.2", "3.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "2.5", "2.7", "2.8", "3.4", "3.5", "3.6", "3.7"] },
    { "id": 3, "tasks": ["3.8", "3.9", "3.10", "3.11", "3.12", "3.13", "3.14", "3.15", "3.16", "3.17", "3.18"] },
    { "id": 4, "tasks": ["4"] },
    { "id": 5, "tasks": ["5.1"] },
    { "id": 6, "tasks": ["5.2"] },
    { "id": 7, "tasks": ["5.3"] },
    { "id": 8, "tasks": ["5.4", "5.5", "5.6", "5.7", "5.8"] },
    { "id": 9, "tasks": ["6.1", "7.1"] },
    { "id": 10, "tasks": ["6.2", "6.3", "7.2", "7.3"] },
    { "id": 11, "tasks": ["8.1", "8.2", "8.3", "9.1", "9.2", "10.1"] },
    { "id": 12, "tasks": ["8.4", "9.3", "9.4", "10.2"] },
    { "id": 13, "tasks": ["10.3"] },
    { "id": 14, "tasks": ["11"] },
    { "id": 15, "tasks": ["12.1"] },
    { "id": 16, "tasks": ["12.2"] },
    { "id": 17, "tasks": ["13"] }
  ]
}
```
