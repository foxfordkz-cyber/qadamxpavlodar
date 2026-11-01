// Operator/QA process preflight. Only login/logout mutate server sessions.
// No task writes, replay POSTs, seed, provider control or secret output.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const origins = ['https://green-pavlodar-api.pages.dev', 'https://green-pavlodar-api-demo.onrender.com'];
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = v => createHash('sha256').update(Buffer.isBuffer(v) ? v : JSON.stringify(canonical(v))).digest('hex');
export async function checkQaAccess(env, manifest, fetcher = fetch) {
  let stage = 'configuration';
  const sessions = [], checks = [];
  const require = condition => { if (!condition) throw Error('Check failed'); };
  const origin = env.CLOUD_ACCEPTANCE_ORIGIN, browser = env.CLOUD_ACCEPTANCE_BROWSER_ORIGIN;
  const request = (path, method = 'GET', session, body) => fetcher(origin + '/api/v1' + path, {
    method, redirect: 'error', signal: AbortSignal.timeout(90000),
    headers: { Origin: browser, ...(session ? { Cookie: session.cookie, 'X-CSRF-Token': session.csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  let result;
  try {
    require(env.CLOUD_ACCEPTANCE_DEMO === '1' && origins.includes(origin) && origins.includes(browser));
    require(typeof env.CLOUD_ACCEPTANCE_PASSWORD === 'string' && env.CLOUD_ACCEPTANCE_PASSWORD.length >= 12);
    require(manifest.prefix === 'release-738f96b2' && manifest.complete && Array.isArray(manifest.reads));
    require(manifest.reads.every(x => typeof x.path === 'string' && /^\/[a-zA-Z0-9/_?=&.-]+$/.test(x.path)));
    stage = 'readiness';
    const ready = await request('/ready'); require(ready.status === 200);
    const readiness = await ready.json(); require(readiness.database === 'ok' && readiness.photos === 'private-storage-configured');
    for (const [login, role] of [['coordinator','coordinator'],['viewer','viewer'],
      [manifest.prefix+'-worker','worker'],[manifest.prefix+'-foreman','foreman']]) {
      stage = 'login:' + role;
      const r = await request('/auth/login','POST',null,{login,password:env.CLOUD_ACCEPTANCE_PASSWORD}); require(r.status === 200);
      const data = (await r.json()).data, raw = r.headers.get('set-cookie');
      const s = {cookie:raw?.split(';')[0],csrf:data.csrfToken,role};
      if (s.cookie && s.csrf) sessions.push(s);
      require(s.cookie && s.csrf && /HttpOnly/i.test(raw) && /Secure/i.test(raw) && /SameSite=Strict/i.test(raw));
      const me = await request('/auth/me','GET',s); require(me.status === 200);
      require((await me.json()).data.user.role === role); checks.push({role,login:'PASS'});
    }
    const viewer = sessions.find(s => s.role === 'viewer');
    stage = 'baseline-read';
    for (const read of manifest.reads) {
      const r = await request(read.path,'GET',viewer); require(r.status === 200);
      require(digest((await r.json()).data) === read.hash);
    }
    stage = 'private-photo';
    require(/^[a-f0-9-]+$/i.test(manifest.photo.id));
    const photo = await request('/uploads/'+manifest.photo.id,'GET',viewer); require(photo.status === 200);
    require(photo.headers.get('content-type')?.includes('image/webp'));
    require(digest(Buffer.from(await photo.arrayBuffer())) === manifest.photo.sha256);
    result = {result:'PASS',scope:'this process only; not proof of another machine access',checks,baselineReads:manifest.reads.length,privatePhoto:'PASS'};
  } catch { result = {result:'FAIL',stage,checks,details:'Response bodies and secrets deliberately omitted'}; }
  finally {
    for (const s of sessions) try {
      const r = await request('/auth/logout','POST',s,{});
      if (r.status !== 200) throw Error(); await r.body?.cancel();
    } catch { result = {...result,result:'FAIL',cleanup:'SESSION_REVOCATION_NOT_CONFIRMED'}; }
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkQaAccess(process.env,JSON.parse(readFileSync(process.argv[2],'utf8')));
    console.log(JSON.stringify({at:new Date().toISOString(),...result}));
    process.exitCode = result.result === 'PASS' ? 0 : 1;
  } catch { console.error('FAIL: manifest/configuration unavailable; values omitted'); process.exitCode=1; }
}
