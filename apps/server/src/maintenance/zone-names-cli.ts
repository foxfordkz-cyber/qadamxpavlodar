import { DatabaseSync, backup } from 'node:sqlite';
import { closeSync, existsSync, openSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Store } from '../db.js';
import { getUser } from '../v2/core.js';
import { applyZoneNames, planZoneNames } from './zone-names.js';

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, apply: { type: 'boolean', default: false },
    backup: { type: 'string' }, actor: { type: 'string' }, 'plan-hash': { type: 'string' },
  }, allowPositionals: false });
  if (!values.db || !existsSync(values.db)) throw new Error('--db must name an existing database');
  const source = realpathSync(values.db);
  const reader = new DatabaseSync(source, { readOnly: true });
  let plan;
  try {
    const version = Number(reader.prepare('PRAGMA user_version').get()?.user_version);
    if (![5, 6].includes(version)) throw new Error('Upgrade the database with the approved release first; this command only corrects names');
    if (reader.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
        reader.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database integrity check failed');
    plan = planZoneNames(reader);
    if (!values.apply) { console.log(JSON.stringify({ mode: 'dry-run', ...plan }, null, 2)); return; }
    if (!values.actor || !values.backup || values['plan-hash'] !== plan.hash) {
      throw new Error('--apply requires --actor, a NEW --backup path and the reviewed --plan-hash');
    }
    const target = resolve(values.backup);
    if (target === source) throw new Error('Backup must be a separate new file');
    // Reserve exclusively: neither existing backups nor symlinks can be overwritten.
    closeSync(openSync(target, 'wx', 0o600));
    await backup(reader, target);
    const saved = new DatabaseSync(target, { readOnly: true });
    try {
      if (saved.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
          saved.prepare('PRAGMA foreign_key_check').all().length || planZoneNames(saved).hash !== plan.hash) {
        throw new Error('Backup verification failed; source was not changed');
      }
    } finally { saved.close(); }
  } finally { reader.close(); }
  const store = new Store(source);
  try {
    console.log(JSON.stringify({ mode: 'apply', ...applyZoneNames(store, getUser(store, values.actor!), plan.hash) }));
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Zone name maintenance failed'); process.exitCode = 1; });
