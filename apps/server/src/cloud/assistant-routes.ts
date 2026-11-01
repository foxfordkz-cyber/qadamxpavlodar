import {actor} from '../v2/auth.js';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {fail,now,userDto,type User} from '../v2/core.js';
import type {Api} from '../v2/api-contract.js';
import {web,type Json} from '../tz/shared.js';
import {createDataLlmAssistant,createDataTools,questionLang,type AssistantData,type LlmConfig} from '../tz/llm.js';
import {PostgresPlanningRepository,planningReader} from './planning-repository.js';

const input=z.object({message:z.string().trim().min(1).max(2000),siteId:z.string().min(1).max(160).nullable().optional(),
 history:z.array(z.object({role:z.enum(['user','assistant']),text:z.string().max(2000)}).strict()).max(6).optional(),
 view:z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}).strict().nullable().optional()}).strict();
// Match the existing frontend AssistantReply: optional strings are omitted, not null.
const replySchema=z.object({text:z.string(),zones:z.array(z.object({id:z.string(),name:z.string()})),
 method:z.enum(['rules','model']),intent:z.string(),data:z.unknown().optional(),
 sources:z.array(z.object({id:z.string(),label:z.string(),url:z.string().optional()})).optional(),
 toolCalls:z.array(z.object({name:z.string(),args:z.record(z.string(),z.unknown())})).optional(),
 model:z.string().optional(),fallbackReason:z.string().optional(),reserveReason:z.string().optional(),lang:z.enum(['ru','kk']).optional()});
const historySchema=z.array(z.object({at:z.string(),q:z.string(),intent:z.string(),method:z.enum(['rules','model']),zones:z.array(z.string())}));

export async function assistantData(repo:PostgresPlanningRepository):Promise<AssistantData> {
 return repo.read(async(snapshot,c)=>{
  const facts=await repo.get('settings','reference-facts',c);
  const evidence=(await c.query("SELECT data FROM gp_cloud.documents WHERE kind='evidence' ORDER BY id")).rows.map(r=>r.data);
  const sites=snapshot.sites.map(s=>s.zone).filter(s=>s.areaM2!=null&&s.areaM2>0);
  if(!sites.length)fail('CLOUD_DATA_MISSING','No measured zones available for assistant calculations',503);
  const ref=repo.ref(snapshot);
  return {disabledTools:['find_place'],species:()=>snapshot.catalog,rates:()=>ref.rates,facts:()=>facts.data.facts,evidence:()=>evidence,
   candidates:()=>sites,site:id=>sites.find(s=>s.id===id),candidate:id=>{const site=sites.find(s=>s.id===id);if(!site)fail('NOT_FOUND','Measured zone not found',404);return site;},reference:()=>ref};
 });
}
export function assistantRoutes({route}:Pick<Api,'route'>,repo:PostgresPlanningRepository,providers:LlmConfig[]=[]) {
 const model=createDataLlmAssistant(()=>assistantData(repo),providers);
 const active=new Set<string>();
 // Select the newest 50, then return chronological order like the SQLite API.
 const history=async(a:User)=>(await repo.db.pool.query('SELECT at,question AS q,intent,method,zones FROM gp_cloud.assistant_history WHERE user_id=$1 ORDER BY at DESC,id LIMIT 50',[a.id])).rows.reverse();
 route({method:'get',path:'/assistant/history',summary:'Current authenticated user assistant history, last 50',response:historySchema},async(q,r)=>{
  const a=actor(r);planningReader(a);z.object({}).strict().parse(q.query);r.json({data:await history(a)});
 });
 route({method:'post',path:'/assistant',input,response:replySchema,readOnly:true,summary:'PostgreSQL assistant: bounded provider chain or explicit shared-rules fallback'},async(q,r)=>{
  const a=actor(r);planningReader(a);const b=input.parse(q.body);
  // Do not transmit obvious pasted credentials. Database inputs never include profiles/photos/sessions.
  if(/(?:bearer\s+\S+|(?:password|api[_ -]?key|access[_ -]?token|cookie)\s*[:=]|eyJ[A-Za-z0-9_-]{20,}\.)/i.test([b.message,...(b.history??[]).map(h=>h.text)].join('\n')))
   fail('SENSITIVE_INPUT','Remove credentials from the question',400);
  if(active.has(a.id)||active.size>=4)fail('ASSISTANT_BUSY','Assistant capacity reached; try later',429);
  active.add(a.id);
  try {
   const count=(await repo.db.pool.query('SELECT count(*)::int n FROM gp_cloud.assistant_history WHERE user_id=$1 AND at>$2',[a.id,new Date(Date.now()-60000).toISOString()])).rows[0].n;
   if(count>=10)fail('ASSISTANT_RATE_LIMIT','At most 10 answers per minute',429);
   const data=await assistantData(repo),siteId=b.siteId??null;
   if(siteId)data.candidate(siteId);
   let reply:Json|undefined,fallbackReason=providers.length?'Model unavailable or response rejected; shared rules used.':'No enabled server model; shared rules used.';
   if(providers.length)try {reply=await model({message:b.message,siteId,user:a,history:b.history??[],view:b.view??null},data);}catch{/* Never log provider body, question, credentials or generated content. */}
   if(!reply){const ref=data.reference();reply={...web.answer(b.message,{siteId,history:b.history??[],view:b.view??null},data.candidates(),ref.species,ref.map),method:'rules',sources:[],toolCalls:[],fallbackReason};}
   else if(reply.reserveReason)reply={...reply,fallbackReason:reply.reserveReason};
   if(reply.method==='rules' && (reply.intent==='facts'||/источник|дереккөз/i.test(b.message))) {
    const ctx={zones:[],evidence:new Set<string>()};
    const hits=createDataTools(data)('search_knowledge',{query:b.message,limit:3},ctx);
    reply={...reply,intent:'facts',zones:[],text:hits.results?.length?hits.results.map((x:Json)=>`${x.title}: ${x.text}`).join('\n'):
     (questionLang(b.message)==='kk'?'Сақталған дереккөздерден жауап табылмады.':'В сохранённых источниках ответ не найден.'),
     sources:[...ctx.evidence].map(id=>data.evidence().find(x=>x.id===id)).filter(Boolean).map(e=>({id:e!.id,label:e!.sourceLabel,...(e!.sourceUrl?{url:e!.sourceUrl}:{})})).slice(0,6)};
   }
   // No bundled address lookup is advertised as a live cloud fact.
   if(reply.method==='rules'&&!siteId&&!['budget','priority','problems','facts'].includes(String(reply.intent)))
    reply={...reply,intent:'need_zone',zones:[],text:questionLang(b.message)==='kk'?'Картадан бар аумақты таңдаңыз. Бұлттағы мекенжай іздеуі әлі қолжетімсіз.':'Выберите существующую зону на карте. Облачный поиск адреса пока недоступен.'};
   await repo.db.transaction(async c=>{
    const row=(await c.query('SELECT * FROM gp_cloud.users WHERE id=$1 FOR UPDATE',[a.id])).rows[0];
    if(!row)fail('SESSION_REVOKED','Sign in again',401);
    const current=userDto(row);if(!current.active||current.version!==a.version||current.role!==a.role)fail('SESSION_REVOKED','Sign in again',401);
    planningReader(current);
    const live=(await c.query('SELECT token_hash FROM gp_cloud.sessions WHERE token_hash=$1 AND user_id=$2 AND expires_at>$3 FOR SHARE',[r.locals.v2session,a.id,now()])).rows[0];
    if(!live)fail('SESSION_REVOKED','Sign in again',401);
    await c.query('INSERT INTO gp_cloud.assistant_history VALUES ($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),a.id,now(),b.message.slice(0,300),String(reply!.intent??'other'),reply!.method,JSON.stringify((reply!.zones??[]).map((v:Json)=>v.id))]);
    await c.query('DELETE FROM gp_cloud.assistant_history WHERE user_id=$1 AND id NOT IN (SELECT id FROM gp_cloud.assistant_history WHERE user_id=$1 ORDER BY at DESC,id LIMIT 50)',[a.id]);
   });
   r.json({data:reply});
  } finally {active.delete(a.id);}
 });
}
