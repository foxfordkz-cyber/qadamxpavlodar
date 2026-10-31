import { createHash } from 'node:crypto';
import { cloudConfig } from './config.js';
import { PostgresDatabase } from './database.js';
import { migrations } from './migrations.js';
import { SupabasePrivateStorage } from './private-storage.js';

export type DeploymentCheckMode = 'config' | 'before-migrations' | 'ready';
export class DeploymentCheckFailure extends Error {
  constructor(readonly stage: string) { super('Deployment check failed; credentials and provider details redacted'); }
}

// Operator preflight only: never migrates, seeds, uploads, deletes, or repairs data.
export async function checkDeployment(env: NodeJS.ProcessEnv, mode: DeploymentCheckMode, allowLocalTest = false) {
  let stage = 'configuration';
  let db: PostgresDatabase | undefined;
  try {
    const config = cloudConfig(env);
    if (config.localTest && !allowLocalTest) throw Error('Production check requires TLS');
    if (!config.storage) throw Error('Release requires private storage');
    const storage = new SupabasePrivateStorage(config.storage);
    const result = {
      result: 'PASS', environment: config.localTest ? 'local-test' : 'production-configuration',
      mode, database: 'NOT RUN', migrations: 'NOT RUN', privateStorage: 'NOT RUN',
      renderHttpsWorkflow: 'NOT RUN', appliedVersions: [] as number[],
    };
    if (mode === 'config') return result;
    stage = 'database';
    db = new PostgresDatabase(config.database);
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '10s'");
      if ((await client.query('SHOW server_encoding')).rows[0].server_encoding !== 'UTF8')
        throw Error('Database must use UTF8');
      result.database = 'PASS';
      stage = 'migration-checksums';
      const present = (await client.query("SELECT to_regclass('gp_cloud.schema_migrations') AS name")).rows[0].name;
      const rows: {version: number; checksum: string}[] = present
        ? (await client.query('SELECT version, checksum FROM gp_cloud.schema_migrations ORDER BY version')).rows : [];
      const checksums = migrations.map(sql => createHash('sha256').update(sql).digest('hex'));
      if (rows.some((r, i) => r.version !== i + 1 || r.checksum !== checksums[i]) ||
          (mode === 'ready' && rows.length !== migrations.length)) throw Error('Migration mismatch');
      result.appliedVersions = rows.map(r => r.version);
      result.migrations = rows.length === migrations.length ? 'PASS' : 'PENDING';
      stage = 'schema-exposure';
      if (present) {
        const exposed = await client.query(`SELECT rolname FROM pg_roles
          WHERE rolname IN ('anon','authenticated')
          AND has_schema_privilege(oid, 'gp_cloud', 'USAGE')`);
        if (exposed.rowCount) throw Error('Application schema must not be exposed to client roles');
      }
    } finally {
      let broken = false;
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      client.release(broken);
    }
    stage = 'private-storage';
    await storage.verifyPrivateBucket();
    result.privateStorage = 'PASS';
    return result;
  } catch {
    throw new DeploymentCheckFailure(stage);
  } finally {
    if (db) await db.close();
  }
}
