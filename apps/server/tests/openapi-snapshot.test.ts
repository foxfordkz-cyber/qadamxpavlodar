import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { fixture } from './helpers.js';

test('published V2 snapshot equals live generator and retains cookie/CSRF semantics',async t=>{
 const f=await fixture(t);
 const response=await fetch(f.base+'/api/v1/openapi.json');assert.equal(response.status,200);
 const live=await response.json();
 assert.deepEqual(JSON.parse(readFileSync('openapi-v2.json','utf8')),live,'Regenerate snapshot from existing /api/v1/openapi.json generator');
 const ajv=new Ajv2020({strict:false,validateFormats:false});
 for(const [path,methods] of Object.entries(live.paths))for(const [method,value] of Object.entries(methods as Record<string,any>)){
  if(path==='/auth/login')assert.deepEqual(value.security,[]);
  else assert.deepEqual(value.security,[{SessionCookie:[],...(method==='get'?{}:{CsrfToken:[]})}]);
  for(const media of Object.values(value.requestBody?.content??{}) as any[])ajv.compile({...media.schema,components:live.components});
  for(const response of Object.values(value.responses) as any[])for(const media of Object.values(response.content??{}) as any[])ajv.compile({...media.schema,components:live.components});
 }
 assert.equal(live.components.securitySchemes.SessionCookie.name,'gp_v2_session');
 assert.equal(live.components.securitySchemes.CsrfToken.name,'X-CSRF-Token');
});
