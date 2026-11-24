# Design Document: family-app-demo-parity

## Overview

This feature lets a real family reach the `/demo` state: sign up, create a household, invite people with single-use links, let Grandma join on her own phone, manage members, and see the completed clinic visit stay in the Event_Card's Main_Slot.

The design adds no new architectural layer. It reuses the patterns of `family-shared-care`:

- **Writes** go through Server Actions that validate input with Zod, read the verified session, and call one Postgres function per action through the service-role client (`src/lib/supabase/admin.ts`). Each function checks membership and Role at call time, takes row locks, writes the change, the audit events, Feed_Items, and In_App_Reminders in one transaction, and returns a `jsonb` outcome.
- **Reads** of members, feed items, and audit events use the person's own RLS client. Invites are read only through a guarded function, because the invite table has no client grants.
- **Rules** live in pure TypeScript modules with a reference model (`src/lib/membership/model.ts`), in the same way as `src/lib/care/rules/model.ts`. Property tests run against the model with fast-check. pgTAP tests (`pnpm test:db`) and the integration suite (`pnpm test:integration`) check that the SQL functions match the model, check grants, and check concurrency.

### Key decisions

| # | Decision | Reason |
|---|----------|--------|
| K1 | **The Invite_Token goes in the URL fragment**: `https://<host>/join#<token>`. | Browsers never send the fragment to the server or in `Referer`, so Vercel request logs, CDN logs, and analytics see only `/join`. The token reaches the server only in a Server Action POST body, which is not logged. A query parameter or path segment would be logged. A typed code would be harder for older adults. |
| K2 | After the first open, the server keeps the token in an httpOnly cookie `fudepan_invite` and the client removes the fragment with `history.replaceState`. | Sign-up, email confirmation (new tab), and sign-in can happen between opening the link and accepting it (Requirement 1.8, 6.2). `sessionStorage` is lost in a new tab. The cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and its max age is the time left before Invite_Expiry_Time. It is cleared on acceptance, on an unusable result, and on household creation. |
| K3 | Token = 32 bytes from `crypto.randomBytes` (256 bits), base64url, 43 characters. The database stores only `sha256(token)` as `bytea`. Hashing happens in Node, so the raw token never reaches Postgres, its statement logs, or audit payloads. | Requirements 3.2, 5.1, 5.3. Lookup is an indexed equality on the unique hash column. |
| K4 | Public membership functions are `security definer`, `set search_path = ''`, owned by `postgres`, with `execute` revoked from `public`, `anon`, and `authenticated` and granted only to `service_role`. They take `p_user_id` from the session that the Server Action verified. | Same calling convention as the existing Action_Guard functions (`claim_part`, `release_part`). The browser cannot call them directly (Requirement 15.2), and they keep working on tables that grant nothing to client roles (Requirement 5.4). |
| K5 | One active household per Account (M2), enforced inside `create_household` and `accept_invite` under `pg_advisory_xact_lock` on the user id. | Two concurrent requests for one Account cannot create two memberships. |
| K6 | Last-primary protection locks **all active member rows of the household** (`order by id for update`), then counts in a new statement. | Under READ COMMITTED, the count after the lock sees every committed change, so two concurrent demotions are serialized and the second one sees the first (Requirement 14.2, 14.3). |
| K7 | Invite expiry is applied on access by `private.expire_overdue_invites`, which every invite function calls first. No cron job is needed. `update ... where state = 'pending' and expires_at <= now() returning id` writes exactly one `invite.expired` audit event per invite, because a second transaction sees the state already changed. | Requirements 7.1, 7.2. |
| K8 | A departure first updates the member row (deactivate or role change), then releases Held_Parts. | The release step's reminder loops (`apply_plan_change`, needs-someone reminders) then naturally skip the departing person. The `assert_care_step_owners_in_household` trigger checks only the holders left on the row, who are active. |
| K9 | The Main_Part_Rule keeps an appointment Part in the Main_Slot. The old "next open part" order stays available as `pickNextOpenPart` and is used only by the Recipient_View "Coming up" card. | Requirement 17.1, 17.5, 17.7. `/demo` (`src/app/demo/demo-board.tsx`) and the real card (`event-card-view.tsx`) already both call `buildEventCard`, so they share the rule by construction. |
| K10 | Email confirmation stays a Supabase project setting (M10). `signUp` passes `emailRedirectTo = <origin>/auth/callback?next=<path>`. A new `/auth/callback` route exchanges the code. If that URL is not on the project's redirect allow-list, Supabase falls back to the Site URL, the person signs in normally, and the invite cookie (K2) still brings them back to `/join`. | Requirement 1.6, 1.8 without changing project settings. |

## Architecture

```mermaid
flowchart TD
  subgraph Browser
    SU[/signup/]
    WE[/welcome/ Create_Household_Flow]
    JO[/join#token/ Invite_Acceptance_Page]
    MP[/family/members/]
    IP[/family/invites/]
    FF[/family/ feed + empty states/]
  end
  subgraph Server["Next.js server (Vercel)"]
    SA[Server Actions: Zod + session + i18n refusal mapping]
    SVC[src/lib/membership/service.ts server-only]
    Q[Queries via RLS client]
    LOG[log.ts Masked_Log]
  end
  subgraph Supabase
    AUTH[Supabase Auth]
    FN[security definer functions]
    H[private helpers: locks, expiry, departure]
    T[(households, household_members, household_invites, audit_events, feed_items, care_steps, care_requests)]
  end
  SU --> SA --> AUTH
  WE --> SA
  JO -- token in POST body --> SA
  MP --> SA
  IP --> SA
  SA --> SVC --> FN --> H --> T
  MP --> Q --> T
  FF --> Q
  SA --> LOG
```

### Request flow: accepting an invite

```mermaid
sequenceDiagram
  participant B as Browser (/join)
  participant A as Server Action
  participant DB as Postgres
  B->>B: read location.hash, replaceState('/join')
  B->>A: openInvite({ token })
  A->>A: Zod: base64url, 43 chars; hash = sha256(token)
  A->>DB: preview_invite(hash)
  DB-->>A: {outcome:'usable', household_name, creator_name, role, expires_at} or {outcome:'unusable'}
  A->>B: set cookie fudepan_invite (usable only); preview
  Note over B: not signed in: "Create an account" / "Sign in" (next=/join)
  B->>A: acceptInvite({ displayName }) (token from cookie)
  A->>DB: accept_invite(hash, user_id, display_name)
  DB->>DB: advisory lock(user) -> invite row FOR UPDATE -> checks -> member insert or reactivate -> audits -> feed + reminders
  DB-->>A: {outcome:'joined', role}
  A->>B: clear cookie, redirect /family
```

## Components and Interfaces

### Routes

| Route | Group | Access | Purpose |
|-------|-------|--------|---------|
| `/signup` | `src/app/(onboarding)/signup/` | public; signed-in visitors are redirected like `/login` | Sign_Up_Page (Requirement 1) |
| `/welcome` | `src/app/(onboarding)/welcome/` | signed in, no active membership | Create_Household_Flow (Requirement 2, 12.6) |
| `/join` | `src/app/(onboarding)/join/` | public | Invite_Acceptance_Page (Requirement 6, 8.5). Response header `Referrer-Policy: no-referrer`. |
| `/auth/callback` | `src/app/auth/callback/route.ts` | public | Exchanges the email-confirmation code, then redirects to `safeNextPath(next)` |
| `/family/members` | `src/app/(family)/family/members/` | Family_Members | Members_Page (Requirements 9 to 12, 18.5) |
| `/family/invites` | `src/app/(family)/family/invites/` | active Primary_Caregivers | Invite_Page (Requirements 3, 4). `?role=care_recipient` preselects the Role (16.3). |

Edits to existing routing:

- `src/lib/auth/next-path.ts`: `ALLOWED_NEXT` adds `/join`, `/welcome`, `/family/members`, `/family/invites`. `isProtectedPagePath` adds `/welcome`.
- `src/lib/supabase/proxy.ts`: a signed-in visit to `/signup` redirects like `/login`.
- `src/app/login/page.tsx`: adds a link to `/signup?next=<next>` (Requirement 1.2).
- `src/app/login/actions.ts` `signIn`: after success, redirects to `postAuthDestination(...)` (below) instead of always `safeNextPath(next)`.
- `src/lib/family/session.ts` `requireFamilyContext`: on `no_household`, redirects to `/join` when the invite cookie is present and to `/welcome` otherwise, instead of rendering the "no household" text.
- `src/lib/family/session-core.ts` `familyLinks`: Family_Members get `{ href: "/family/members", labelKey: "nav.members" }` (Requirement 9.2). Care_Recipients are unchanged.

### Pure modules (`src/lib/membership/`, no I/O, fully unit and property tested)

```ts
// invite-token.ts
export const INVITE_TOKEN_BYTES = 32;
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export function generateInviteToken(random: (n: number) => Uint8Array): string; // base64url, 43 chars
export function hashInviteToken(token: string): Uint8Array;                      // sha256, 32 bytes (node:crypto)
export function buildInviteLink(origin: string, token: string): string;          // `${origin}/join#${token}`
export function tokenFromFragment(hash: string): string | null;                 // "#<token>" -> token, else null
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const PENDING_INVITE_CAP = 20;

// invite-state.ts
export type InviteState = "pending" | "accepted" | "revoked" | "expired";
export function effectiveInviteState(stored: InviteState, expiresAt: Date, now: Date): InviteState;

// rules.ts
export type MemberRecord = { id: string; userId: string; householdId: string; role: HouseholdRole; isActive: boolean };
export type MembershipAction =
  | { kind: "create_invite"; householdId: string }
  | { kind: "revoke_invite"; householdId: string }
  | { kind: "change_role"; householdId: string; targetMemberId: string; newRole: HouseholdRole }
  | { kind: "deactivate"; householdId: string; targetMemberId: string }
  | { kind: "leave"; householdId: string }
  | { kind: "rename"; householdId: string; targetMemberId: string };
export type GuardRefusal =
  | "not_found" | "not_primary_caregiver" | "not_self" | "self_target"
  | "last_primary_caregiver" | "invalid_input";
export function guardMembershipAction(
  actorUserId: string, members: readonly MemberRecord[], action: MembershipAction,
): { ok: true } | { ok: false; refusal: GuardRefusal };
export function wouldLeaveNoPrimary(members: readonly MemberRecord[], action: MembershipAction): boolean;

// held-parts.ts
export type HeldRole = "owner" | "driver" | "companion" | "backup_owner";
export type HeldPart = { partId: string; title: string; roles: HeldRole[]; pendingRequestIds: string[];
  ownerless: boolean; approvalWillReset: boolean };
export function heldParts(memberId: string, parts: readonly PartHolders[], requests: readonly RequestRef[]): HeldPart[];

// routing.ts
export function postAuthDestination(input: {
  activeRole: HouseholdRole | null; hasInviteCookie: boolean; requestedNext: string | null;
}): string;
export function recipientRouteDecision(role: HouseholdRole, pathname: string):
  { kind: "stay" } | { kind: "redirect"; to: "/family" };

// member-actions.ts
export function memberActionsFor(viewer: MemberRecord, target: MemberRecord):
  Array<"change_role" | "remove" | "edit_name" | "leave">;

// first-run.ts
export type FirstRunPrompt = "take_photo" | "invite_family" | "invite_recipient" | "recipient_take_photo";
export function firstRunPrompts(input: {
  viewerRole: HouseholdRole; eventCount: number; activeMemberCount: number;
  hasActiveRecipient: boolean; dismissed: ReadonlySet<"invite_family" | "invite_recipient">;
}): FirstRunPrompt[];

// refusals.ts
export function membershipRefusalKey(code: string): MessageKey; // total: unknown codes -> "membership.error.generic"

// audit-payload.ts
export function membershipAuditPayload(event: MembershipEventType, ids: AuditIds): Record<string, string>;

// model.ts — reference model of every SQL function (state + audit/feed/reminder accounting)
export type ModelState = { members: MemberRecord[]; invites: ModelInvite[]; parts: ModelPart[];
  requests: ModelRequest[]; audit: ModelAudit[]; feed: ModelFeed[]; reminders: ModelReminder[] };
export function applyModel(state: ModelState, op: ModelOp, now: Date): { state: ModelState; outcome: string };
```

`postAuthDestination` rules, in order:

1. `hasInviteCookie` → `/join`.
2. `activeRole === null` → `/welcome`.
3. `requestedNext` allowed by `safeNextPath` and, for a Care_Recipient, allowed by `recipientRouteDecision` → `requestedNext`.
4. Otherwise `/family`. The Recipient_View is `/family` for a Care_Recipient (`RecipientHome`).

`recipientRouteDecision` lets a Care_Recipient stay on `/family`, `/family/capture`, and `/family/me/*`. Every other `/family/*` path redirects to `/family`. `/family/members`, `/family/invites`, and `/family/settings/language` call it. Event pages keep their existing redirect to `/family/me/<noteId>`.

### Zod schemas (`src/lib/membership/schemas.ts`)

```ts
const name40 = z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(40));
export const signUpInput = z.object({
  email: z.string().trim().min(1).max(320).pipe(z.email()),
  password: z.string().min(8).max(200),
  next: z.string().optional(),
});
export const createHouseholdInput = z.object({ householdName: name40, displayName: name40 });
export const createInviteInput = z.object({ householdId: z.uuid(), role: z.enum(HOUSEHOLD_ROLES) });
export const revokeInviteInput = z.object({ householdId: z.uuid(), inviteId: z.uuid() });
export const openInviteInput = z.object({ token: z.string().regex(INVITE_TOKEN_PATTERN).nullable() });
export const acceptInviteInput = z.object({ displayName: name40 });
export const changeRoleInput = z.object({ householdId: z.uuid(), memberId: z.uuid(), role: z.enum(HOUSEHOLD_ROLES) });
export const memberTargetInput = z.object({ householdId: z.uuid(), memberId: z.uuid() });
export const renameInput = z.object({ householdId: z.uuid(), displayName: name40 });
```

Every schema error maps to a message key that names the field and the rule ("Use 1 to 40 characters."), never a raw Zod message. Form state returns the entered values except the password (Requirement 1.4, 2.3, 12.2).

### Server Actions

All actions follow one shape: parse with Zod, verify the session with `getSession()` (`auth.getUser()`), call `service.ts`, map refusals with `membershipRefusalKey`, log with `log()` using only allow-listed ID and code fields, and return `{ ok, messageKey, values }` for the form and a `role="status"` announcement.

| Action | File | Calls |
|--------|------|-------|
| `signUp` | `(onboarding)/signup/actions.ts` | `supabase.auth.signUp`. A null session means confirmation is needed (1.6). An obfuscated existing-email response shows the same "check your email" text, so the page does not reveal which emails have accounts. With a session, redirects to `postAuthDestination`. |
| `createHousehold` | `(onboarding)/welcome/actions.ts` | `create_household`; clears the invite cookie; redirects to `/family` |
| `createInvite` | `(family)/family/invites/actions.ts` | generates the token, hashes it, `create_invite(hash, ...)`; returns the token once to the client, which builds the link with `location.origin` |
| `revokeInvite` | same | `revoke_invite` |
| `openInvite` | `(onboarding)/join/actions.ts` | `preview_invite(hash)`; sets or clears the cookie |
| `acceptInvite` | same | reads the token from the cookie, `accept_invite`; clears the cookie; redirects to `/family` |
| `changeMemberRole`, `removeMember`, `leaveHousehold`, `renameSelf` | `(family)/family/members/actions.ts` | the matching function. `leaveHousehold` redirects to `/welcome?left=1`. |

The Invite_Page "Share" button calls `navigator.share({ url })` when `navigator.share` exists. "Copy link" uses `navigator.clipboard.writeText`. The token stays in client memory only while the creation panel is open (Requirement 4.2).

### Server-only service (`src/lib/membership/service.ts`)

`import "server-only"`. It wraps `createAdminClient().rpc(...)`, turns `P0001` error messages that match `^[a-z_]+$` into refusal codes, and turns any other error into `"server_error"`. It never returns or logs `error.message`.

### Queries (RLS client, `src/lib/membership/queries.ts`)

- `listMembers(supabase, householdId)` selects `id, user_id, display_name, role, is_active, created_at` from `household_members`. It never reads `auth.users`, so no email appears (Requirement 9.6).
- `listHeldParts(supabase, householdId, memberId)` reads open `care_steps` and pending `care_requests` that reference the member, then calls `heldParts`.
- `listMembershipAudit(supabase, householdId)` reads `audit_events` where `event_type` is one of the membership events, newest first, limit 50.
- `listInvites` calls `list_invites(household_id, user_id)` through the service, because invites have no client grants.
- `memberNames` (existing, `src/lib/households/queries.ts`) also returns `is_active`. The Timeline formatter appends `member.leftSuffix` ("(left the household)" / 「（世帯を離れました）」) for Former_Members (Requirement 11.7).

### Feed changes (`src/lib/family/feed.ts`)

- `FamilyFeed` gains `notices: FeedNotice[]`, built from household Feed_Items with `note_id is null` and a kind in `MEMBER_NOTICE_KINDS = ["member_joined", "member_role_changed"]`. `params` (`{ member_id, role }`) is read for these kinds only and parsed with Zod. Unknown shapes are dropped.
- New reminder kinds `member_joined`, `member_role_changed`, and `part_needs_someone` get message keys. Reminders with a null `noteId` already render without a link.
- `family-feed-view.tsx` renders `firstRunPrompts(...)` above the feed. The page passes `activeMemberCount` and `hasActiveRecipient` from `listMembers`. A dismissed invite prompt is stored in `localStorage` under `fudepan.firstRun.dismissed.<householdId>`, which is client-only and holds no personal data. "Take a photo" cannot be dismissed. The Members_Page always shows the "Invite family" link to Primary_Caregivers (Requirement 16.5).
- `recipient-home.tsx` shows the `recipient_take_photo` prompt with the sentence `firstRun.recipient.body` when the household has no event (Requirement 16.4).

### Event_Card change (`src/lib/family/event-card.ts`)

```ts
const isAppointment = (p: EventPart) => p.careCategory === "appointment";

/** Main_Part_Rule (Requirement 17). Parts arrive in position order, so "earliest" means first in that order. */
export function pickMainPart(parts: readonly EventPart[]): EventPart | null {
  const appointments = parts.filter(isAppointment);
  if (appointments.length > 0) {
    return (
      appointments.find((p) => !isClosed(p)) ??
      appointments.find((p) => p.progressStatus === "completed") ??
      appointments[0]
    );
  }
  const open = parts.filter((p) => !isClosed(p));
  return open.find(isTravel) ?? open[0] ?? parts[0] ?? null;
}

/** The previous order, kept for the Recipient_View "Coming up" card (Requirement 17.7). */
export function pickNextOpenPart(parts: readonly EventPart[]): EventPart | null; // unchanged body of the old pickMainPart

export function buildEventCard(event: SharedCareEvent, options?: { mainRule?: "main" | "nextOpen" }): EventCard;
```

`EventCard.main` gains:

```ts
status: "open" | "completed" | "cancelled";
prompts: { timeUnknown: boolean; dateUnknown: boolean; placeUnknown: boolean; openSlots: boolean };
```

When `status === "completed"`, all `prompts` are false and `slots` keeps only filled slots. `when` is still `whenOf(part)`, so a confirmed or note-quoted time stays visible. `event-card-view.tsx` and `card-parts.tsx` `DateTile` read `prompts` instead of testing `when.kind === "unknown"`, and show the `label.done` badge (text and ✅ icon, never color alone) when `status === "completed"`. `GrandmaCard` in `recipient-view.tsx` passes `{ mainRule: "nextOpen" }`, so Grandma's "Coming up" card is unchanged.

### i18n

New dictionary files `src/lib/i18n/membership-en.ts` and `membership-ja.ts` are spread into `en.ts` and `ja.ts`, as `event-en.ts` is today. Typecheck already forces `ja` to have every key. Key groups:

- `signup.*`, `welcome.*`, `join.*`, `invites.*`, `members.*`, `firstRun.*`
- `role.<code>.label` and `role.<code>.description` for all eight Roles
- `inviteState.<state>`
- `membership.refusal.<code>` and `membership.error.generic`
- `audit.membership.<event>` for the Members_Page history (18.5)
- `nav.members`, `member.leftSuffix`

Pages before membership (`/signup`, `/welcome`, `/join`) use `getRequestLanguage()` (Accept-Language, English fallback, Requirement 20.2). Member pages use `FamilyContext.language`.

### Accessibility

- Reuse `app-title`, `app-lede`, `family-card`, and `BigButton` styles. Inputs and buttons are at least 48 by 48 CSS pixels. `/join` with a `care_recipient` invite sets `data-size="large"` (body text 20 px or more, Requirement 8.5).
- Every form uses `<label for>`, `required`, `aria-required="true"`, and visible "(required)" text. Errors are linked with `aria-describedby` and name the field.
- Results are announced in one `role="status"` region per page (Requirement 20.6).
- Removal, leaving, revocation, and demoting a Primary_Caregiver use an inline two-step confirmation. Step two names the person, lists Held_Parts with their consequence text, and focuses the confirm button (Requirement 20.7, 11.6, 12.7).
- Layouts are single-column grids with `min-w-0` and no fixed widths, so nothing scrolls sideways at 360 px.
- Expiry times render in a small client component with `Intl.DateTimeFormat(lang, { dateStyle, timeStyle, timeZoneName: "short" })`, so the timezone is shown (Requirements 3.4, 4.1).

## Data Models

### Migrations (additive, after `20261210000600_recipient_reply.sql`)

**`20261215000000_household_invites.sql`**

```sql
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id),
  role text not null,
  token_hash bytea not null,
  created_by_member_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  state text not null default 'pending',
  accepted_by_user_id uuid references auth.users (id),
  accepted_member_id uuid,
  accepted_at timestamptz,
  revoked_by_member_id uuid,
  revoked_at timestamptz,
  expired_at timestamptz,
  constraint household_invites_token_hash_len check (octet_length(token_hash) = 32),
  constraint household_invites_token_hash_unique unique (token_hash),
  constraint household_invites_role_valid check (role in (
    'care_recipient','primary_caregiver','family_member','medical_coordinator',
    'finance_coordinator','transport_coordinator','emergency_contact','professional_caregiver')),
  constraint household_invites_state_valid check (state in ('pending','accepted','revoked','expired')),
  constraint household_invites_ttl check (expires_at = created_at + interval '7 days'),
  constraint household_invites_accepted_fields check (
    (state = 'accepted') = (accepted_at is not null and accepted_by_user_id is not null and accepted_member_id is not null)),
  constraint household_invites_revoked_fields check ((state = 'revoked') = (revoked_at is not null)),
  constraint household_invites_expired_fields check ((state = 'expired') = (expired_at is not null)),
  constraint household_invites_creator_same_household
    foreign key (created_by_member_id, household_id) references public.household_members (id, household_id),
  constraint household_invites_accepted_member_same_household
    foreign key (accepted_member_id, household_id) references public.household_members (id, household_id),
  constraint household_invites_revoker_same_household
    foreign key (revoked_by_member_id, household_id) references public.household_members (id, household_id)
);
create index household_invites_household_idx on public.household_invites (household_id, created_at desc);
create index household_invites_pending_idx on public.household_invites (household_id, expires_at) where state = 'pending';

alter table public.household_invites enable row level security;  -- no policies
revoke all on table public.household_invites from public, anon, authenticated;
grant all on table public.household_invites to service_role;

-- Defense in depth (Requirement 15.4): already select-only today; restated explicitly.
revoke insert, update, delete, truncate on table public.households, public.household_members from anon, authenticated;
```

**`20261215000100_membership_helpers.sql`** (private, security invoker, service_role only, like the existing helpers):

| Helper | Behavior |
|--------|----------|
| `private.lock_active_members(p_household_id) returns setof public.household_members` | `select ... where household_id = p and is_active order by id for update` |
| `private.expire_overdue_invites(p_household_id) returns integer` | `update household_invites set state='expired', expired_at=now() where household_id=p and state='pending' and expires_at <= now() returning id, role`; one `invite.expired` audit (actor `system`, payload `{invite_id, role}`) per returned row |
| `private.release_departing_member(p_household_id, p_member_id) returns integer` | The departure algorithm below |
| `private.notify_primaries(p_household_id, p_exclude_member_id, p_kind, p_params)` | `add_reminder` for each active Primary_Caregiver except the excluded member, ordered by `created_at, id` |

Departure algorithm (`release_departing_member`), run after the member row has been updated (K8):

```text
for each open step s (status not in completed, cancelled, failed) in the household
    where s holds p_member as owner/driver/companion/backup_owner
       or a pending care_request on s has from/to = p_member
    order by s.id, locked FOR UPDATE:
  removed := roles of s held by p_member
  update care_steps set each removed role column = null           -- one statement
  for each role in removed:
    audit 'part.released' (actor system) {role, member_id, reason:'member_departed'}
  for each pending request r on s with from/to = p_member:
    update r set status='declined', resolved_at=now(), resolved_by=null
    audit '<kind>.declined' (actor system) {request_id, role?, reason:'member_departed'}
    add_reminder(other party of r, '<kind>_declined')               -- skipped if other party inactive
  if removed contains owner, driver, or companion:
    perform private.apply_people_change(s.id, first performer role removed, null)
      -- approved High_Risk_Part -> pending + approval.reset + reminders (family-shared-care 9.22)
  if 'owner' in removed:
    add_feed_item 'part_released' {role:'owner', needs_someone:true, reason:'member_departed'}
    notify_primaries(household, p_member, 'part_needs_someone', {})
-- The 24-hour release block of release_part is not applied (Requirement 13.8).
-- Escalation_Checker already selects unclaimed High_Risk_Parts (owner_id is null), so 13.7 needs no change.
```

**`20261215000200_membership_functions.sql`** (public, `security definer`, service_role only, K4). Each returns `jsonb` with `outcome`. Refusals that change nothing raise `P0001` with a code. Outcomes that must commit a change, such as expiry, are returned instead of raised.

| Function | Locks and checks | Writes |
|----------|------------------|--------|
| `create_household(p_user_id, p_household_name, p_display_name)` | advisory lock(user); no active row anywhere, else `already_in_household`; names 1 to 40 after trim, else `invalid_input` | household; member (`primary_caregiver`); audits `household.created` and `member.joined` `{member_id, role}` |
| `create_invite(p_household_id, p_user_id, p_role, p_token_hash)` | household row `for update`; actor active primary, else `not_found` / `not_primary_caregiver`; `expire_overdue_invites`; pending count < 20, else `invite_cap_reached` | invite (`expires_at = now() + 7 days`); audit `invite.created` `{invite_id, role}`; returns `{invite_id, expires_at}` |
| `list_invites(p_household_id, p_user_id)` | actor active primary; `expire_overdue_invites` | returns rows `{id, role, creator_member_id, created_at, expires_at, state}` newest first, never `token_hash` |
| `revoke_invite(p_household_id, p_invite_id, p_user_id)` | actor active primary; `expire_overdue_invites`; invite in household `for update`, else `not_found`; not pending → `{outcome:'not_pending', state}` | state `revoked`; audit `invite.revoked` `{invite_id, role}` |
| `preview_invite(p_token_hash)` | `expire_overdue_invites` for the matched household | usable → `{outcome:'usable', household_name, creator_display_name, role, expires_at}`; anything else (unknown, accepted, revoked, expired) → `{outcome:'unusable'}` with no other field |
| `accept_invite(p_token_hash, p_user_id, p_display_name)` | advisory lock(user); invite `for update`; unknown or not pending → `{outcome:'unusable'}`; `expires_at <= now()` → mark expired, audit, return `{outcome:'unusable'}`; active row in this household → `already_member`; active row elsewhere → `one_household_only`; name invalid → `invalid_input` | former row: reactivate with the invite role and name, audit `member.rejoined`; else insert, audit `member.joined`. Invite `accepted`; audit `invite.accepted` `{invite_id, member_id, role}`; feed `member_joined` `{member_id, role}`; `notify_primaries(..., new member, 'member_joined')` |
| `change_member_role(p_household_id, p_member_id, p_user_id, p_role)` | `lock_active_members`; actor active primary; target active in household; same role → `{outcome:'unchanged'}`; last-primary check | role; audit `member.role_changed` `{member_id, old_role, new_role}`; feed `member_role_changed`; reminder to target; if new role `care_recipient`: `release_departing_member` |
| `deactivate_member(p_household_id, p_member_id, p_user_id)` | `lock_active_members`; actor active primary; target is another active member, else `self_target` (use leave); last-primary check | `is_active=false`; audit `member.deactivated` `{member_id, role}`; `release_departing_member` |
| `leave_household(p_household_id, p_user_id)` | `lock_active_members`; actor active; actor is last primary → `last_primary_caregiver` | `is_active=false`; audit `member.left` `{member_id, role}`; `release_departing_member` |
| `set_member_display_name(p_household_id, p_user_id, p_display_name)` | actor's own active row `for update`; 1 to 40 after trim | name; audit `member.display_name_changed` `{member_id}` |

Every audit row: `actor_type = 'human'` and `actor_id = p_user_id` for the person's action, and `actor_type = 'system'` for expiry and departure side effects (Requirement 18.2). Payloads hold only UUIDs, Role codes, state codes, and reason codes (18.3). `audit_events` keeps its existing select-only client grant (18.4).

Cross-household attempts: the actor lookup filters by household, so a non-member gets `not_found`, which is the same refusal as a missing row. No household data appears in the error (Requirement 15.3).

Lock order everywhere: user advisory lock → invite row → household member rows → care_steps by id → care_requests. Existing `claim_part` locks a step and then reads `actor_member` without locking it. If a departure commits first, the claim sees the inactive row and is refused. If the claim commits first, the departure re-reads the locked step and clears the claim.

**`src/lib/supabase/database.types.ts`** is regenerated (or hand-extended) for the new table and functions.

### Seeded data (Requirement 21.2)

No existing row changes. Seeded households have at least one active Primary_Caregiver, so the new invariant holds from the start. A pgTAP test asserts that before the functions run.

## Error Handling

| Situation | Behavior |
|-----------|----------|
| Zod failure | Field-level message keys, values kept, password cleared. No Supabase call. |
| Supabase Auth refusal on sign-up | `auth.sign_up_failed` logged with `code` only. The message is plain language; rate limiting (429) gets its own text. |
| `P0001` refusal code | `membershipRefusalKey(code)` gives a specific plain-language key, for example `membership.refusal.last_primary_caregiver` = "The household needs at least one primary caregiver. Make someone else a primary caregiver first." |
| `{outcome:'not_pending', state}` on revoke | "This link is already {state}." with the state in words (4.5). |
| `{outcome:'unusable'}` | One message for unknown, used, revoked, and expired links: "This link can no longer be used. It may have been used already, cancelled, or run out of time. Ask your family for a new link." Concurrent losers get this message too (6.4 to 6.6). The cookie is cleared. |
| Any other DB or network error | `membership.error.generic` with "Try again"; values kept. The log gets `code` from `errorCode()` only. The transaction has rolled back, so the departure message says "Nothing was changed." (2.3, 13.6, 19.2) |
| Session missing in an action | `refusal.signedOut` and a link to `/login?next=...` |

Logging: `log()` already redacts any value that is not a short ID or code. New events (`membership.invite_created`, `membership.accept_refused`, and so on) pass only `household_id`, `user_id`, `reason`, `code`, `count`. Tokens, emails, and names are never passed (Requirement 5.2, 19.1). `SUPABASE_SERVICE_ROLE_KEY` is read only in `server-only` modules (19.3).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Properties 1 to 8 run against the reference model (`src/lib/membership/model.ts`). pgTAP and integration tests replay a few generated sequences against the SQL functions and compare outcomes and accounting with the model.

### Property 1: A household always keeps an active primary caregiver

For any household with at least one active Primary_Caregiver and any sequence of role changes, deactivations, and leaves by any actors (including interleavings of requests that each passed their own check against the same starting state), the resulting state has at least one active Primary_Caregiver. Every refused request leaves every Role and `is_active` value unchanged, and a request that would remove the last Primary_Caregiver is refused with `last_primary_caregiver`.

**Validates: Requirements 10.3, 11.3, 12.5, 14.1, 14.3**

### Property 2: Membership actions are authorized against the current state

For any member state, actor, and membership action, `guardMembershipAction` allows the action exactly when the actor has an active row in the action's household and either is a Primary_Caregiver (create or revoke invite, change role, remove another member) or targets the actor's own row (rename, leave). When it refuses, the model state, audit log, and feed are unchanged. When the actor has no active row in the household, the refusal is `not_found` and carries no household data.

**Validates: Requirements 2.4, 3.5, 4.4, 4.7, 10.2, 11.2, 11.5, 12.3, 15.2, 15.3**

### Property 3: Invites are single use and terminal states never change

For any invite and any sequence of accept, revoke, preview, and list operations at any times, including several accepts by different Accounts, at most one accept succeeds. After the state becomes `accepted`, `revoked`, or `expired`, it never changes again, and later accepts return `unusable` while later revokes return `not_pending` with the current state. A successful accept by a valid Account creates or reactivates a member with exactly the invite's Role.

**Validates: Requirements 4.3, 4.5, 6.3, 6.4, 7.3**

### Property 4: Expiry is enforced on access and audited exactly once

For any invite created at time `c`, `expiresAt = c + 7 days`, and for any operation sequence and times: every accept at a time `>= expiresAt` is refused, and if the invite was pending it becomes `expired`. `effectiveInviteState(stored, expiresAt, now)` equals `expired` exactly when the stored state is `expired`, or the stored state is `pending` and `now >= expiresAt`. Each invite has at most one `invite.expired` audit event, and has exactly one when its state is `expired`.

**Validates: Requirements 3.2, 4.6, 7.1, 7.2**

### Property 5: Pending invites stay within the cap

For any sequence of invite creations, revocations, acceptances, and time steps in one household, the number of invites whose effective state is `pending` never exceeds 20. A creation is refused with `invite_cap_reached` exactly when 20 effectively pending invites already exist.

**Validates: Requirements 3.6**

### Property 6: Membership rows are never duplicated or deleted, and an Account has at most one active household

For any sequence of create-household, accept, deactivate, leave, and role-change operations, there is at most one `household_members` row per (household, Account). The set of rows only grows, and deactivation and leaving change only `is_active`. Every Account has at most one active row across all households. Accepting while active in the same household (`already_member`) or in another household (`one_household_only`) leaves the invite `pending`. Accepting with a Former_Member row reactivates that row instead of adding one.

**Validates: Requirements 2.4, 6.7, 6.8, 6.9, 11.1, 11.4, 12.4**

### Property 7: A departure leaves nothing held by the departing member

For any household state with open and closed Parts, pending requests, and Approval_States (including Parts due within 24 hours), after a deactivation, a leave, or a role change to `care_recipient` of member `m`: no open Part has `m` as owner, driver, companion, or backup owner. No pending request has `m` as sender or receiver. Every approved High_Risk_Part from which an owner, driver, or companion was removed is `pending`. The number of system `part.released` audit events equals the number of helper roles removed. Closed Parts are unchanged.

**Validates: Requirements 10.5, 13.1, 13.2, 13.3, 13.5, 13.8**

### Property 8: Every successful membership action writes its audit, feed, and reminder records

For any successful model operation, the new audit events are exactly the event types listed for that function in the Data Models table, each with the correct actor type and, for human actions, the acting Account. An accept adds one `member_joined` Feed_Item and one reminder per other active Primary_Caregiver. A role change adds one `member_role_changed` Feed_Item and one reminder to the changed member. A departure that leaves a Part without an owner adds one needs-someone Feed_Item for that Part and one reminder per remaining active Primary_Caregiver.

**Validates: Requirements 2.2, 6.10, 10.1, 10.6, 13.4, 18.1, 18.2**

### Property 9: Invite tokens are strong, round-trip through the fragment, and stay out of logged URL parts

For any random source, `generateInviteToken` returns a string that matches `^[A-Za-z0-9_-]{43}$` and encodes 32 bytes. For any token and origin, `tokenFromFragment(new URL(buildInviteLink(origin, token)).hash) === token`, and the token does not appear in the URL's `pathname` or `search`. `hashInviteToken` is deterministic, returns 32 bytes, and its hex or base64url form never equals the token. Distinct generated tokens give distinct hashes.

**Validates: Requirements 3.2, 5.1, 5.5**

### Property 10: Audit payloads and logs carry no personal data or tokens

For any membership event and any inputs that contain emails, display names, and tokens, `membershipAuditPayload` returns an object whose values are only UUIDs, Role codes, Invite_State codes, or reason codes, and contains none of the input names, emails, tokens, or token hashes. For any such string passed as a log field, `maskLogFields` outputs `[REDACTED]` or drops it.

**Validates: Requirements 5.2, 12.1, 18.3, 19.1**

### Property 11: Every failure maps to a plain-language message

For any refusal code string, including unknown codes, raw Postgres messages, and strings that contain a token, `membershipRefusalKey` returns a message key that exists in both `en` and `ja`. The rendered text never contains the input string.

**Validates: Requirements 1.5, 19.2**

### Property 12: Unusable and unknown invite links look the same

For any invite in state `accepted`, `revoked`, or `expired`, any pending invite previewed at or after its expiry, and any token that matches no invite, the preview result is exactly `{ outcome: "unusable" }`, with no household name, member name, or Role.

**Validates: Requirements 6.5, 6.6**

### Property 13: Name and sign-up inputs follow the length rules and keep entered values

For any string, `name40` accepts it exactly when its trimmed length is between 1 and 40, and the accepted value is the trimmed string. For any sign-up input that fails validation, the returned form state contains the entered email, contains no password, and names each failing field.

**Validates: Requirements 1.3, 1.4, 2.1, 12.1, 12.2**

### Property 14: After authentication, each person lands in the right place

For any combination of active Role (or none), invite cookie presence, and requested `next` path: an invite cookie always leads to `/join`; otherwise no active membership leads to `/welcome`; otherwise the result is an allowed path, and for a Care_Recipient it is a path that `recipientRouteDecision` lets them stay on.

**Validates: Requirements 1.7, 1.8, 6.11, 12.6**

### Property 15: A care recipient only reaches recipient routes

For any pathname under `/family` and any Role, `recipientRouteDecision` returns `stay` for every non-recipient Role. For `care_recipient` it returns `stay` exactly for `/family`, `/family/capture`, and `/family/me/<uuid>` paths, and a redirect to `/family` for every other path, including `/family/members`, `/family/invites`, and `/family/settings/language`.

**Validates: Requirements 8.1, 8.3**

### Property 16: Member row actions match the viewer's rights

For any viewer and target in the same household, `memberActionsFor` returns `edit_name` and `leave` exactly when the target is the viewer and the viewer is a Family_Member. It returns `change_role` and `remove` exactly when the viewer is an active Primary_Caregiver and the target is another active member.

**Validates: Requirements 9.3, 9.4**

### Property 17: Held_Parts listed on confirmation match the departure

For any member and any household Parts and requests, `heldParts` returns exactly the open Parts that Property 7's departure changes, with the roles removed and the pending requests closed. `ownerless` is true exactly when the owner is removed, and `approvalWillReset` is true exactly when the model resets approval.

**Validates: Requirements 11.6, 12.7**

### Property 18: First-run prompts follow the household's state

For any viewer Role, event count, active member count, recipient presence, and dismissed set: a Family_Member viewer gets `take_photo` exactly when the event count is 0. A Primary_Caregiver gets `invite_family` exactly when there is one active member and it is not dismissed, and `invite_recipient` exactly when no active Care_Recipient exists and it is not dismissed. A Care_Recipient viewer gets only `recipient_take_photo`, and only when the event count is 0.

**Validates: Requirements 16.1, 16.2, 16.3, 16.4**

### Property 19: The Main_Part_Rule keeps the appointment in the Main_Slot

For any list of Parts with at least one appointment Part, `pickMainPart` returns an appointment Part: the first open one if any is open, otherwise the first completed one, otherwise the first one. For any list with no appointment Part, `pickMainPart` returns the same Part as the old order (first open travel Part, then first open Part, then first Part). For any list, `pickNextOpenPart` equals the old `pickMainPart`.

**Validates: Requirements 17.1, 17.5, 17.7**

### Property 20: A completed main Part shows Done without open prompts, and every other Part stays listed

For any ready Shared_Care_Event whose Main_Slot Part is `completed`, `buildEventCard` returns `main.status = "completed"`, `main.when = whenOf(part)`, every `prompts` flag false, and only filled slots. The `items` list contains every other Part exactly once, each with `done` equal to its own closed state.

**Validates: Requirements 17.2, 17.3, 17.4**

## Testing Strategy

**Property tests** (Vitest + fast-check, at least 100 runs each, `{ numRuns: 100 }` or more). Each test is tagged in its `describe` name with `Feature: family-app-demo-parity, Property <n>: <title>`.

| Property | Test file | Generators |
|----------|-----------|------------|
| 1 to 8 | `src/lib/membership/model.test.ts` | households with 1 to 6 members and random Roles; operation sequences of length 1 to 30 with random actors, targets, and time steps (including steps that cross `expiresAt` and land on it exactly); Parts with random categories, statuses, holders, Approval_States, and due times within 24 hours; interleavings modeled as "both checked against the starting state, applied in order" |
| 2, 16 | `rules.test.ts`, `member-actions.test.ts` | arbitrary member arrays and actions |
| 9 | `invite-token.test.ts` | `fc.uint8Array({ minLength: 32, maxLength: 32 })` as the random source; origins from `fc.webUrl()` |
| 10, 11 | `audit-payload.test.ts`, `refusals.test.ts` | `fc.emailAddress()`, unicode names, tokens, `fc.string()` codes |
| 12 | model test | invites in every state and tokens not in the store |
| 13 | `schemas.test.ts` | `fc.string()` with whitespace padding, lengths 0 to 60, unicode |
| 14, 15 | `routing.test.ts` | Role × cookie × next path from the allow-list and random paths |
| 17 | `held-parts.test.ts` | the same part generator as Property 7; compares with the model's departure diff |
| 18 | `first-run.test.ts` | small integer ranges and dismissed subsets |
| 19, 20 | `src/lib/family/event-card.test.ts` | `EventPart` arbitraries with random category, status, times, and holders; Property 19 compares with a copy of the old function kept in the test as the reference |

**Example tests** (Vitest + Testing Library):

- Sign-up view: fields, labels, required markers, link to sign-in. The login page links to sign-up. A confirmation-needed message appears when `signUp` returns no session (1.1, 1.2, 1.6).
- Invite_Page: Role descriptions in en and ja, one-time link panel with Copy and Share, care-recipient hint, list with states in words and a timezone, no token after closing (3.1, 3.3, 3.4, 3.7, 4.1, 4.2).
- `/join`: preview text, "Create an account" and "Sign in" when signed out, large size for `care_recipient`, unusable message (6.1, 6.2, 8.5).
- Members_Page: "You" marker, no email, confirmation steps naming the person and consequences, `role="status"` announcements, audit history list (9.1, 9.6, 11.7, 18.5, 20.5 to 20.7).
- Demo parity (17.6): start from `initialDemoEvent("ja")`, complete the appointment Part with `applyDemoAction`, and assert that `buildEventCard` gives the appointment Part as `main` with `status: "completed"`, `prompts.timeUnknown === false`, and the same `partId` as a card built from the equivalent rows through the real event mapper. A render test of `EventCardView` shows 「完了」 and no 「時間はまだ分かりません」.
- Recipient regression (17.7): the existing `recipient-view.test.tsx` "Coming up" cases still pass with `mainRule: "nextOpen"`.
- i18n: every new key is non-empty in `en` and `ja` (20.1).

**Database tests** (`supabase/tests/*.sql` via `pnpm test:db`, pgTAP):

- Grants: no `select`, `insert`, `update`, or `delete` on `household_invites` for `anon` and `authenticated`; no write grants on `households` or `household_members`; membership functions are executable only by `service_role` (5.4, 11.4, 15.4, 18.4).
- RLS: a member of household A reads no members or audit events of household B. A deactivated member reads nothing (9.5, 11.5, 15.1).
- Each function: success accounting and each refusal code, compared with the model on fixed scenarios. Rollback: a forced failure inside the departure leaves member rows and Parts unchanged (2.3, 13.6).
- Departure makes an unclaimed High_Risk_Part selectable by the Escalation_Checker query (13.7).
- Seeded households satisfy the at-least-one-primary invariant (21.2).

**Integration tests** (`pnpm test:integration`, local Supabase):

- Two parallel `accept_invite` calls on one invite: exactly one `joined` (6.4).
- Two parallel demotions of the last two Primary_Caregivers: exactly one commits (14.2, 14.3).
- A role change applies to the very next `claim_part` call (10.4).

**Quality gates**: `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` must pass (21.3). Requirements 8.2 (session kept across restarts by the existing proxy refresh and Supabase cookie lifetime), 20.3 (360 px layout), and 20.4 (keyboard focus) are checked manually in a browser.
