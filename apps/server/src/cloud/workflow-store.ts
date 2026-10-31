import type { PoolClient } from 'pg';
import type { Row } from '../db.js';
import { type Flow, type QueryEffect } from '../v2/flow.js';

// Only these application-owned tables are addressable by shared domain operations.
const tables:Record<string,string>=Object.fromEntries(['users','sessions','profiles','crews','memberships','documents','designs','design_revisions','tasks','assignments','reports','report_drafts','uploads','issues','planting_receipts','care_events','idempotency'].map(name=>['v2_'+name,'gp_cloud.'+name]));
for(const name of ['snapshots','cohorts','members','inspections','sources'])tables['outcome_'+name]='gp_cloud.outcome_'+name;
tables.v2_history='gp_cloud.workflow_history';tables.municipal_roles='gp_cloud.municipal_roles';
export function postgresQuery(sql:string) {
  let n=0;
  return sql.replace(/\s+COLLATE NOCASE\b/gi,'').replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\b[a-z_][a-z_0-9]*\b|\?/gi,token=>{
    if(token==='?')return '$'+(++n);
    if(token.startsWith('v2_')&&!tables[token])throw Error('Unmapped workflow table');
    return tables[token]??token;
  });
}
function publicRow(row:Record<string,unknown>):Row {
  const result={...row};
  // Shared domain parsing expects serialized JSON, just as in the original SQLite schema.
  for(const key of ['data','before_json','after_json','response_json','report','task'])
    if(result[key]!==null&&typeof result[key]==='object')result[key]=JSON.stringify(result[key]);
  return result as Row;
}
async function execute(c:PoolClient,effect:QueryEffect) {
  if(effect.params.some(p=>p===undefined))throw Error('Undefined workflow SQL parameter');
  const result=await c.query(postgresQuery(effect.sql),effect.params);
  return effect.op==='run'?{changes:result.rowCount??0}:effect.op==='get'?(result.rows[0]?publicRow(result.rows[0]):undefined):result.rows.map(publicRow);
}
/** Execute the SAME domain generator as SQLite, awaiting each real PostgreSQL query.
 * The caller owns the transaction; completion means all effects have finished.
 */
export async function runPostgres<T>(c:PoolClient,flow:Flow<T>):Promise<T> {
  let step=flow.next();
  while(!step.done){
    let value:unknown;
    try{value=await execute(c,step.value);}catch(error){step=flow.throw(error);continue;}
    step=flow.next(value);
  }
  return step.value;
}
