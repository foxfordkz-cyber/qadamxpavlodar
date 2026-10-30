import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/db.js';
import { seedV2 } from '../src/v2/seed.js';
import { seedTz, siteToV2 } from '../src/tz/seed.js';
import { web } from '../src/tz/shared.js';
import { getDoc, getUser, insertDoc, listDocs } from '../src/v2/core.js';
import { patchData } from '../src/v2/data.js';
import { applyZoneNames, planZoneNames } from '../src/maintenance/zone-names.js';
import { ZONE_NAME_CORRECTIONS } from '../src/maintenance/zone-name-manifest.js';

const target = 'site-osm-1569993037';
async function oldDatabase() {
  const dir = mkdtempSync(join(tmpdir(), 'gp-zone-name-test-')), file = join(dir, 'old.sqlite');
  const store = new Store(file);
  await seedV2(store);
  const mock = web.seed();
  for (const [id, oldName] of ZONE_NAME_CORRECTIONS) {
    const site = mock.sites.find((x: any) => x.id === id);
    assert(site);
    insertDoc(store, 'site', siteToV2({ ...site, name: oldName }, '2026-10-27T00:00:00Z'));
  }
  return { dir, file, store, actor: getUser(store, 'demo-coordinator-1') };
}
const stable = ({ name: _name, version: _version, updatedAt: _at, ...doc }: Record<string, any>) => doc;
const tables = ['v2_designs', 'v2_design_revisions', 'v2_tasks', 'v2_reports'];
const refs = (s: Store) => tables.map(table => s.all('SELECT * FROM ' + table));

test('old persisted seed names: exact correction, preservation and repeat execution', async t => {
  const f = await oldDatabase(); t.after(() => f.store.close());
  const [already, custom, ...rest] = ZONE_NAME_CORRECTIONS.filter(([id]) => id !== target);
  assert(already && custom && rest.length);
  patchData(f.store, f.actor, 'site', already[0], { name: already[2], expectedVersion: getDoc(f.store, 'site', already[0]).version });
  patchData(f.store, f.actor, 'site', custom[0], { name: 'Название владельца', expectedVersion: getDoc(f.store, 'site', custom[0]).version });
  const other = { ...getDoc(f.store, 'site', target), id: 'user-private-zone', name: 'Газон у улица Толстого', version: 7 };
  insertDoc(f.store, 'site', other);
  // Stored references and immutable historical snapshots, including real SQL foreign keys.
  f.store.run("INSERT INTO v2_designs VALUES ('name-design',?,1,'draft',1,?)", target, JSON.stringify({ id: 'name-design', siteId: target, siteVersion: 2, version: 1 }));
  f.store.run("INSERT INTO v2_design_revisions VALUES ('name-design',1,'draft',?)", JSON.stringify({ siteId: target, siteName: other.name }));
  f.store.run("INSERT INTO v2_tasks VALUES ('name-task','submitted',NULL,'name-design',1,1,?)", JSON.stringify({ id: 'name-task', objectId: target, objectType: 'candidate_site', designId: 'name-design', version: 1 }));
  f.store.run("INSERT INTO v2_reports VALUES ('name-report','name-task',1,'demo-worker-1','pending',1,?)", JSON.stringify({ id: 'name-report', taskId: 'name-task', siteId: target, version: 1 }));

  const before = listDocs(f.store, 'site'), history = f.store.all('SELECT * FROM v2_history ORDER BY id'), references = refs(f.store);
  await t.test('1 old name persists on repeat seed and is corrected only by maintenance', () => {
    seedTz(f.store);
    assert.equal(getDoc(f.store, 'site', target).name, 'Газон у улица Толстого');
    assert.deepEqual(listDocs(f.store, 'site'), before);
    const plan = planZoneNames(f.store.db);
    assert.equal(plan.changes.length, 112);
    assert.equal(applyZoneNames(f.store, f.actor, plan.hash).updated, 112);
    assert.equal(getDoc(f.store, 'site', target).name, 'Газон, улица Толстого');
  });
  await t.test('2 already corrected record stays byte-equivalent', () => {
    assert.deepEqual(getDoc(f.store, 'site', already[0]), before.find(s => s.id === already[0]));
  });
  await t.test('3 user rename is preserved', () => {
    assert.deepEqual(getDoc(f.store, 'site', custom[0]), before.find(s => s.id === custom[0]));
  });
  await t.test('4 unrelated IDs are never matched by name alone', () => {
    assert.deepEqual(getDoc(f.store, 'site', other.id), other);
    for (const doc of before.filter(d => !ZONE_NAME_CORRECTIONS.some(([id]) => id === d.id))) assert.deepEqual(getDoc(f.store, 'site', doc.id), doc);
  });
  await t.test('5 IDs, geometry, parameters and checks are unchanged', () => {
    const after = listDocs(f.store, 'site'); assert.deepEqual(after.map(d => d.id), before.map(d => d.id));
    for (const doc of before) assert.deepEqual(stable(getDoc(f.store, 'site', doc.id)), stable(doc));
  });
  await t.test('6 each correction increments version once and appends full audit history', () => {
    for (const old of before) {
      const after = getDoc(f.store, 'site', old.id), changed = old.name !== after.name;
      assert.equal(after.version, old.version + Number(changed));
      assert.equal(f.store.get("SELECT version FROM v2_documents WHERE kind='site' AND id=?", old.id)?.version, after.version);
      if (changed) {
        const entries = f.store.all("SELECT * FROM v2_history WHERE entity_type='site' AND entity_id=?", old.id);
        assert.equal(entries.length, 1); assert.deepEqual(JSON.parse(String(entries[0]!.before_json)), old);
        assert.deepEqual(JSON.parse(String(entries[0]!.after_json)), after);
        assert.equal(entries[0]!.actor_id, f.actor.id);
      }
    }
    for (const h of history) assert.deepEqual(f.store.get('SELECT * FROM v2_history WHERE id=?', h.id!), h);
  });
  await t.test('7 repeat maintenance and repeat seed are no-ops for corrected records and history', () => {
    const after = listDocs(f.store, 'site'), h = f.store.all('SELECT * FROM v2_history ORDER BY id');
    assert.equal(applyZoneNames(f.store, f.actor, planZoneNames(f.store.db).hash).updated, 0);
    seedTz(f.store);
    assert.deepEqual(listDocs(f.store, 'site'), after);
    assert.deepEqual(f.store.all('SELECT * FROM v2_history ORDER BY id'), h);
  });
  await t.test('8 projects, immutable revisions, tasks and reports keep all references/content', () => assert.deepEqual(refs(f.store), references));
  await t.test('9 SQLite integrity and foreign keys stay valid', () => {
    assert.equal(f.store.get('PRAGMA integrity_check')?.integrity_check, 'ok');
    assert.deepEqual(f.store.all('PRAGMA foreign_key_check'), []);
    assert.equal(f.store.get('PRAGMA foreign_keys')?.foreign_keys, 1);
  });
});

test('stale plan and unauthorized/inactive actors cannot change names', async t => {
  const f = await oldDatabase(); t.after(() => f.store.close());
  const plan = planZoneNames(f.store.db);
  for (const login of ['viewer', 'worker1']) {
    const row = f.store.get('SELECT id FROM v2_users WHERE login=?', login)!;
    assert.throws(() => applyZoneNames(f.store, getUser(f.store, String(row.id)), plan.hash), /role/);
  }
  assert.throws(() => applyZoneNames(f.store, { ...f.actor, version: f.actor.version + 1 }, plan.hash), /Sign in/);
  patchData(f.store, f.actor, 'site', target, { name: 'Reviewed user rename', expectedVersion: getDoc(f.store, 'site', target).version });
  const snapshot = listDocs(f.store, 'site');
  assert.throws(() => applyZoneNames(f.store, f.actor, plan.hash), /Plan changed/);
  assert.deepEqual(listDocs(f.store, 'site'), snapshot);
});

test('failure rolls back earlier corrections and their history atomically', async t => {
  const f = await oldDatabase(); t.after(() => f.store.close());
  const bad = ZONE_NAME_CORRECTIONS.at(-1)![0];
  f.store.db.exec("CREATE TRIGGER deny_test_name BEFORE UPDATE ON v2_documents WHEN NEW.id='" + bad + "' BEGIN SELECT RAISE(ABORT,'test injected failure'); END");
  const before = listDocs(f.store, 'site'), h = f.store.all('SELECT * FROM v2_history');
  assert.throws(() => applyZoneNames(f.store, f.actor, planZoneNames(f.store.db).hash), /test injected/);
  assert.deepEqual(listDocs(f.store, 'site'), before); assert.deepEqual(f.store.all('SELECT * FROM v2_history'), h);
});

test('CLI dry-run, reviewed plan, exclusive verified backup, restart and repeat apply', async () => {
  const f = await oldDatabase(), before = listDocs(f.store, 'site'); f.store.close();
  const script = resolve('src/maintenance/zone-names-cli.ts');
  const cli = (...args: string[]) => execFileSync(process.execPath, ['--import', 'tsx', script, '--db', f.file, ...args], { encoding: 'utf8', stdio: 'pipe' });
  const bytes = readFileSync(f.file), plan = JSON.parse(cli());
  assert.equal(plan.mode, 'dry-run'); assert.equal(plan.changes.length, 114); assert.deepEqual(readFileSync(f.file), bytes);
  assert.throws(() => cli('--apply', '--actor', f.actor.id, '--plan-hash', plan.hash));
  const saved = join(f.dir, 'before.sqlite');
  const result = JSON.parse(cli('--apply', '--actor', f.actor.id, '--plan-hash', plan.hash, '--backup', saved));
  assert.equal(result.updated, 114);
  const db = new DatabaseSync(saved, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.deepEqual(db.prepare("SELECT data FROM v2_documents WHERE kind='site' ORDER BY id").all().map(r => JSON.parse(String(r.data))), before);
  } finally { db.close(); }
  const reopened = new Store(f.file);
  try { assert.equal(getDoc(reopened, 'site', target).name, 'Газон, улица Толстого'); } finally { reopened.close(); }
  const empty = JSON.parse(cli()); assert.equal(empty.changes.length, 0);
  const backupBytes = readFileSync(saved);
  assert.throws(() => cli('--apply', '--actor', f.actor.id, '--plan-hash', empty.hash, '--backup', saved));
  assert.deepEqual(readFileSync(saved), backupBytes);
  assert.equal(JSON.parse(cli('--apply', '--actor', f.actor.id, '--plan-hash', empty.hash, '--backup', join(f.dir, 'repeat.sqlite'))).updated, 0);
});
