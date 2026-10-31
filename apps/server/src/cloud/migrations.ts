import { migration5 } from './outcomes-migration.js';
import { createHash } from 'node:crypto';
import { PostgresDatabase } from './database.js';
import { migration2 } from './planning-migration.js';
import { migration4 } from './photo-migration.js';
import { migration3 } from './workflow-migration.js';

// Deliberately private schema, not public/PostgREST. No application data is imported from SQLite.
export const migration1 = `
CREATE TABLE gp_cloud.users (
 id text PRIMARY KEY, login text NOT NULL UNIQUE CHECK(login=lower(login)), display_name text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','coordinator','foreman','worker','viewer')),
 active integer NOT NULL CHECK(active IN (0,1)), password_hash text NOT NULL,
 version integer NOT NULL CHECK(version>0), created_at text NOT NULL, updated_at text NOT NULL
);
CREATE TABLE gp_cloud.sessions (
 token_hash text PRIMARY KEY CHECK(length(token_hash)=64), user_id text NOT NULL REFERENCES gp_cloud.users(id),
 csrf_token text NOT NULL CHECK(length(csrf_token)=64), created_at text NOT NULL, expires_at text NOT NULL
);
CREATE INDEX sessions_user ON gp_cloud.sessions(user_id);
CREATE INDEX sessions_expiry ON gp_cloud.sessions(expires_at);
CREATE TABLE gp_cloud.login_attempts (key text PRIMARY KEY, count integer NOT NULL, reset_at bigint NOT NULL);
CREATE TABLE gp_cloud.documents (
 kind text NOT NULL CHECK(kind IN ('resource','evidence')), id text NOT NULL, data jsonb NOT NULL,
 version integer NOT NULL CHECK(version>0), PRIMARY KEY(kind,id),
 CHECK(jsonb_typeof(data)='object' AND data ? 'id' AND data ? 'version'),
 CHECK(data->>'id'=id), CHECK((data->>'version')::integer=version)
);
CREATE TABLE gp_cloud.evidence_links (
 resource_kind text NOT NULL DEFAULT 'resource' CHECK(resource_kind='resource'), resource_id text NOT NULL,
 evidence_kind text NOT NULL DEFAULT 'evidence' CHECK(evidence_kind='evidence'), evidence_id text NOT NULL,
 PRIMARY KEY(resource_id,evidence_id),
 FOREIGN KEY(resource_kind,resource_id) REFERENCES gp_cloud.documents(kind,id),
 FOREIGN KEY(evidence_kind,evidence_id) REFERENCES gp_cloud.documents(kind,id)
);
CREATE TABLE gp_cloud.history (
 id text PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL,
 actor_id text NOT NULL REFERENCES gp_cloud.users(id), action text NOT NULL,
 before_json jsonb, after_json jsonb NOT NULL, created_at text NOT NULL,
 FOREIGN KEY(entity_type,entity_id) REFERENCES gp_cloud.documents(kind,id)
);
CREATE INDEX history_entity ON gp_cloud.history(entity_type,entity_id);
CREATE TABLE gp_cloud.idempotency (
 actor_id text NOT NULL REFERENCES gp_cloud.users(id), method text NOT NULL, path text NOT NULL, key text NOT NULL,
 request_hash text NOT NULL, response_status integer NOT NULL, response_json jsonb NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(actor_id,method,path,key)
);
REVOKE ALL ON ALL TABLES IN SCHEMA gp_cloud FROM PUBLIC;
`;
export const migrations = [migration1, migration2, migration3, migration4, migration5] as const;
export const schemaVersion = migrations.length;
export async function migrate(db: PostgresDatabase) {
  if ((await db.pool.query('SHOW server_encoding')).rows[0].server_encoding !== 'UTF8')
    throw Error('Cloud database must use UTF8; existing database was not modified');
  const checksums = migrations.map(sql => createHash('sha256').update(sql).digest('hex'));
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(733112621)');
    await client.query('CREATE SCHEMA IF NOT EXISTS gp_cloud');
    await client.query('REVOKE ALL ON SCHEMA gp_cloud FROM PUBLIC');
    await client.query('CREATE TABLE IF NOT EXISTS gp_cloud.schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL)');
    const rows = (await client.query('SELECT * FROM gp_cloud.schema_migrations ORDER BY version')).rows;
    if (rows.some((r,i) => r.version !== i+1 || r.checksum !== checksums[i]))
      throw Error('Unknown or changed cloud migration; no data was reset');
    for (let i=rows.length;i<migrations.length;i++) {
      await client.query(migrations[i]!);
      await client.query('INSERT INTO gp_cloud.schema_migrations VALUES ($1,$2)', [i+1,checksums[i]]);
    }
  });
}
