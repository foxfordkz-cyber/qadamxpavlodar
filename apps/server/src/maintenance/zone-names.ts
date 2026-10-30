import type { DatabaseSync } from 'node:sqlite';
import type { Store } from '../db.js';
import { allow, fresh, hash, type Doc, type User } from '../v2/core.js';
import { patchData, sitePatch } from '../v2/data.js';
import { ZONE_NAME_CORRECTIONS } from './zone-name-manifest.js';

export function planZoneNames(db: DatabaseSync) {
  const changes = [];
  for (const [id, oldName, name] of ZONE_NAME_CORRECTIONS) {
    const row = db.prepare("SELECT data, version FROM v2_documents WHERE kind='site' AND id=?").get(id);
    if (!row) continue;
    const doc = JSON.parse(String(row.data)) as Doc;
    if (doc.name !== oldName) continue;
    if (doc.id !== id || doc.version !== row.version) throw new Error('Inconsistent site identity/version; repair separately');
    changes.push({ id, oldName, name, expectedVersion: doc.version });
  }
  return { changes, hash: hash(changes) };
}

/** Explicit offline maintenance; same validation, locking and history path as PATCH /sites/:id.
 * Caller must back up first. No HTTP route or automatic startup hook is added. */
export function applyZoneNames(store: Store, actor: User, expectedPlanHash: string) {
  return store.transaction(() => {
    fresh(store, actor);
    allow(actor, 'admin', 'coordinator');
    const plan = planZoneNames(store.db);
    if (plan.hash !== expectedPlanHash) throw new Error('Plan changed; run dry-run again and review it');
    for (const { id, name, expectedVersion } of plan.changes) {
      patchData(store, actor, 'site', id, sitePatch.parse({ name, expectedVersion }));
    }
    const integrity = store.get('PRAGMA integrity_check');
    if (integrity?.integrity_check !== 'ok' || store.all('PRAGMA foreign_key_check').length) {
      throw new Error('Database integrity check failed; transaction rolled back');
    }
    return { updated: plan.changes.length, ids: plan.changes.map(c => c.id) };
  });
}
