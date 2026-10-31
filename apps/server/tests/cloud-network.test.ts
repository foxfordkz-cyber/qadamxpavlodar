import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('cloud network allowlist delegates exact configured names only; wildcard, IP bypass, UDP and other hosts remain blocked',()=>{
  // Controlled socket stub proves guard decisions, without connecting to an external provider.
  const source=`
    import assert from 'node:assert/strict';
    import net from 'node:net';import dns from 'node:dns';import dgram from 'node:dgram';
    const delegated=[];net.Socket.prototype.connect=function(options){delegated.push(options.host);return this;};
    await import('./scripts/local-network-guard.mjs');
    new net.Socket().connect({host:'db.example.com',port:5432});
    new net.Socket().connect({host:'project.supabase.co',port:443});
    for(const host of ['evil.example.com','db.example.com.evil.test','8.8.8.8'])assert.throws(()=>new net.Socket().connect({host,port:443}),{code:'LOCAL_NETWORK_ONLY'});
    assert.throws(()=>dns.resolve4('db.example.com'),{code:'LOCAL_NETWORK_ONLY'});
    assert.throws(()=>dgram.createSocket('udp4'),{code:'LOCAL_NETWORK_ONLY'});
    assert.deepEqual(delegated,['db.example.com','project.supabase.co']);
  `;
  execFileSync(process.execPath,['--input-type=module','-e',source],{windowsHide:true,stdio:'pipe',
    env:{...process.env,CLOUD_ALLOWED_HOSTS:'db.example.com,project.supabase.co',LLM_ALLOWED_HOSTS:''}});
  for(const invalid of ['*.supabase.co','127.0.0.2','https://project.supabase.co']){
    assert.throws(()=>execFileSync(process.execPath,['--import','./scripts/local-network-guard.mjs','-e',''],{windowsHide:true,stdio:'pipe',env:{...process.env,CLOUD_ALLOWED_HOSTS:invalid}}));
  }
});
