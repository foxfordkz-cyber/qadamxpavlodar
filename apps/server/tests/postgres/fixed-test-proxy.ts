// Loopback transport-contract exercise only, not the Cloudflare runtime or a public TLS check.
import { createServer } from 'node:http';
import { once } from 'node:events';
export async function fixedTestProxy(backend:string){
 const target=new URL(backend).origin;
 const server=createServer(async(req,res)=>{
  try{
   if(!req.url?.startsWith('/api/')){res.writeHead(404).end();return;}
   const parts:Buffer[]=[];for await(const chunk of req)parts.push(Buffer.from(chunk));
   const headers:Record<string,string>={};
   for(const key of ['cookie','origin','content-type','x-csrf-token','idempotency-key'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key]!;
   const upstream=await fetch(target+req.url,{method:req.method,headers,body:parts.length?Buffer.concat(parts):undefined,redirect:'manual'});
   if([301,302,303,307,308].includes(upstream.status)){void upstream.body?.cancel();res.writeHead(502).end();return;}
   const output:Record<string,string|string[]>={};for(const [key,value] of upstream.headers)if(!['connection','transfer-encoding','set-cookie'].includes(key))output[key]=value;
   const cookies=upstream.headers.getSetCookie();if(cookies.length)output['set-cookie']=cookies;output['cache-control']='no-store, private';
   res.writeHead(upstream.status,output);res.end(Buffer.from(await upstream.arrayBuffer()));
  }catch{res.writeHead(502).end();}
 }).listen(0,'127.0.0.1');await once(server,'listening');
 return {base:`http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1`,stop:async()=>{server.closeAllConnections();await new Promise<void>(done=>server.close(()=>done()));}};
}
