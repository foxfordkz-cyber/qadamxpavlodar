import * as workflow from "./flows.js";
import { runSync, queries } from "../v2/flow.js";
import { Store } from '../db.js';
import { ApiError } from '../errors.js';
import { allow, fail, getDoc, maybeDoc, parseRow, now, matchVersion, audit, type User, type Doc } from '../v2/core.js';
import { allTasks, canTask } from '../v2/tasks.js';
import { candidate, reference, analyze, speciesList } from '../tz/data.js';
import { shared, today, day, type Json } from './shared.js';

export function validate<T>(work:()=>T):T {
 try{return work();}catch(e){
  if(e instanceof Error && e.name==='OutcomeValidationError')throw new ApiError(400,(e as any).code,e.message,{field:(e as any).field});
  throw e;
 }
}
export const metadata=(row:Json)=>({createdAt:row.created_at,createdBy:row.created_by??row.reviewer_id});
export function canRead(s:Store,a:User,c:Json): any { return runSync(s, workflow.canRead(queries, a, c)); }
export function cohort(s:Store,a:User,id:string): { data: Doc; meta: { createdAt: any; createdBy: any; }; } { return runSync(s, workflow.cohort(queries, a, id)); }
export function cohorts(s:Store,a:User): { data: Doc; meta: { createdAt: any; createdBy: any; }; }[] { return runSync(s, workflow.cohorts(queries, a)); }
/** Read model for the specialist screen; all domain records retain the #18 DTOs. */
export function siteOutcomes(s:Store,a:User,siteId:string): { siteId: string; asOf: string; cohorts: Doc[]; inspections: Doc[]; registry: { plantId: string; speciesId: any; siteId: any; kind: string; plantedOn: string | null; isDemo: boolean; }[]; forecasts: { id: string | number | null | undefined; snapshot: Doc; }[]; } { return runSync(s, workflow.siteOutcomes(queries, a, siteId, speciesList(s))); }
export function registry(s:Store,plantId:string): { plantId: string; speciesId: any; siteId: any; kind: string; plantedOn: string | null; isDemo: boolean; } { return runSync(s, workflow.registry(queries, plantId, speciesList(s))); }
function provenance(s:Store,isDemo:boolean,evidenceIds:string[],siteId:string): { source: string; capturedAt: string; dataClass: string; isDemo: boolean; evidenceIds: string[]; siteVersion: number; ratesVersion: null; } { return runSync(s, workflow.provenance(queries, isDemo, evidenceIds, siteId)); }
export function snapshot(s:Store,a:User,b:Json): { id: any; snapshot: Json; createdAt: string; } { allow(a,'admin','coordinator'); return runSync(s, workflow.snapshot(queries, a, b, {get site(){return candidate(s,b.siteId)},get ref(){return reference(s)}})); }
export function createCohort(s:Store,a:User,b:Json): Json { return runSync(s, workflow.createCohort(queries, a, b, speciesList(s))); }
function confirmObservation(s:Store,c:Json,o:Json,observedOn:string): void { return runSync(s, workflow.confirmObservation(queries, c, o, observedOn)); }
export function inspection(s:Store,a:User,cohortId:string,b:Json): { id: any; cohortId: string; observedOn: any; observations: any; provenance: { source: string; capturedAt: string; dataClass: string; isDemo: boolean; evidenceIds: string[]; siteVersion: number; ratesVersion: null; }; version: number; } { return runSync(s, workflow.inspection(queries, a, cohortId, b)); }
export function history(s:Store,a:User,id:string): { data: Doc; meta: { createdAt: string | number | null | undefined; reviewerId: string | number | null | undefined; }; }[] { return runSync(s, workflow.history(queries, a, id)); }
export function summary(s:Store,a:User,id:string,inspectionId:string|null): { summary: Json; comparison: Json; asOf: string; } { return runSync(s, workflow.summary(queries, a, id, inspectionId)); }
