import type { Row } from "../../db.js";
import type { Role } from "../core.js";
// Shared domain operations. Both SQLite and PostgreSQL execute this same workflow.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, roles, canonicalRole, shortText, timestamp, intervals, uniqueIds, version, now, allow, fail, userDto, parseRow, matchVersion, type User, type Doc } from "../core.js";
import { audit, getUser, getDoc } from "./core.js";
import { password } from "../auth.js";
import { profileInput, userCreate, userPatch, crewCreate, crewPatch, membershipInput } from "../people.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../flow.js";

export function* profile(s: FlowContext, userId: string): Flow<Doc | null> { const r = (yield* s.get('SELECT data FROM v2_profiles WHERE user_id=?', userId)); return r ? parseRow(r) : null; }

export function* saveProfile(s: FlowContext, userId: string, input: z.infer<typeof profileInput>): Flow<void> {
    const old = (yield* profile(s, userId));
    const p = { ...input, userId, version: (old?.version ?? 0) + 1 };
    (yield* s.run('INSERT INTO v2_profiles VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=excluded.version', userId, JSON.stringify(p), p.version));
}

export function* createUser(s: FlowContext, a: User, b: z.infer<typeof userCreate>, passwordHash: string): Flow<User> {
    allow(a, 'admin');
    if ((yield* s.get('SELECT id FROM v2_users WHERE login=? COLLATE NOCASE', b.login)))
        fail('LOGIN_EXISTS', 'Login is already in use');
    const role = canonicalRole(b.role), userId = randomUUID();
    (yield* s.run('INSERT INTO v2_users VALUES (?,?,?,?,1,?,1,?,?)', userId, b.login, b.displayName, role, passwordHash, now(), now()));
    if (role === 'viewer')
        (yield* s.run('INSERT INTO municipal_roles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role', userId, role));
    if (b.profile)
        (yield* saveProfile(s, userId, b.profile));
    const user = (yield* getUser(s, userId));
    (yield* audit(s, a, 'user', userId, 'create', null, user));
    return user;
}

export function* patchUser(s: FlowContext, a: User, userId: string, b: z.infer<typeof userPatch>, passwordHash?: string): Flow<{ displayName: string; role: "admin" | "coordinator" | "foreman" | "worker" | "viewer"; active: boolean; version: number; id: string; }> {
    allow(a, 'admin');
    const before = (yield* getUser(s, userId));
    matchVersion(before, b.expectedVersion);
    if (userId === a.id && (b.role !== undefined || b.active === false))
        fail('SELF_PRIVILEGE_CHANGE', 'Cannot change your own role or disable yourself', 403);
    if (b.role && b.role !== before.role && ((yield* s.get('SELECT id FROM v2_crews WHERE foreman_id=? AND active=1', userId)) || (yield* s.get('SELECT id FROM v2_memberships WHERE user_id=? AND active=1', userId))))
        fail('CREW_ROLE_IN_USE', 'Remove active crew responsibilities before changing role');
    const after = { ...before, displayName: b.displayName ?? before.displayName, role: canonicalRole(b.role ?? before.role), active: b.active ?? before.active, version: before.version + 1 };
    (yield* s.run('UPDATE v2_users SET display_name=?,role=?,active=?,version=?,password_hash=COALESCE(?,password_hash),updated_at=? WHERE id=?', after.displayName, after.role, after.active ? 1 : 0, after.version, passwordHash ?? null, now(), userId));
    if (b.role) {
        if (after.role === 'viewer')
            (yield* s.run('INSERT INTO municipal_roles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role', userId, after.role));
        else
            (yield* s.run('DELETE FROM municipal_roles WHERE user_id=?', userId));
    }
    if (b.profile)
        (yield* saveProfile(s, userId, b.profile));
    (yield* s.run('DELETE FROM v2_sessions WHERE user_id=?', userId));
    (yield* audit(s, a, 'user', userId, 'update', before, { ...after, profile: b.profile ? (yield* profile(s, userId)) : undefined, credentialsChanged: !!passwordHash }));
    return after;
}

export function* crew(s: FlowContext, crewId: string): Flow<Doc> { return parseRow((yield* s.get('SELECT data FROM v2_crews WHERE id=?', crewId)), 'Crew'); }

export function* isMember(s: FlowContext, crewId: string, userId: string, start = now(), end = start): Flow<boolean> {
    const c = (yield* crew(s, crewId));
    if (c.foremanId === userId)
        return true;
    return !!(yield* s.get('SELECT id FROM v2_memberships WHERE crew_id=? AND user_id=? AND active=1 AND valid_from<=? AND (valid_until IS NULL OR valid_until>=?)', crewId, userId, start, end));
}

export function* canCrew(s: FlowContext, a: User, c: Doc): Flow<boolean> { return a.role === 'admin' || a.role === 'coordinator' || a.role === 'specialist' || a.role === 'viewer' || (a.role === 'foreman' && c.foremanId === a.id) || (a.role === 'worker' && (yield* isMember(s, c.id, a.id))); }

export function* ownCrew(s: FlowContext, a: User, crewId: string): Flow<Doc> { const c = (yield* crew(s, crewId)); if (!(yield* canCrew(s, a, c)))
    fail('NOT_FOUND', 'Crew not found', 404); return c; }

export function* checkForeman(s: FlowContext, userId: string): Flow<void> { const u = (yield* getUser(s, userId)); if (!u.active || u.role !== 'foreman')
    fail('INVALID_FOREMAN', 'An active foreman is required', 400); }

export function* checkResources(s: FlowContext, ids: string[]): Flow<void> { for (const resourceId of ids)
    (yield* getDoc(s, 'resource', resourceId)); }

export function* persistCrew(s: FlowContext, c: Doc): Flow<void> { (yield* s.run('UPDATE v2_crews SET name=?,foreman_id=?,active=?,data=?,version=? WHERE id=?', c.name, c.foremanId, c.active ? 1 : 0, JSON.stringify(c), c.version, c.id)); }

export function* createCrew(s: FlowContext, a: User, b: z.infer<typeof crewCreate>): Flow<{ id: `${string}-${string}-${string}-${string}-${string}`; active: boolean; version: number; name: string; foremanId: string; resourceIds: string[]; }> {
    allow(a, 'admin');
    (yield* checkForeman(s, b.foremanId));
    (yield* checkResources(s, b.resourceIds));
    const c = { ...b, id: randomUUID(), active: true, version: 1 };
    (yield* s.run('INSERT INTO v2_crews VALUES (?,?,?,1,?,1)', c.id, c.name, c.foremanId, JSON.stringify(c)));
    (yield* audit(s, a, 'crew', c.id, 'create', null, c));
    return c;
}

export function* patchCrew(s: FlowContext, a: User, crewId: string, b: z.infer<typeof crewPatch>): Flow<{ version: number; name?: string | undefined; foremanId?: string | undefined; active?: boolean | undefined; resourceIds?: string[] | undefined; id: string; }> {
    allow(a, 'admin');
    const before = (yield* crew(s, crewId));
    matchVersion(before, b.expectedVersion);
    if (b.foremanId)
        (yield* checkForeman(s, b.foremanId));
    if (b.resourceIds)
        (yield* checkResources(s, b.resourceIds));
    const { expectedVersion, ...patch } = b;
    const after = { ...before, ...patch, version: before.version + 1 };
    (yield* persistCrew(s, after));
    (yield* audit(s, a, 'crew', crewId, 'update', before, after));
    return after;
}

export function* membership(s: FlowContext, a: User, crewId: string, b: z.infer<typeof membershipInput>): Flow<{ members: { id: string | number | null | undefined; crewId: string | number | null | undefined; userId: string | number | null | undefined; validFrom: string | number | null | undefined; validUntil: string | number | null | undefined; active: boolean; }[]; version: number; id: string; }> {
    allow(a, 'admin');
    const before = (yield* crew(s, crewId));
    matchVersion(before, b.expectedVersion);
    const u = (yield* getUser(s, b.userId));
    if (u.role !== 'worker' || !u.active)
        fail('INVALID_MEMBER', 'An active worker is required', 400);
    const at = now(), from = b.validFrom ?? at, until = b.validUntil ?? null;
    if (from > at || (until && until <= at) || (until && until <= from))
        fail('INVALID_MEMBERSHIP_INTERVAL', 'P0 membership must be effective now; end must follow start', 400);
    const existing = (yield* s.get('SELECT * FROM v2_memberships WHERE user_id=? AND active=1', u.id));
    if (b.active && existing)
        fail('ALREADY_MEMBER', 'Worker already has an active crew');
    if (!b.active && (!existing || existing.crew_id !== crewId))
        fail('NOT_MEMBER', 'No active membership in this crew');
    if (b.active)
        (yield* s.run('INSERT INTO v2_memberships VALUES (?,?,?,?,?,1)', randomUUID(), crewId, u.id, from, until));
    else
        (yield* s.run('UPDATE v2_memberships SET active=0,valid_until=? WHERE id=?', at, existing!.id!));
    const after = { ...before, version: before.version + 1 };
    (yield* persistCrew(s, after));
    (yield* audit(s, a, 'crew', crewId, b.active ? 'add_member' : 'remove_member', before, { ...after, userId: u.id, at }));
    return { ...after, members: (yield* members(s, crewId)) };
}

export function* members(s: FlowContext, crewId: string): Flow<{ id: string | number | null | undefined; crewId: string | number | null | undefined; userId: string | number | null | undefined; validFrom: string | number | null | undefined; validUntil: string | number | null | undefined; active: boolean; }[]> { return (yield* s.all('SELECT * FROM v2_memberships WHERE crew_id=? ORDER BY valid_from,id', crewId)).map(r => ({ id: r.id, crewId: r.crew_id, userId: r.user_id, validFrom: r.valid_from, validUntil: r.valid_until, active: r.active === 1 })); }

export function* listUsers(s: FlowContext, a: User): Flow<{ profile: Doc | null; id: string; displayName: string; role: Role; active: boolean; version: number; }[]> { allow(a, 'admin'); return (yield* flowMap((yield* s.all('SELECT u.*,r.role AS municipal_role FROM v2_users u LEFT JOIN municipal_roles r ON r.user_id=u.id ORDER BY u.id')), function* (r: Row): Flow<{ profile: Doc | null; id: string; displayName: string; role: Role; active: boolean; version: number; }> {
    return ({ ...userDto(r), profile: (yield* profile(s, String(r.id))) });
})); }

export function* workers(s: FlowContext, a: User): Flow<{ profile: Doc | null; id: string; displayName: string; role: Role; active: boolean; version: number; }[]> {
    return (yield* flowMap((yield* flowFilter((yield* s.all("SELECT * FROM v2_users WHERE role IN ('worker','foreman') ORDER BY id")).map(userDto), function* (u: User): Flow<boolean> {
        return a.role === 'admin' || a.role === 'coordinator' || a.role === 'specialist' || a.role === 'viewer' || u.id === a.id ||
            (a.role === 'foreman' && (yield* flowSome((yield* s.all('SELECT id FROM v2_crews WHERE foreman_id=? AND active=1', a.id)), function* (c: Row): Flow<boolean> {
                return (yield* isMember(s, String(c.id), u.id));
            })));
    })), function* (u: User): Flow<{ profile: Doc | null; id: string; displayName: string; role: Role; active: boolean; version: number; }> {
        return ({ ...u, profile: (yield* profile(s, u.id)) });
    }));
}
