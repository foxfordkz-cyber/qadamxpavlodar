import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {checkQaAccess} from '../scripts/cloud-qa-access.mjs';
const env={CLOUD_ACCEPTANCE_DEMO:'1',CLOUD_ACCEPTANCE_ORIGIN:'https://green-pavlodar-api.pages.dev',CLOUD_ACCEPTANCE_BROWSER_ORIGIN:'https://green-pavlodar-api.pages.dev',CLOUD_ACCEPTANCE_PASSWORD:'test-only-password'};
const sha=v=>createHash('sha256').update(v).digest('hex');
const manifest={prefix:'release-738f96b2',complete:true,reads:[{path:'/tasks/abcd',hash:sha('{"id":"abcd"}')}],photo:{id:'abcd',sha256:sha('webp')}};
function fixture(failPath){const calls=[];return {calls,fetcher:async(url,o)=>{const path=new URL(url).pathname.replace('/api/v1','');calls.push({path,...o});const role=o.headers.Cookie?.split('=')[1];
 if(path===failPath)return new Response('private server error',{status:500});
 if(path==='/ready')return Response.json({database:'ok',photos:'private-storage-configured'});
 if(path==='/auth/login'){const b=JSON.parse(o.body),r=b.login.split('-').at(-1);return Response.json({data:{csrfToken:'test-csrf'}},{headers:{'set-cookie':`gp=${r}; Secure; HttpOnly; SameSite=Strict`}});}
 if(path==='/auth/me')return Response.json({data:{user:{role}}});
 if(path==='/auth/logout')return Response.json({data:{ok:true}});
 if(path==='/uploads/abcd')return new Response('webp',{headers:{'content-type':'image/webp'}});
 return Response.json({data:{id:'abcd'}});
 }};}
test('success checks four non-admin roles and baseline; only auth POSTs; revokes sessions',async()=>{const f=fixture();const r=await checkQaAccess(env,manifest,f.fetcher);assert.equal(r.result,'PASS');assert.equal(r.checks.length,4);assert.equal(f.calls.filter(c=>c.path==='/auth/logout').length,4);assert(f.calls.filter(c=>c.method==='POST').every(c=>c.path.startsWith('/auth/')));assert(!JSON.stringify(r).includes(env.CLOUD_ACCEPTANCE_PASSWORD));assert(f.calls.every(c=>c.redirect==='error'));});
test('denies foreign destination before transmitting credentials',async()=>{const f=fixture();assert.equal((await checkQaAccess({...env,CLOUD_ACCEPTANCE_ORIGIN:'https://example.com'},manifest,f.fetcher)).result,'FAIL');assert.equal(f.calls.length,0);});
test('requires explicit demo opt-in',async()=>{const f=fixture();assert.equal((await checkQaAccess({...env,CLOUD_ACCEPTANCE_DEMO:'0'},manifest,f.fetcher)).result,'FAIL');assert.equal(f.calls.length,0);});
test('baseline failure revokes all acquired sessions and redacts response',async()=>{const f=fixture('/tasks/abcd');const r=await checkQaAccess(env,manifest,f.fetcher);assert.equal(r.result,'FAIL');assert.equal(f.calls.filter(c=>c.path==='/auth/logout').length,4);assert(!JSON.stringify(r).includes('private server error'));});
test('cleanup failure cannot be PASS',async()=>{const f=fixture('/auth/logout');assert.equal((await checkQaAccess(env,manifest,f.fetcher)).cleanup,'SESSION_REVOCATION_NOT_CONFIRMED');});
test('wrong photo hash is a failure',async()=>{const f=fixture();assert.equal((await checkQaAccess(env,{...manifest,photo:{id:'abcd',sha256:'wrong'}},f.fetcher)).result,'FAIL');});
