import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { schema } from './schema.js';
import { migration2 } from './migrations.js';
import { migration4 } from './municipal/migration.js';
import { migration3 } from './v2/migration.js';

export type Row = Record<string, string | number | null>;
export function present(row: Row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), key === 'is_demo' ? value === 1 : value
  ]));
}
export class Store {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try {
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL;');
      this.transaction(() => {
        let version = this.get('PRAGMA user_version')?.user_version;
        if (version === 0) {
          this.db.exec(schema);
          this.db.exec('PRAGMA user_version=1;');
          version = 1;
        }
        if (version === 1) {
          this.db.exec(migration2);
          this.db.exec('PRAGMA user_version=2;');
          version = 2;
        }
        if (version === 2) {
          this.db.exec(migration3);
          this.db.exec('PRAGMA user_version=3;');
          version = 3;
        }
        if(version===3){this.db.exec(migration4);this.db.exec('PRAGMA user_version=4');version=4;}
        if (version !== 4) {
          throw new Error('Unsupported local schema version; do not reset or overwrite this database.');
        }
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  get(sql: string, ...params: SQLInputValue[]): Row | undefined {
    return this.db.prepare(sql).get(...params) as Row | undefined;
  }
  all(sql: string, ...params: SQLInputValue[]): Row[] {
    return this.db.prepare(sql).all(...params) as Row[];
  }
  run(sql: string, ...params: SQLInputValue[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() { this.db.close(); }
}
