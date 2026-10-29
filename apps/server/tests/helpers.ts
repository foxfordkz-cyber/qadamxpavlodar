import assert from 'node:assert/strict';
import { type TestContext } from 'node:test';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createApp, type AppOptions } from '../src/app.js';
import { Store } from '../src/db.js';
import { seed } from '../src/seed.js';
import { buildOpenApi, routes, openapiPath } from '../src/contracts.js';

export const coordinator = 'demo-coordinator-1', w1 = 'demo-worker-1', w2 = 'demo-worker-2';
export async function fixture(t: TestContext, options: AppOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(),'green-pavlodar-integration-'));
  const store = new Store(join(dir,'test.sqlite')); seed(store);
  const uploads = join(dir,'uploads');
  const app = createApp(store,{ ...options, uploadsPath: uploads });
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const spec = buildOpenApi();
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validators = new Map<string, ReturnType<typeof ajv.compile>>();
  const covered = new Set<string>();
  function validate(route: string, method: string, status: number, body: unknown) {
    const [name, definition] = Object.entries(routes).find(([,r]) => r.method === method.toLowerCase() &&
      new RegExp('^' + r.path.replace(/:[a-z]+/g,'[^/]+') + '$').test(route.split('?')[0]!)) ?? [];
    if (!definition || !name) return;
    const operation = spec.paths[openapiPath(definition.path)]![definition.method] as any;
    const response = operation.responses[status];
    assert(response, `${method} ${route}: undocumented status ${status}`);
    const schema = response.content['application/json']?.schema;
    if (!schema) return;
    const key = `${name}:${status}`;
    if (!validators.has(key)) validators.set(key, ajv.compile({ ...schema, components: spec.components }));
    const validator = validators.get(key)!;
    assert(validator(body), `${key}: ${JSON.stringify(validator.errors)}`);
    covered.add(key);
  }
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((done,reject) => server.close(error => error ? reject(error) : done()));
    store.close();
    assert(resolve(dir).startsWith(resolve(tmpdir()) + sep) && dir.includes('green-pavlodar-integration-'));
    rmSync(dir,{recursive:true,force:true});
  });
  async function request(path: string, method = 'GET', user: string | null = coordinator, body?: unknown, key?: string) {
    const headers: Record<string,string> = {};
    if (user) headers['X-Demo-User'] = user;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (key) headers['Idempotency-Key'] = key;
    const response = await fetch(base+path,{method,headers,body:body === undefined ? undefined : JSON.stringify(body),signal:AbortSignal.timeout(5000)});
    const json = await response.json(); validate(path,method,response.status,json);
    return {status:response.status,body:json,headers:response.headers};
  }
  async function upload(reportId: string, bytes: Buffer, key: string, experimental = true, version?: number,
    user: string | null = w1, filename = '../../DEMO.png', mime = 'image/png') {
    const form = new FormData();
    form.set('file',new Blob([new Uint8Array(bytes)],{type:mime}),filename);
    if (version !== undefined) form.set('version',String(version));
    const path = `${experimental ? '/experimental' : ''}/reports/${reportId}/photos`;
    const response = await fetch(base+path,{method:'POST',headers:{...(user ? {'X-Demo-User':user}:{}),'Idempotency-Key':key},body:form,signal:AbortSignal.timeout(10000)});
    const json = await response.json(); validate(path,'POST',response.status,json);
    return {status:response.status,body:json,headers:response.headers};
  }
  async function submitted() {
    const created = await request('/experimental/tasks','POST',coordinator,{title:'DEMO isolated review',plantId:'demo-plant-1'},'exp-create');
    assert.equal(created.status,201);
    const id = created.body.data.id;
    const transition = (body: unknown,user: string,key: string) => request(`/experimental/tasks/${id}/transitions`,'POST',user,body,key);
    assert.equal((await transition({action:'assign',version:1,assignedToId:w1},coordinator,'assign')).status,200);
    assert.equal((await transition({action:'start',version:2},w1,'start')).status,200);
    const report = await request('/experimental/reports','POST',w1,{taskId:id,version:3,notes:'DEMO report revision 1'},'submit');
    assert.equal(report.status,201);
    return {taskId:id,reportId:report.body.data.id,version:4,transition};
  }
  return {app,store,dir,uploads,base,request,upload,submitted,validate,covered};
}
