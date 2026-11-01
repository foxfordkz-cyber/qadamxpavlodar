import type { Row } from '../db.js';
import { fail, userDto } from '../v2/core.js';
import { unchangedCredentials, type AuthRepository, type NewSession } from '../v2/auth-repository.js';
import { PostgresDatabase } from './database.js';

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: PostgresDatabase) {}
  async session(tokenHash: string, at: string): Promise<Row | undefined> {
    return (await this.db.pool.query(`SELECT u.*,s.csrf_token,s.token_hash,s.expires_at FROM gp_cloud.sessions s
      JOIN gp_cloud.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND u.active=1`, [tokenHash, at])).rows[0];
  }
  async attempts(buckets: { key: string; limit: number }[], at: number) {
    await this.db.transaction(async client => {
      // Global ordering avoids IP/account lock inversion between concurrent requests.
      for (const { key, limit } of [...buckets].sort((a,b) => a.key.localeCompare(b.key))) {
        await client.query('INSERT INTO gp_cloud.login_attempts VALUES ($1,0,$2) ON CONFLICT DO NOTHING', [key, at + 900_000]);
        const row = (await client.query('SELECT * FROM gp_cloud.login_attempts WHERE key=$1 FOR UPDATE', [key])).rows[0];
        if (Number(row.reset_at) > at && row.count >= limit) fail('LOGIN_RATE_LIMIT', 'Too many attempts; retry in 15 minutes', 429);
        await client.query('UPDATE gp_cloud.login_attempts SET count=$2,reset_at=$3 WHERE key=$1',
          [key, Number(row.reset_at) <= at ? 1 : row.count + 1, Number(row.reset_at) <= at ? at + 900_000 : row.reset_at]);
      }
    });
  }
  async credentials(login: string): Promise<Row | undefined> {
    return (await this.db.pool.query('SELECT * FROM gp_cloud.users WHERE login=$1', [login])).rows[0];
  }
  async finishLogin(previous: Row, oldHash: string | undefined, next: NewSession) {
    return this.db.transaction(async client => {
      const current = (await client.query('SELECT * FROM gp_cloud.users WHERE id=$1 FOR UPDATE', [previous.id])).rows[0];
      unchangedCredentials(current, previous);
      if (oldHash) await client.query('DELETE FROM gp_cloud.sessions WHERE token_hash=$1', [oldHash]);
      await client.query('DELETE FROM gp_cloud.sessions WHERE expires_at<=$1', [next.createdAt]);
      await client.query('DELETE FROM gp_cloud.login_attempts WHERE reset_at<=$1', [next.at]);
      await client.query('INSERT INTO gp_cloud.sessions VALUES ($1,$2,$3,$4,$5)', [next.tokenHash,current.id,next.csrf,next.createdAt,next.expiresAt]);
      return userDto(current);
    });
  }
  async logout(tokenHash: string) { await this.db.pool.query('DELETE FROM gp_cloud.sessions WHERE token_hash=$1', [tokenHash]); }
}
