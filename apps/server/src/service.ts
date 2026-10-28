import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, present, type Row } from './db.js';
import { ApiError } from './errors.js';
import { createTask, patchTask, createReport } from './validation.js';

export type Actor = { id: string; role: 'worker' | 'coordinator' };
export function requireCoordinator(actor: Actor) {
  if (actor.role !== 'coordinator') throw new ApiError(403, 'FORBIDDEN', 'Coordinator role required');
}
export function worker(store: Store, userId: string) {
  if (store.get('SELECT role FROM users WHERE id=?', userId)?.role !== 'worker') {
    throw new ApiError(422, 'INVALID_ASSIGNEE', 'Assignee must be an existing worker');
  }
}
export function task(store: Store, actor: Actor, taskId: string): Row {
  const found = store.get('SELECT * FROM tasks WHERE id=?', taskId);
  if (!found || (actor.role === 'worker' && found.assigned_to_id !== actor.id)) {
    throw new ApiError(404, 'NOT_FOUND', 'Task not found');
  }
  return found;
}
export function checkVersion(row: Row, version: number) {
  if (row.version !== version) throw new ApiError(409, 'VERSION_CONFLICT', 'Read the latest task version and retry with a new key');
}
function history(store: Store, actor: Actor, taskId: string, previous: string | null) {
  const current = store.get('SELECT * FROM tasks WHERE id=?', taskId)!;
  store.run('INSERT INTO task_history VALUES (?,?,?,?,?,?,?,?)',
    randomUUID(), taskId, actor.id, previous, current.status!, current.version!, JSON.stringify(present(current)), current.updated_at!);
  return present(current);
}
export function insertTask(store: Store, actor: Actor, body: z.infer<typeof createTask>) {
  requireCoordinator(actor);
  worker(store, body.assignedToId);
  if (body.plantId && !store.get('SELECT id FROM plants WHERE id=?', body.plantId)) {
    throw new ApiError(422, 'INVALID_REFERENCE', 'Plant does not exist');
  }
  if (body.candidateSiteId && !store.get('SELECT id FROM candidate_sites WHERE id=?', body.candidateSiteId)) {
    throw new ApiError(422, 'INVALID_REFERENCE', 'Candidate site does not exist');
  }
  const taskId = randomUUID();
  const now = new Date().toISOString();
  store.run(`INSERT INTO tasks (id,title,plant_id,candidate_site_id,assigned_to_id,created_by_id,status,version,created_at,updated_at,is_demo)
    VALUES (?,?,?,?,?,?,'pending',1,?,?,1)`, taskId, body.title, body.plantId ?? null, body.candidateSiteId ?? null,
    body.assignedToId, actor.id, now, now);
  return { data: history(store, actor, taskId, null) };
}
export function updateTask(store: Store, actor: Actor, taskId: string, body: z.infer<typeof patchTask>) {
  const current = task(store, actor, taskId);
  if (actor.role === 'worker' && (body.title !== undefined || body.assignedToId !== undefined || body.status !== 'in_progress')) {
    throw new ApiError(403, 'FORBIDDEN', 'Workers may only start their own pending task');
  }
  checkVersion(current, body.version);
  if (['completed', 'cancelled'].includes(String(current.status))) {
    throw new ApiError(409, 'TERMINAL_TASK', 'Terminal tasks cannot be changed in this draft workflow');
  }
  const next = body.status ?? String(current.status);
  const transitions: Record<string, string[]> = { pending: ['in_progress', 'cancelled'], in_progress: ['cancelled'] };
  if (next !== current.status && !transitions[String(current.status)]?.includes(next)) {
    throw new ApiError(409, 'INVALID_TRANSITION', 'This status transition is not allowed');
  }
  if (body.assignedToId !== undefined) {
    if (current.status !== 'pending') throw new ApiError(409, 'INVALID_REASSIGNMENT', 'Only pending tasks can be reassigned');
    worker(store, body.assignedToId);
  }
  const title = body.title ?? current.title!;
  const assignee = body.assignedToId ?? current.assigned_to_id!;
  if (title === current.title && assignee === current.assigned_to_id && next === current.status) {
    throw new ApiError(409, 'NO_CHANGE', 'The request makes no change');
  }
  const changed = store.run(`UPDATE tasks SET title=?, assigned_to_id=?, status=?, version=version+1, updated_at=?
    WHERE id=? AND version=?`, title, assignee, next, new Date().toISOString(), taskId, body.version);
  if (changed.changes !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Task changed concurrently');
  return { data: history(store, actor, taskId, String(current.status)) };
}
export function insertReport(store: Store, actor: Actor, body: z.infer<typeof createReport>) {
  const current = task(store, actor, body.taskId);
  // Keep coordinator review separate from worker authorship until contract is agreed.
  if (actor.role !== 'worker') throw new ApiError(403, 'FORBIDDEN', 'Only the assigned worker can submit a report');
  checkVersion(current, body.version);
  if (current.status !== 'in_progress') throw new ApiError(409, 'INVALID_TRANSITION', 'Start the task before submitting a report');
  const reportId = randomUUID();
  const now = new Date().toISOString();
  store.run('INSERT INTO reports (id,task_id,author_id,notes,created_at,is_demo) VALUES (?,?,?,?,?,1)',
    reportId, body.taskId, actor.id, body.notes, now);
  const changed = store.run(`UPDATE tasks SET status='completed', version=version+1, updated_at=? WHERE id=? AND version=?`,
    now, body.taskId, body.version);
  if (changed.changes !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Task changed concurrently');
  const updated = history(store, actor, body.taskId, String(current.status));
  return { data: present(store.get('SELECT * FROM reports WHERE id=?', reportId)!), task: updated };
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export function idempotent(store: Store, actor: Actor, method: string, path: string, key: string | undefined,
  body: unknown, status: number, mutate: () => unknown) {
  return store.transaction(() => {
    const prior = lookupReplay(store, actor, method, path, key, body);
    if (prior) return prior;
    const hash = createHash('sha256').update(canonical(body)).digest('hex');
    const response = mutate();
    store.run('INSERT INTO idempotency_keys VALUES (?,?,?,?,?,?,?,?)', actor.id, method, path, key!, hash, status,
      JSON.stringify(response), new Date().toISOString());
    return { status, body: response, replayed: false };
  });
}
export function lookupReplay(store: Store, actor: Actor, method: string, path: string, key: string | undefined, body: unknown) {
  if (!key || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(key)) {
    throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Supply an Idempotency-Key of 1–128 safe characters');
  }
  const hash = createHash('sha256').update(canonical(body)).digest('hex');
  const prior = store.get('SELECT * FROM idempotency_keys WHERE actor_id=? AND method=? AND path=? AND key=?', actor.id, method, path, key);
  if (!prior) return undefined;
  if (prior.request_hash !== hash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Key was already used with a different payload');
  return { status: Number(prior.response_status), body: JSON.parse(String(prior.response_json)) as unknown, replayed: true };
}
