import { randomUUID } from 'node:crypto';
import { fail, hash, matchVersion, now, userDto, type Doc } from '../v2/core.js';
import { newDocument, updatedDocument } from '../v2/data.js';
import { authorizeReference, type ReferenceKind, type ReferenceMutation, type ReferenceRepository } from '../v2/reference-data.js';
import { PostgresDatabase } from './database.js';

export class PostgresReferenceRepository implements ReferenceRepository {
  constructor(private readonly db: PostgresDatabase) {}
  async list(kind: ReferenceKind): Promise<Doc[]> {
    return (await this.db.pool.query('SELECT data FROM gp_cloud.documents WHERE kind=$1 ORDER BY id', [kind])).rows.map(r => r.data);
  }
  async mutate(input: ReferenceMutation) {
    const { actor, method, path, key, kind, body, id, status } = input;
    return this.db.transaction(async client => {
      // Serialize writes by actor, including duplicate keys; authorization always precedes replay.
      const row = (await client.query('SELECT * FROM gp_cloud.users WHERE id=$1 FOR UPDATE', [actor.id])).rows[0];
      if (!row) fail('SESSION_REVOKED', 'Sign in again', 401);
      const current = userDto(row);
      if (!current.active || current.version !== actor.version || current.role !== actor.role) fail('SESSION_REVOKED', 'Sign in again', 401);
      authorizeReference(current, kind);
      if (!key || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY', 'Supply Idempotency-Key', 400);
      const requestHash = hash(body);
      const old = (await client.query('SELECT * FROM gp_cloud.idempotency WHERE actor_id=$1 AND method=$2 AND path=$3 AND key=$4', [actor.id,method,path,key])).rows[0];
      if (old) {
        if (old.request_hash !== requestHash) fail('IDEMPOTENCY_CONFLICT', 'Key already used with a different request');
        return { status: old.response_status as number, body: old.response_json, replayed: true };
      }
      let before: Doc | null = null;
      if (id) {
        before = (await client.query('SELECT data FROM gp_cloud.documents WHERE kind=$1 AND id=$2 FOR UPDATE', [kind,id])).rows[0]?.data ?? null;
        if (!before) fail('NOT_FOUND', `${kind} not found`, 404);
        matchVersion(before, body.expectedVersion);
      }
      // Crews are intentionally not migrated in this first slice. Do not pretend a missing adapter is a missing record.
      if (body.ownerCrewId) fail('CLOUD_REFERENCE_UNSUPPORTED', 'Crew ownership requires the crew persistence adapter', 503);
      if (body.evidenceIds) for (const evidenceId of body.evidenceIds) {
        const found = (await client.query("SELECT id FROM gp_cloud.documents WHERE kind='evidence' AND id=$1", [evidenceId])).rows[0];
        if (!found) fail('NOT_FOUND', 'evidence not found', 404);
      }
      const { expectedVersion: _expectedVersion, ...patch } = body;
      const after = before ? updatedDocument(before, patch) : newDocument(kind, body);
      if (before) {
        const result = await client.query('UPDATE gp_cloud.documents SET data=$1,version=$2 WHERE kind=$3 AND id=$4 AND version=$5', [after,after.version,kind,after.id,before.version]);
        if (result.rowCount !== 1) fail('VERSION_CONFLICT', 'Object changed');
      } else await client.query('INSERT INTO gp_cloud.documents VALUES ($1,$2,$3,$4)', [kind,after.id,after,after.version]);
      if (kind === 'resource') {
        await client.query('DELETE FROM gp_cloud.evidence_links WHERE resource_id=$1', [after.id]);
        for (const evidenceId of after.evidenceIds) await client.query('INSERT INTO gp_cloud.evidence_links(resource_id,evidence_id) VALUES ($1,$2)', [after.id,evidenceId]);
      }
      await client.query('INSERT INTO gp_cloud.history VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [randomUUID(),kind,after.id,actor.id,before?'update':'create',before,after,now()]);
      const response = { data: after };
      await client.query('INSERT INTO gp_cloud.idempotency VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [actor.id,method,path,key,requestHash,status,response,now()]);
      return { status, body: response, replayed: false };
    });
  }
}
