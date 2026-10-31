import assert from 'node:assert/strict';
import { once } from 'node:events';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { Store } from '../../src/db.js';
import { createApp } from '../../src/app.js';
import { seedTz } from '../../src/tz/seed.js';
import { seedMunicipal } from '../../src/municipal/data.js';
import type { postgresFixture } from './workflow-helpers.js';

/** Independent SQLite server over the same references and isolated test accounts, real HTTP only. */
export async function sqliteParity(t: TestContext, f: Awaited<ReturnType<typeof postgresFixture>>) {
  const store = new Store(join(f.dir, 'stage-e-parity.sqlite'));
  for (const row of (await f.db.pool.query('SELECT * FROM gp_cloud.users')).rows) {
    store.run('INSERT INTO v2_users VALUES (?,?,?,?,?,?,?,?,?)', row.id, row.login, row.display_name,
      row.role, row.active, row.password_hash, row.version, row.created_at, row.updated_at);
  }
  seedTz(store); await seedMunicipal(store);
  const server = createApp(store, { uploadsPath: join(f.dir, 'unused-sqlite-uploads') }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise<void>(done => server.close(() => done())); store.close(); });
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1`;
  const sessions = new Map<string, {cookie:string;csrf:string}>();
  async function request(path:string, method='GET', role='coordinator', body?:unknown, key='sqlite-stage-e') {
    let session = sessions.get(role);
    if (!session) {
      const res = await fetch(base + '/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:role,password:f.acceptancePassword})});
      assert.equal(res.status,200); const data = await res.json() as any;
      session = {cookie:res.headers.get('set-cookie')!.split(';')[0]!,csrf:data.data.csrfToken}; sessions.set(role,session);
    }
    const res = await fetch(base+path,{method,headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Idempotency-Key':key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:res.status,body:await res.json() as any};
  }
  return {store,request};
}
