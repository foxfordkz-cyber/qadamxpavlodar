// Isolated local integration storage over real HTTP and disk. NOT a Supabase provider acceptance.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
export async function privateTestStorage(){
 const dir=mkdtempSync(join(tmpdir(),'gp-private-integration-')),key=randomBytes(32).toString('hex'),bucket='gp-private-test';mkdirSync(join(dir,'demo'));
 let port=0,offline=false,publicBucket=false,failAfterPut=false,deleteFailure=false;
 const counts={puts:0,reads:0,deletes:0};
 const server=createServer(async(req,res)=>{
  const send=(status:number,data:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(offline){send(503,{code:'synthetic_unavailable'});return;}
  if(req.headers.authorization!=='Bearer '+key||req.headers.apikey!==key){send(403,{code:'AccessDenied'});return;}
  if(req.url===`/storage/v1/bucket/${bucket}`){send(200,{public:publicBucket,file_size_limit:5242880,allowed_mime_types:['image/webp']});return;}
  const chunks:Buffer[]=[];for await(const part of req){chunks.push(Buffer.from(part));if(chunks.reduce((n,b)=>n+b.length,0)>6*1024*1024){send(413,{});return;}}
  const bytes=Buffer.concat(chunks);
  if(req.method==='DELETE'&&req.url===`/storage/v1/object/${bucket}`){
   if(deleteFailure){send(503,{});return;}
   const data=JSON.parse(bytes.toString());for(const name of data.prefixes??[]){if(!/^demo\/[a-f0-9-]{36}\.webp$/.test(name)){send(400,{});return;}const path=join(dir,name);if(existsSync(path))unlinkSync(path);counts.deletes++;}send(200,[]);return;
  }
  const prefix=req.method==='POST'?`/storage/v1/object/${bucket}/`:`/storage/v1/object/authenticated/${bucket}/`;
  const name=req.url?.startsWith(prefix)?req.url.slice(prefix.length):'';
  if(!/^demo\/[a-f0-9-]{36}\.webp$/.test(name)){send(404,{});return;}const path=join(dir,name);
  if(req.method==='POST'){
   if(req.headers['x-upsert']!=='false'||req.headers['content-type']!=='image/webp'){send(400,{});return;}
   if(existsSync(path)){send(409,{code:'ResourceAlreadyExists'});return;}
   writeFileSync(path,bytes,{flag:'wx'});counts.puts++;
   if(failAfterPut){failAfterPut=false;send(503,{code:'synthetic_response_loss'});return;}
   send(200,{Key:bucket+'/'+name});return;
  }
  if(!existsSync(path)){send(404,{code:'NoSuchKey'});return;}counts.reads++;
  res.writeHead(200,{'Content-Type':'image/webp'});res.end(readFileSync(path));
 });
 async function start(){server.listen(port,'127.0.0.1');await once(server,'listening');port=(server.address() as {port:number}).port;}
 async function stop(){server.closeAllConnections();if(server.listening)await new Promise<void>(done=>server.close(()=>done()));}
 await start();
 return {dir,counts,get origin(){return `http://127.0.0.1:${port}`;},get env(){return {SUPABASE_URL:`http://127.0.0.1:${port}`,SUPABASE_STORAGE_BUCKET:bucket,SUPABASE_SERVICE_ROLE_KEY:key,STORAGE_ALLOWED_HOSTS:'127.0.0.1'};},get config(){return {origin:`http://127.0.0.1:${port}`,bucket,serviceKey:key,allowedHosts:['127.0.0.1'],localTest:true};},stop,start,
  setOffline:(value:boolean)=>{offline=value;},setPublic:(value:boolean)=>{publicBucket=value;},losePutResponse:()=>{failAfterPut=true;},setDeleteFailure:(value:boolean)=>{deleteFailure=value;},
  objectNames:()=>readdirSync(join(dir,'demo')).map(n=>'demo/'+n),corrupt:(name:string)=>{if(!/^demo\/[a-f0-9-]{36}\.webp$/.test(name))throw Error('Invalid test object');writeFileSync(join(dir,name),Buffer.from('synthetic corrupt object'));}
 };
}
