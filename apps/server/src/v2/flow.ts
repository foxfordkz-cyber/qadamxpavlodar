import type { Store, Row } from '../db.js';

/** Domain operations yield database effects. SQLite drives them synchronously; PostgreSQL
 * awaits every effect on its transaction client. No SQLite is instantiated in cloud mode.
 */
export type QueryEffect={op:'get'|'all'|'run';sql:string;params:(string|number|null|undefined)[]};
export type Flow<T>=Generator<QueryEffect,T,any>;
export class FlowContext {
  *get(sql:string,...params:QueryEffect['params']):Flow<Row|undefined>{return yield {op:'get',sql,params};}
  *all(sql:string,...params:QueryEffect['params']):Flow<Row[]>{return yield {op:'all',sql,params};}
  *run(sql:string,...params:QueryEffect['params']):Flow<{changes:number|bigint}>{return yield {op:'run',sql,params};}
}
export const queries=new FlowContext();
export function runSync<T>(store:Store,flow:Flow<T>):T {
  let next=flow.next();
  while(!next.done){const effect=next.value;try{next=flow.next(store[effect.op](effect.sql,...effect.params.map(value=>{if(value===undefined)throw Error('Undefined database parameter');return value;})));}catch(error){next=flow.throw(error);}}
  return next.value;
}
export function* flowMap<T,R>(xs:T[],fn:(x:T,index:number)=>Flow<R>):Flow<R[]>{const result:R[]=[];for(const [i,x] of xs.entries())result.push(yield* fn(x,i));return result;}
export function* flowFilter<T>(xs:T[],fn:(x:T,index:number)=>Flow<unknown>):Flow<T[]>{const result:T[]=[];for(const [i,x] of xs.entries())if(yield* fn(x,i))result.push(x);return result;}
export function* flowSome<T>(xs:T[],fn:(x:T,index:number)=>Flow<unknown>):Flow<boolean>{for(const [i,x] of xs.entries())if(yield* fn(x,i))return true;return false;}
export function* flowEvery<T>(xs:T[],fn:(x:T,index:number)=>Flow<unknown>):Flow<boolean>{for(const [i,x] of xs.entries())if(!(yield* fn(x,i)))return false;return true;}
export function* flowFind<T>(xs:T[],fn:(x:T,index:number)=>Flow<unknown>):Flow<T|undefined>{for(const [i,x] of xs.entries())if(yield* fn(x,i))return x;return undefined;}
