import pg, { type PoolClient, type PoolConfig } from 'pg';
import { ApiError } from '../errors.js';
import { schemaVersion } from './migrations.js';

export class PostgresDatabase {
  readonly pool: pg.Pool;
  constructor(config: PoolConfig) {
    this.pool = new pg.Pool({ max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
      statement_timeout: 10000, application_name: 'green-pavlodar-cloud-demo', ...config });
    // Never log driver errors: they can contain connection strings or SQL parameter values.
    this.pool.on('error', () => console.error('PostgreSQL idle connection unavailable'));
  }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '5s'");
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { broken = true; }
      throw error;
    } finally { client.release(broken); }
  }
  async ready() {
    const result=await this.pool.query('SELECT version FROM gp_cloud.schema_migrations ORDER BY version');
    if(result.rowCount!==schemaVersion||result.rows.some((r,i)=>r.version!==i+1))throw unavailable();
  }
  async close() { await this.pool.end(); }
}
export function unavailable() { return new ApiError(503, 'DATABASE_UNAVAILABLE', 'Persistent database unavailable; retry with the same idempotency key'); }
