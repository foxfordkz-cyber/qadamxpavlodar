import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store, present, type Row } from './db.js';
import { ApiError } from './errors.js';
import { type Actor, canonical, requireCoordinator, checkVersion, idempotent, lookupReplay } from './service.js';
import { experimentalCreate, newExperimentalTask } from './experimental-workflow.js';
import { id } from './validation.js';

export const snapshotVersion = z.string().regex(/^[0-9a-f]{64}$/);
export const aiRequest = z.object({ snapshotVersion }).strict();
export const aiConfirm = z.object({ version: z.number().int().positive(), snapshotVersion }).strict();
export const aiOutput = z.object({
  label: z.literal('DEMO'), snapshotVersion,
  reason: z.string().trim().min(1).max(1000),
  suggestedTask: z.object({ title: z.string().trim().min(1).max(200), plantId: id }).strict()
}).strict();

export function buildSnapshot(store: Store) {
  const plants = store.all('SELECT id,name,latitude,longitude,condition FROM plants ORDER BY id LIMIT 501').map(present);
  const candidateSites = store.all('SELECT id,name,latitude,longitude FROM candidate_sites ORDER BY id LIMIT 501').map(present);
  const tasks = store.all('SELECT id,plant_id,candidate_site_id,status,version FROM tasks ORDER BY id LIMIT 501').map(present);
  const experimentalTasks = store.all('SELECT id,plant_id,candidate_site_id,status,version FROM experimental_tasks ORDER BY id LIMIT 501').map(present);
  if ([plants,candidateSites,tasks,experimentalTasks].some(rows => rows.length > 500)) {
    throw new ApiError(409, 'SNAPSHOT_TOO_LARGE', 'Local mock snapshot supports at most 500 rows per collection');
  }
  const content = { schemaVersion: 'PROPOSED-v1', mode: 'DEMO', timezone: 'UTC+05:00', plants, candidateSites, tasks, experimentalTasks };
  return { ...content, version: createHash('sha256').update(canonical(content)).digest('hex'), generatedAt: new Date().toISOString() };
}
export type Snapshot = ReturnType<typeof buildSnapshot>;
// No Store, filesystem handle, token or mutation callback crosses this boundary.
export type AiAdapter = (snapshot: Readonly<Snapshot>) => Promise<unknown>;
export const mockAdapter: AiAdapter = async snapshot => {
  const plant = snapshot.plants.find(p => p.condition === 'needs_care') ?? snapshot.plants[0];
  if (!plant) throw new Error('No synthetic plants in snapshot');
  return { label: 'DEMO', snapshotVersion: snapshot.version, reason: 'DEMO deterministic rule: first plant needing care, otherwise first by id.',
    suggestedTask: { title: `DEMO AI: inspect ${plant.id}`, plantId: plant.id } };
};
function freezeDeep(value: unknown): void {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
}
function proposalDto(row: Row) {
  const { payloadJson, ...rest } = present(row);
  return { ...rest, proposal: JSON.parse(String(payloadJson)) as unknown, mode: 'DEMO', contract: 'PROPOSED' };
}
export async function propose(store: Store, actor: Actor, body: z.infer<typeof aiRequest>, key: string | undefined, adapter: AiAdapter) {
  requireCoordinator(actor);
  const path = '/experimental/ai/proposals';
  const cached = lookupReplay(store, actor, 'POST', path, key, body);
  if (cached) return cached;
  const snapshot = store.transaction(() => buildSnapshot(store));
  if (snapshot.version !== body.snapshotVersion) throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Fetch a fresh snapshot and use a new request key');
  freezeDeep(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let output: z.infer<typeof aiOutput>;
  try {
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Adapter timeout')), 1000); });
    output = aiOutput.parse(await Promise.race([adapter(snapshot), timeout]));
  } catch {
    throw new ApiError(503, 'AI_UNAVAILABLE', 'Mock adapter failed, timed out or returned invalid data; core APIs remain available');
  } finally { if (timer) clearTimeout(timer); }
  if (output.snapshotVersion !== snapshot.version || !snapshot.plants.some(p => p.id === output.suggestedTask.plantId)) {
    throw new ApiError(502, 'INVALID_AI_RESULT', 'Adapter referenced a different snapshot or unknown plant');
  }
  return idempotent(store, actor, 'POST', path, key, body, 201, () => {
    if (buildSnapshot(store).version !== snapshot.version) throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Data changed while the mock adapter was running');
    const proposalId = randomUUID();
    store.run("INSERT INTO ai_proposals VALUES (?,?,?,'draft',1,?,?,NULL,NULL)", proposalId, snapshot.version,
      JSON.stringify(output), actor.id, new Date().toISOString());
    return { data: proposalDto(store.get('SELECT * FROM ai_proposals WHERE id=?', proposalId)!) };
  });
}
export function confirmProposal(store: Store, actor: Actor, proposalId: string, body: z.infer<typeof aiConfirm>) {
  requireCoordinator(actor);
  const row = store.get('SELECT * FROM ai_proposals WHERE id=?', proposalId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'AI proposal not found');
  checkVersion(row, body.version);
  if (row.status !== 'draft') throw new ApiError(409, 'PROPOSAL_LOCKED', 'Proposal was already confirmed');
  if (row.snapshot_version !== body.snapshotVersion || buildSnapshot(store).version !== body.snapshotVersion) {
    throw new ApiError(409, 'SNAPSHOT_CONFLICT', 'Proposal is based on stale data; request a new proposal');
  }
  const proposal = aiOutput.parse(JSON.parse(String(row.payload_json)));
  const task = newExperimentalTask(store, actor, experimentalCreate.parse(proposal.suggestedTask));
  store.run("UPDATE ai_proposals SET status='confirmed',version=version+1,confirmed_task_id=?,confirmed_at=? WHERE id=?", String(task.data.id), new Date().toISOString(), proposalId);
  return { data: proposalDto(store.get('SELECT * FROM ai_proposals WHERE id=?', proposalId)!), task: task.data };
}
