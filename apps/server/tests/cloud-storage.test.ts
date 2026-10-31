import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SupabasePrivateStorage } from '../src/cloud/private-storage.js';

test('private storage adapter contract (simulated transport, NOT live Supabase acceptance)',async()=>{
  const key=randomBytes(32).toString('hex'),name='demo/'+randomUUID()+'.webp';
  const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#15803d'}}).webp().toBuffer();
  let publicBucket=false,oversize=false;const objects=new Map<string,Buffer>();const calls:string[]=[];
  const transport:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push(url);assert(url.startsWith('https://project.supabase.co/storage/v1/'));
    assert.equal(init?.redirect,'error');assert(new Headers(init?.headers).get('Authorization')==='Bearer '+key,'Missing server authorization');
    if(url.includes('/bucket/'))return Response.json({public:publicBucket,file_size_limit:5242880,allowed_mime_types:['image/webp']});
    if(init?.method==='POST'){
      assert.equal(new Headers(init.headers).get('x-upsert'),'false');
      if(objects.has(name))return new Response(null,{status:409});objects.set(name,Buffer.from(init.body as Uint8Array));return Response.json({Key:name});
    }
    assert(url.includes('/object/authenticated/'));return new Response(new Uint8Array(oversize?Buffer.concat([bytes,bytes]):objects.get(name)!));
  };
  const storage=new SupabasePrivateStorage({origin:'https://project.supabase.co',bucket:'gp-demo',serviceKey:key,allowedHosts:['project.supabase.co']},transport);
  const photo=await storage.put(name,bytes);assert((await storage.read(photo)).equals(bytes));
  await assert.rejects(storage.put(name,bytes),{code:'STORAGE_OBJECT_EXISTS'});
  await assert.rejects(storage.put('../unsafe.webp',bytes),{code:'INVALID_STORAGE_NAME'});
  publicBucket=true;await assert.rejects(storage.read(photo),{code:'UNSAFE_STORAGE_BUCKET'});publicBucket=false;
  oversize=true;await assert.rejects(storage.read(photo),{code:'PHOTO_UNAVAILABLE'});oversize=false;
  await assert.rejects(storage.read({...photo,sha256:'0'.repeat(64)}),{code:'PHOTO_UNAVAILABLE'});
  assert(calls.every(x=>!x.includes('/public/')));
});

test('storage rejects untrusted origin, redirects/network failure, and unsupported bytes',async()=>{
  const config={origin:'https://project.supabase.co',bucket:'gp-demo',serviceKey:randomBytes(32).toString('hex'),allowedHosts:['project.supabase.co']};
  assert.throws(()=>new SupabasePrivateStorage({...config,origin:'http://project.supabase.co'}));
  assert.throws(()=>new SupabasePrivateStorage({...config,origin:'https://other.supabase.co'}));
  const storage=new SupabasePrivateStorage(config,async()=>{throw Error('private provider detail');});
  await assert.rejects(storage.verifyPrivateBucket(),{code:'PHOTO_UNAVAILABLE'});
  await assert.rejects(storage.put('demo/'+randomUUID()+'.webp',Buffer.from('not an image')),{code:'INVALID_PHOTO_TYPE'});
});
