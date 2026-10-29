import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, present, type Row } from './db.js';
import { ApiError } from './errors.js';
import { type Actor, requireCoordinator, worker, checkVersion } from './service.js';
import { id } from './validation.js';

export const experimentalCreate = z.object({
  title: z.string().trim().min(1).max(200), plantId: id.optional(), candidateSiteId: id.optional()
}).strict().refine(body => Number(!!body.plantId) + Number(!!body.candidateSiteId) === 1,
  { message: 'Provide exactly one target: plantId or candidateSiteId' });
const version = z.number().int().positive();
const comment = z.string().trim().min(1).max(2000);
export const experimentalTransition = z.discriminatedUnion('action', [
  z.object({ action: z.literal('assign'), version, assignedToId: id }).strict(),
  z.object({ action: z.literal('start'), version }).strict(),
  z.object({ action: z.literal('verify'), version, comment: comment.optional() }).strict(),
  z.object({ action: z.literal('return'), version, comment }).strict()
]);
export const experimentalSubmit = z.object({ taskId: id, version, notes: z.string().trim().min(1).max(4000) }).strict();

export function experimentalTask(store: Store, actor: Actor, taskId: string): Row {
  const row = store.get('SELECT * FROM experimental_tasks WHERE id=?', taskId);
  if (!row || (actor.role === 'worker' && row.assigned_to_id !== actor.id)) {
    throw new ApiError(404, 'NOT_FOUND', 'Experimental task not found');
  }
  return row;
}
export function experimentalHistory(store: Store, actor: Actor, taskId: string,
  from: string | null, action: string, comment: string | null = null) {
  const row = store.get('SELECT * FROM experimental_tasks WHERE id=?', taskId)!;
  store.run('INSERT INTO experimental_task_history VALUES (?,?,?,?,?,?,?,?,?,?)', randomUUID(), taskId,
    actor.id, from, row.status!, action, comment, row.version!, JSON.stringify(present(row)), row.updated_at!);
  return present(row);
}
export function newExperimentalTask(store: Store, actor: Actor, body: z.infer<typeof experimentalCreate>) {
  requireCoordinator(actor);
  if (body.plantId && !store.get('SELECT id FROM plants WHERE id=?', body.plantId)) {
    throw new ApiError(422, 'INVALID_REFERENCE', 'Plant does not exist');
  }
  if (body.candidateSiteId && !store.get('SELECT id FROM candidate_sites WHERE id=?', body.candidateSiteId)) {
    throw new ApiError(422, 'INVALID_REFERENCE', 'Candidate site does not exist');
  }
  const taskId = randomUUID();
  const now = new Date().toISOString();
  store.run(`INSERT INTO experimental_tasks VALUES (?,?,?,?,NULL,?,'draft',1,?,?,1)`,
    taskId, body.title, body.plantId ?? null, body.candidateSiteId ?? null, actor.id, now, now);
  return { data: experimentalHistory(store, actor, taskId, null, 'create') };
}
export function transitionExperimentalTask(store: Store, actor: Actor, taskId: string,
  body: z.infer<typeof experimentalTransition>) {
  const current = experimentalTask(store, actor, taskId);
  if (body.action === 'start') {
    if (actor.role !== 'worker') throw new ApiError(403, 'FORBIDDEN', 'Only the assigned worker can start');
  } else requireCoordinator(actor);
  checkVersion(current, body.version);
  const allowed = { assign: ['draft', 'assigned'], start: ['assigned'], verify: ['submitted'], return: ['submitted'] };
  if (!allowed[body.action].includes(String(current.status))) {
    throw new ApiError(409, 'INVALID_TRANSITION', 'Action is not allowed in the current experimental status');
  }
  let next: string;
  let assignee = current.assigned_to_id;
  if (body.action === 'assign') {
    worker(store, body.assignedToId);
    if (assignee === body.assignedToId && current.status === 'assigned') throw new ApiError(409, 'NO_CHANGE', 'Worker is already assigned');
    assignee = body.assignedToId; next = 'assigned';
  } else if (body.action === 'start') next = 'in_progress';
  else {
    next = body.action === 'verify' ? 'verified' : 'assigned';
    const report = store.get("SELECT * FROM experimental_reports WHERE task_id=? AND status='submitted' ORDER BY revision DESC LIMIT 1", taskId);
    if (!report) throw new ApiError(409, 'MISSING_REPORT', 'No submitted report is available');
    store.run('UPDATE experimental_reports SET status=?, review_comment=?, reviewed_by_id=?, reviewed_at=? WHERE id=?',
      body.action === 'verify' ? 'verified' : 'returned', body.comment ?? null, actor.id, new Date().toISOString(), report.id!);
  }
  const changed = store.run('UPDATE experimental_tasks SET status=?, assigned_to_id=?, version=version+1, updated_at=? WHERE id=? AND version=?',
    next, assignee!, new Date().toISOString(), taskId, body.version);
  if (changed.changes !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Experimental task changed concurrently');
  return { data: experimentalHistory(store, actor, taskId, String(current.status), body.action, 'comment' in body ? body.comment ?? null : null) };
}
export function submitExperimentalReport(store: Store, actor: Actor, body: z.infer<typeof experimentalSubmit>) {
  const current = experimentalTask(store, actor, body.taskId);
  if (actor.role !== 'worker') throw new ApiError(403, 'FORBIDDEN', 'Only the assigned worker can submit');
  checkVersion(current, body.version);
  if (current.status !== 'in_progress') throw new ApiError(409, 'INVALID_TRANSITION', 'Start or restart the assigned task before submitting');
  const reportId = randomUUID();
  const now = new Date().toISOString();
  const revision = Number(store.get('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM experimental_reports WHERE task_id=?', body.taskId)!.revision);
  store.run(`INSERT INTO experimental_reports VALUES (?,?,?,?,?,'submitted',NULL,NULL,NULL,?,1)`, reportId,
    body.taskId, actor.id, body.notes, revision, now);
  const changed = store.run("UPDATE experimental_tasks SET status='submitted', version=version+1, updated_at=? WHERE id=? AND version=?",
    now, body.taskId, body.version);
  if (changed.changes !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Experimental task changed concurrently');
  const updated = experimentalHistory(store, actor, body.taskId, String(current.status), 'submit');
  return { data: present(store.get('SELECT * FROM experimental_reports WHERE id=?', reportId)!), task: updated };
}
export function readHistory(store: Store, taskId: string, experimental = false) {
  const table = experimental ? 'experimental_task_history' : 'task_history';
  return store.all(`SELECT * FROM ${table} WHERE task_id=? ORDER BY version`, taskId).map(row => {
    const { snapshotJson, ...metadata } = present(row);
    return { ...metadata, snapshot: JSON.parse(String(snapshotJson)) as unknown };
  });
}
