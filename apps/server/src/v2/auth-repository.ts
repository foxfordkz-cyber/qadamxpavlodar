import type { Row } from '../db.js';
import { Store } from '../db.js';
import { fail, getUser, now, type User } from './core.js';

export type NewSession = { tokenHash: string; csrf: string; createdAt: string; expiresAt: string; at: number };
// Each operation is a complete unit of work. SQLite never receives an async transaction callback.
export interface AuthRepository {
  session(tokenHash: string, at: string): Promise<Row | undefined>;
  attempts(buckets: { key: string; limit: number }[], at: number): Promise<void>;
  credentials(login: string): Promise<Row | undefined>;
  finishLogin(previous: Row, oldHash: string | undefined, next: NewSession): Promise<User>;
  logout(tokenHash: string): Promise<void>;
}
export function unchangedCredentials(current: Row | undefined, previous: Row): asserts current is Row {
  if (!current || current.active !== 1 || current.version !== previous.version || current.password_hash !== previous.password_hash)
    fail('INVALID_CREDENTIALS', 'Invalid login or password', 401);
}
export class SqliteAuthRepository implements AuthRepository {
  constructor(private readonly s: Store) {}
  async session(tokenHash: string, at: string) {
    return this.s.get(`SELECT u.*,r.role AS municipal_role,s.csrf_token,s.token_hash,s.expires_at FROM v2_sessions s
      JOIN v2_users u ON u.id=s.user_id LEFT JOIN municipal_roles r ON r.user_id=u.id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`, tokenHash, at);
  }
  async attempts(buckets: { key: string; limit: number }[], at: number) {
    this.s.transaction(() => {
      for (const { key, limit } of buckets) {
        const row = this.s.get('SELECT * FROM v2_login_attempts WHERE key=?', key);
        if (row && Number(row.reset_at) > at && Number(row.count) >= limit)
          fail('LOGIN_RATE_LIMIT', 'Too many attempts; retry in 15 minutes', 429);
        this.s.run(`INSERT INTO v2_login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
          reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END`, key, at + 900_000, at, at);
      }
    });
  }
  async credentials(login: string) { return this.s.get('SELECT * FROM v2_users WHERE login=? COLLATE NOCASE', login); }
  async finishLogin(previous: Row, oldHash: string | undefined, next: NewSession) {
    return this.s.transaction(() => {
      const current = this.s.get('SELECT * FROM v2_users WHERE id=?', previous.id!);
      unchangedCredentials(current, previous);
      if (oldHash) this.s.run('DELETE FROM v2_sessions WHERE token_hash=?', oldHash);
      this.s.run('DELETE FROM v2_sessions WHERE expires_at<=?', now());
      this.s.run('DELETE FROM v2_login_attempts WHERE reset_at<=?', next.at);
      this.s.run('INSERT INTO v2_sessions VALUES (?,?,?,?,?)', next.tokenHash, current.id!, next.csrf, next.createdAt, next.expiresAt);
      return getUser(this.s, String(current.id));
    });
  }
  async logout(tokenHash: string) { this.s.run('DELETE FROM v2_sessions WHERE token_hash=?', tokenHash); }
}
export const authRepository = (s: Store | AuthRepository): AuthRepository => s instanceof Store ? new SqliteAuthRepository(s) : s;
