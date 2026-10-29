import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, type Row } from '../db.js';
import { ApiError } from '../errors.js';
import { canonical } from '../service.js';

export const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const text = z.string().trim().min(1).max(4000);
export const shortText = z.string().trim().min(1).max(200);
export const version = z.number().int().positive();
export const timestamp = z.iso.datetime({ offset: true }).transform(s => new Date(s).toISOString());
export const expected = z.object({ expectedVersion: version }).strict();
// viewer = «Просмотр» по ТЗ: только чтение и расчёты без сохранения.
export const roles = z.enum(['admin','coordinator','viewer','foreman','worker']);
export type Role = z.infer<typeof roles>;
export type User = { id: string; displayName: string; role: Role; active: boolean; version: number };
export type Doc = Record<string, any> & { id: string; version: number };
export const now = () => new Date().toISOString();
export const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
export function fail(code: string, message: string, status = 409): never { throw new ApiError(status,code,message); }
export function allow(user: User, ...accepted: Role[]) { if (!accepted.includes(user.role)) fail('FORBIDDEN','This role cannot perform the operation',403); }
export function userDto(row: Row): User {
  return { id: String(row.id),displayName: String(row.display_name),role: row.role as Role,active: row.active===1,version: Number(row.version) };
}
export function getUser(s: Store, userId: string) { const row = s.get('SELECT * FROM v2_users WHERE id=?',userId); if (!row) fail('NOT_FOUND','User not found',404); return userDto(row!); }
export function fresh(s: Store, actor: User) {
  const current = getUser(s,actor.id);
  if (!current.active || current.role !== actor.role || current.version !== actor.version) fail('SESSION_REVOKED','Sign in again',401);
}
export function matchVersion(current: {version: number}, input: number) { if (current.version !== input) fail('VERSION_CONFLICT','Read the latest version and retry with a new key'); }
export function parseRow(row: Row | undefined, label = 'Object'): Doc {
  if (!row) fail('NOT_FOUND',`${label} not found`,404);
  return JSON.parse(String(row!.data)) as Doc;
}
export type Kind = 'plant'|'site'|'catalog'|'context'|'resource'|'care_policy'|'evidence'|'visualization'|'plan';
export function getDoc(s: Store, kind: Kind, objectId: string) { return parseRow(s.get('SELECT data FROM v2_documents WHERE kind=? AND id=?',kind,objectId),kind); }
export function maybeDoc(s: Store, kind: Kind, objectId: string) { const r=s.get('SELECT data FROM v2_documents WHERE kind=? AND id=?',kind,objectId); return r ? parseRow(r) : undefined; }
export function listDocs(s: Store, kind: Kind) { return s.all('SELECT data FROM v2_documents WHERE kind=? ORDER BY id',kind).map(r=>parseRow(r)); }
export function insertDoc(s: Store, kind: Kind, doc: Doc) { s.run('INSERT INTO v2_documents VALUES (?,?,?,?)',kind,doc.id,JSON.stringify(doc),doc.version); return doc; }
export function updateDoc(s: Store, kind: Kind, doc: Doc, previous: number) {
  if (s.run('UPDATE v2_documents SET data=?,version=? WHERE kind=? AND id=? AND version=?',JSON.stringify(doc),doc.version,kind,doc.id,previous).changes !== 1) fail('VERSION_CONFLICT','Object changed');
  return doc;
}
export function audit(s: Store, actor: User, type: string, objectId: string, action: string, before: unknown, after: unknown) {
  s.run('INSERT INTO v2_history VALUES (?,?,?,?,?,?,?,?)',randomUUID(),type,objectId,actor.id,action,before===null?null:JSON.stringify(before),JSON.stringify(after),now());
}
export function replay(s: Store, actor: User, method: string, path: string, key: string|undefined, body: unknown) {
  if (!key || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY','Supply Idempotency-Key',400);
  const old=s.get('SELECT * FROM v2_idempotency WHERE actor_id=? AND method=? AND path=? AND key=?',actor.id,method,path,key!);
  if (!old) return undefined;
  if (old.request_hash!==hash(body)) fail('IDEMPOTENCY_CONFLICT','Key already used with a different request');
  return { status:Number(old.response_status),body:JSON.parse(String(old.response_json)),replayed:true };
}
// Authorization is deliberately BEFORE replay, in the same transaction as the mutation.
export function mutate(s: Store, actor: User, method: string, path: string, key: string|undefined, body: unknown,
  status: number, authorize: ()=>void, change: ()=>unknown) {
  return s.transaction(()=>{
    fresh(s,actor); authorize();
    const old=replay(s,actor,method,path,key,body); if(old) return old;
    const result={data:change()};
    s.run('INSERT INTO v2_idempotency VALUES (?,?,?,?,?,?,?,?)',actor.id,method,path,key!,hash(body),status,JSON.stringify(result),now());
    return {status,body:result,replayed:false};
  });
}
export const interval = z.object({start:timestamp,end:timestamp}).strict().refine(x=>x.start<x.end,'start must precede end');
export const intervals = z.array(interval).max(60);
export const overlap = (a: {start:string;end:string},b:{start:string;end:string}) => a.start<b.end && b.start<a.end;
export const inside = (a: {start:string;end:string},b:{start:string;end:string}) => a.start>=b.start && a.end<=b.end;
export const uniqueIds = z.array(id).max(100).refine(xs=>new Set(xs).size===xs.length,'Duplicate IDs');
export function evidence(s: Store, ids: string[]) { for(const evidenceId of ids) getDoc(s,'evidence',evidenceId); }
