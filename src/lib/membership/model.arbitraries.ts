/**
 * Shared fast-check generators for the membership model property tests.
 * Ids are deterministic UUIDs built from small integers so shrinking stays readable.
 */
import fc from "fast-check";
import type { ApprovalState } from "@/lib/care/rules/types";
import { HOUSEHOLD_ROLES, type HouseholdRole } from "@/lib/households/membership";
import { INVITE_TTL_MS } from "./invite-token";
import {
  applyModel,
  emptyModelState,
  type ModelInvite,
  type ModelMember,
  type ModelOp,
  type ModelPart,
  type ModelRequest,
  type ModelResult,
  type ModelState,
} from "./model";
import type { InviteState } from "./invite-state";

export const T0 = new Date("2026-12-15T00:00:00.000Z");
export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;
export const USER_POOL = 20;

export const uuid = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
export const householdUuid = (k: number) => uuid(1 + k);
export const userUuid = (k: number) => uuid(1000 + k);
export const memberUuid = (k: number) => uuid(100 + k);
export const partUuid = (k: number) => uuid(200 + k);
export const requestUuid = (k: number) => uuid(300 + k);
export const inviteUuid = (k: number) => uuid(400 + k);
/** Ids for things created by the operation at sequence index i. */
export const newMemberUuid = (i: number) => uuid(5000 + i);
export const newInviteUuid = (i: number) => uuid(6000 + i);
export const newHouseholdUuid = (i: number) => uuid(7000 + i);

export const roleArb: fc.Arbitrary<HouseholdRole> = fc.constantFrom(...HOUSEHOLD_ROLES);
const approvalArb: fc.Arbitrary<ApprovalState> = fc.constantFrom("not_required", "pending", "approved", "rejected");
export const nameArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: fc.string({ minLength: 1, maxLength: 12 }).map((s) => `N${s}`) },
  { weight: 1, arbitrary: fc.constantFrom("", "   ", "x".repeat(41), ` ${"y".repeat(40)} `) },
);

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

type MemberSpec = { role: HouseholdRole; active: boolean };
type PartSpec = {
  highRisk: boolean;
  open: boolean;
  approval: ApprovalState;
  holders: (number | null)[];
  dueHours: number;
};
type RequestSpec = { part: number; from: number; to: number; kind: "assignment" | "handover" | "backup" };
type InviteSpec = { state: InviteState; age: number; role: HouseholdRole; household: number };

const memberSpecArb: fc.Arbitrary<MemberSpec> = fc.record({
  role: roleArb,
  active: fc.boolean().chain((b) => fc.constantFrom(true, true, true, b)),
});
const partSpecArb: fc.Arbitrary<PartSpec> = fc.record({
  highRisk: fc.boolean(),
  open: fc.constantFrom(true, true, true, false),
  approval: approvalArb,
  holders: fc.array(fc.option(fc.nat(10), { nil: null }), { minLength: 4, maxLength: 4 }),
  dueHours: fc.integer({ min: 0, max: 72 }),
});
const requestSpecArb: fc.Arbitrary<RequestSpec> = fc.record({
  part: fc.nat(10),
  from: fc.nat(10),
  to: fc.nat(10),
  kind: fc.constantFrom("assignment", "handover", "backup"),
});
const AGES = [0, HOUR, DAY, 6 * DAY, INVITE_TTL_MS - 1, INVITE_TTL_MS, INVITE_TTL_MS + 1, 9 * DAY];
const inviteSpecArb = (states: readonly InviteState[]): fc.Arbitrary<InviteSpec> =>
  fc.record({
    state: fc.constantFrom(...states),
    age: fc.constantFrom(...AGES),
    role: roleArb,
    household: fc.nat(1),
  });

export type StateOptions = {
  /** Number of households, default 1 to 2. */
  households?: [number, number];
  /** Add this many fresh pending invites to household 0 (cap tests). */
  freshPending?: [number, number];
  /** Skip parts and requests. */
  noParts?: boolean;
};

export type StateSpec = {
  householdCount: number;
  members: MemberSpec[][];
  parts: PartSpec[];
  requests: RequestSpec[];
  invites: InviteSpec[];
  fresh: number;
};

export function buildState(spec: StateSpec): ModelState {
  const s = emptyModelState();
  let userCounter = 0;
  let memberCounter = 0;
  const activeByHousehold: ModelMember[][] = [];
  for (let h = 0; h < spec.householdCount; h++) {
    const householdId = householdUuid(h);
    s.households.push({ id: householdId, name: `House ${h}` });
    const active: ModelMember[] = [];
    const list = spec.members[h] ?? [{ role: "primary_caregiver", active: true }];
    list.forEach((m, j) => {
      const first = j === 0;
      const member: ModelMember = {
        id: memberUuid(memberCounter++),
        userId: userUuid(userCounter++ % USER_POOL),
        householdId,
        role: first ? "primary_caregiver" : m.role,
        isActive: first ? true : m.active,
        displayName: `Member ${h}-${j}`,
      };
      s.members.push(member);
      if (member.isActive) active.push(member);
    });
    activeByHousehold.push(active);
  }
  const holderOf = (active: ModelMember[], ref: number | null) =>
    ref === null || active.length === 0 ? null : active[ref % active.length].id;
  spec.parts.forEach((p, k) => {
    const h = k % spec.householdCount;
    const active = activeByHousehold[h];
    const part: ModelPart = {
      partId: partUuid(k),
      title: `Part ${k}`,
      isOpen: p.open,
      ownerId: holderOf(active, p.holders[0]),
      driverId: holderOf(active, p.holders[1]),
      companionId: holderOf(active, p.holders[2]),
      backupOwnerId: holderOf(active, p.holders[3]),
      isHighRisk: p.highRisk,
      approvalState: p.approval,
      householdId: householdUuid(h),
      dueAt: new Date(T0.getTime() + p.dueHours * HOUR),
    };
    s.parts.push(part);
  });
  spec.requests.forEach((r, k) => {
    const open = s.parts.filter((p) => p.isOpen);
    if (open.length === 0) return;
    const part = open[r.part % open.length];
    const active = activeByHousehold[s.households.findIndex((x) => x.id === part.householdId)];
    if (!active || active.length < 2) return;
    const from = active[r.from % active.length];
    const to = active[r.to % active.length];
    if (from.id === to.id) return;
    const req: ModelRequest = {
      id: requestUuid(k),
      partId: part.partId,
      householdId: part.householdId,
      kind: r.kind,
      fromId: from.id,
      toId: to.id,
      status: "pending",
    };
    s.requests.push(req);
  });
  const addInvite = (h: number, state: InviteState, age: number, role: HouseholdRole, n: number) => {
    const householdId = householdUuid(h);
    const creator = s.members.find((m) => m.householdId === householdId && m.role === "primary_caregiver")!;
    const effectiveAge = state === "expired" ? Math.max(age, INVITE_TTL_MS) : age;
    const createdAt = new Date(T0.getTime() - effectiveAge);
    const inv: ModelInvite = {
      id: inviteUuid(n),
      householdId,
      role,
      token: `pre-${n}`,
      createdByMemberId: creator.id,
      createdAt,
      expiresAt: new Date(createdAt.getTime() + INVITE_TTL_MS),
      state,
      acceptedByUserId: state === "accepted" ? creator.userId : null,
      acceptedMemberId: state === "accepted" ? creator.id : null,
      acceptedAt: state === "accepted" ? createdAt : null,
      revokedByMemberId: state === "revoked" ? creator.id : null,
      revokedAt: state === "revoked" ? createdAt : null,
      expiredAt: state === "expired" ? new Date(createdAt.getTime() + INVITE_TTL_MS) : null,
    };
    s.invites.push(inv);
    if (state === "expired") {
      s.audit.push({
        type: "invite.expired",
        actorType: "system",
        actorId: null,
        householdId,
        payload: { invite_id: inv.id, role },
      });
    }
  };
  let n = 0;
  for (const i of spec.invites) addInvite(i.household % spec.householdCount, i.state, i.age, i.role, n++);
  for (let f = 0; f < spec.fresh; f++) addInvite(0, "pending", (f * 7919) % DAY, "family_member", n++);
  return s;
}

export function stateArb(options: StateOptions = {}): fc.Arbitrary<ModelState> {
  const [hMin, hMax] = options.households ?? [1, 2];
  const [fMin, fMax] = options.freshPending ?? [0, 0];
  const inviteStates: readonly InviteState[] =
    fMax > 0 ? ["accepted", "revoked", "expired"] : ["pending", "accepted", "revoked", "expired"];
  return fc
    .record({
      householdCount: fc.integer({ min: hMin, max: hMax }),
      members: fc.array(fc.array(memberSpecArb, { minLength: 1, maxLength: 6 }), { minLength: hMax, maxLength: hMax }),
      parts: options.noParts ? fc.constant<PartSpec[]>([]) : fc.array(partSpecArb, { maxLength: 6 }),
      requests: options.noParts ? fc.constant<RequestSpec[]>([]) : fc.array(requestSpecArb, { maxLength: 4 }),
      invites: fc.array(inviteSpecArb(inviteStates), { maxLength: 4 }),
      fresh: fc.integer({ min: fMin, max: fMax }),
    })
    .map(buildState);
}

// ---------------------------------------------------------------------------
// Operation sequences
// ---------------------------------------------------------------------------

export type Step = { op: ModelOp; advanceMs: number };

const KINDS = [
  "create_invite", "create_invite", "create_invite", "create_invite",
  "accept_invite", "accept_invite", "accept_invite", "accept_invite", "accept_invite",
  "revoke_invite", "revoke_invite",
  "preview_invite", "preview_invite",
  "list_invites",
  "change_role", "change_role", "change_role",
  "deactivate", "deactivate",
  "leave", "leave",
  "rename",
  "create_household",
] as const;
const STEPS = [0, 0, 0, 0, 0, 0, 0, 1, 1000, 1000, HOUR, HOUR, DAY, 3 * DAY, INVITE_TTL_MS - 1, INVITE_TTL_MS, INVITE_TTL_MS + 1];

export type RawStep = {
  kind: (typeof KINDS)[number];
  a: number;
  b: number;
  c: number;
  role: HouseholdRole;
  name: string;
  advanceMs: number;
};

export const rawStepArb: fc.Arbitrary<RawStep> = fc.record({
  kind: fc.constantFrom(...KINDS),
  a: fc.nat(1000),
  b: fc.nat(1000),
  c: fc.nat(1000),
  role: roleArb,
  name: nameArb,
  advanceMs: fc.constantFrom(...STEPS),
});

const pick = <T>(list: readonly T[], ref: number, fallback: T): T => (list.length ? list[ref % list.length] : fallback);

/** Turns raw random numbers into operations that refer to ids that exist (or sometimes not). */
export function materialize(initial: ModelState, raws: readonly RawStep[]): Step[] {
  const households = initial.households.map((h) => h.id);
  const memberIds = initial.members.map((m) => m.id);
  const tokens = initial.invites.map((i) => i.token);
  const inviteIds = initial.invites.map((i) => i.id);
  const createdTokens: string[] = [];
  const createdInviteIds: string[] = [];
  const primaries = initial.members.filter((m) => m.role === "primary_caregiver" && m.isActive);
  const ownHousehold = new Map(initial.members.map((m) => [m.userId, m.householdId]));
  return raws.map((raw, i) => {
    // Most scenarios need an invite early, so accept and revoke have something to work on.
    const r: RawStep = i < 2 && raw.c % 2 === 0 ? { ...raw, kind: "create_invite" } : raw;
    const actorUserId =
      r.c % 2 === 0 && primaries.length > 0
        ? primaries[r.a % primaries.length].userId
        : r.c % 6 !== 0 && initial.members.length > 0
        ? initial.members[r.a % initial.members.length].userId
        : userUuid(r.a % USER_POOL);
    const householdId =
      r.c % 5 !== 0 && ownHousehold.has(actorUserId) ? ownHousehold.get(actorUserId)! : pick(households, r.b, householdUuid(0));
    const bogus = r.b % 10 === 0;
    const outsider = userUuid(12 + (r.a % (USER_POOL - 12)));
    const householdMembers = memberIds.filter((id) => initial.members.find((m) => m.id === id)?.householdId === householdId);
    let op: ModelOp;
    switch (r.kind) {
      case "create_invite": {
        const token = `tok-${i}`;
        op = { kind: "create_invite", householdId, actorUserId, role: r.role, inviteId: newInviteUuid(i), token };
        createdTokens.push(token);
        createdInviteIds.push(newInviteUuid(i));
        break;
      }
      case "accept_invite": {
        const token = bogus ? "unknown-token" : pick(r.b % 10 < 7 && createdTokens.length ? createdTokens : tokens, r.b, "unknown-token");
        op = { kind: "accept_invite", token, userId: r.c % 3 === 0 ? actorUserId : outsider, displayName: r.name, memberId: newMemberUuid(i) };
        memberIds.push(newMemberUuid(i));
        break;
      }
      case "revoke_invite":
        op = { kind: "revoke_invite", householdId, actorUserId, inviteId: bogus ? uuid(9999) : pick(r.b % 10 < 7 && createdInviteIds.length ? createdInviteIds : inviteIds, r.b, uuid(9999)) };
        break;
      case "preview_invite":
        op = { kind: "preview_invite", token: bogus ? "unknown-token" : pick(r.b % 10 < 7 && createdTokens.length ? createdTokens : tokens, r.b, "unknown-token") };
        break;
      case "list_invites":
        op = { kind: "list_invites", householdId, actorUserId };
        break;
      case "change_role":
        op = { kind: "change_role", householdId, actorUserId, memberId: pick(r.b % 4 === 0 ? memberIds : householdMembers, r.b, uuid(9998)), role: r.role };
        break;
      case "deactivate":
        op = { kind: "deactivate", householdId, actorUserId, memberId: pick(r.b % 4 === 0 ? memberIds : householdMembers, r.b, uuid(9998)) };
        break;
      case "leave":
        op = { kind: "leave", householdId, actorUserId };
        break;
      case "rename":
        op = { kind: "rename", householdId, actorUserId, displayName: r.name };
        break;
      case "create_household":
        op = {
          kind: "create_household",
          userId: actorUserId,
          householdName: r.name,
          displayName: r.name,
          householdId: newHouseholdUuid(i),
          memberId: newMemberUuid(i),
        };
        households.push(newHouseholdUuid(i));
        memberIds.push(newMemberUuid(i));
        break;
    }
    return { op, advanceMs: r.advanceMs };
  });
}

export type Scenario = { initial: ModelState; steps: Step[] };

/** A starting state and 1 to 30 operations. */
export function scenarioArb(options: StateOptions & { minLength?: number; maxLength?: number } = {}): fc.Arbitrary<Scenario> {
  return fc
    .tuple(stateArb(options), fc.array(rawStepArb, { minLength: options.minLength ?? 1, maxLength: options.maxLength ?? 30 }))
    .map(([initial, raws]) => ({ initial, steps: materialize(initial, raws) }));
}

export type TraceEntry = { before: ModelState; op: ModelOp; now: Date; after: ModelResult };

/** Runs every step; the clock advances by `advanceMs` before each operation. */
export function runScenario(sc: Scenario): TraceEntry[] {
  const trace: TraceEntry[] = [];
  let state = sc.initial;
  let now = T0;
  for (const step of sc.steps) {
    now = new Date(now.getTime() + step.advanceMs);
    const after = applyModel(state, step.op, now);
    trace.push({ before: state, op: step.op, now, after });
    state = after.state;
  }
  return trace;
}

export const finalState = (sc: Scenario): ModelState => {
  const t = runScenario(sc);
  return t.length ? t[t.length - 1].after.state : sc.initial;
};

export const activePrimaryCount = (s: ModelState, householdId: string): number =>
  s.members.filter((m) => m.householdId === householdId && m.isActive && m.role === "primary_caregiver").length;

export const RUNS = { numRuns: 150 };
