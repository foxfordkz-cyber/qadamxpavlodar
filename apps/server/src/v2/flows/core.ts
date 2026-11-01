// Shared domain operations. Both SQLite and PostgreSQL execute this same workflow.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { type Row } from "../../db.js";
import { ApiError } from "../../errors.js";
import { canonical } from "../../service.js";
import { id, text, shortText, version, timestamp, expected, roles, type Role, canonicalRole, type User, type Doc, now, hash, fail, allow, userDto, matchVersion, parseRow, type Kind, replay, mutate, interval, intervals, overlap, inside, uniqueIds } from "../core.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../flow.js";

export function* getUser(s: FlowContext, userId: string): Flow<User> { const row = (yield* s.get('SELECT u.*,r.role AS municipal_role FROM v2_users u LEFT JOIN municipal_roles r ON r.user_id=u.id WHERE u.id=?', userId)); if (!row)
    fail('NOT_FOUND', 'User not found', 404); return userDto(row!); }

export function* fresh(s: FlowContext, actor: User): Flow<void> {
    const current = (yield* getUser(s, actor.id));
    if (!current.active || current.role !== actor.role || current.version !== actor.version)
        fail('SESSION_REVOKED', 'Sign in again', 401);
}

export function* getDoc(s: FlowContext, kind: Kind, objectId: string): Flow<Doc> { return parseRow((yield* s.get('SELECT data FROM v2_documents WHERE kind=? AND id=?', kind, objectId)), kind); }

export function* maybeDoc(s: FlowContext, kind: Kind, objectId: string): Flow<Doc | undefined> { const r = (yield* s.get('SELECT data FROM v2_documents WHERE kind=? AND id=?', kind, objectId)); return r ? parseRow(r) : undefined; }

export function* listDocs(s: FlowContext, kind: Kind): Flow<Doc[]> { return (yield* s.all('SELECT data FROM v2_documents WHERE kind=? ORDER BY id', kind)).map(r => parseRow(r)); }

export function* insertDoc(s: FlowContext, kind: Kind, doc: Doc): Flow<Doc> { (yield* s.run('INSERT INTO v2_documents VALUES (?,?,?,?)', kind, doc.id, JSON.stringify(doc), doc.version)); return doc; }

export function* updateDoc(s: FlowContext, kind: Kind, doc: Doc, previous: number): Flow<Doc> {
    if ((yield* s.run('UPDATE v2_documents SET data=?,version=? WHERE kind=? AND id=? AND version=?', JSON.stringify(doc), doc.version, kind, doc.id, previous)).changes !== 1)
        fail('VERSION_CONFLICT', 'Object changed');
    return doc;
}

export function* audit(s: FlowContext, actor: User, type: string, objectId: string, action: string, before: unknown, after: unknown): Flow<void> {
    (yield* s.run('INSERT INTO v2_history VALUES (?,?,?,?,?,?,?,?)', randomUUID(), type, objectId, actor.id, action, before === null ? null : JSON.stringify(before), JSON.stringify(after), now()));
}

export function* evidence(s: FlowContext, ids: string[]): Flow<void> { for (const evidenceId of ids)
    (yield* getDoc(s, 'evidence', evidenceId)); }
