import * as workflow from "./flows/tasks.js";
import { runSync, queries } from "./flow.js";
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,text,uniqueIds,version,timestamp,now,allow,fail,getDoc,getUser,parseRow,matchVersion,audit,evidence,inside,overlap,type User,type Doc } from './core.js';
import { crew,isMember,profile } from './people.js';
import { design,approvedRevision } from './designs.js';
import { requireSiteCleared } from './data.js';
import { localDayRange } from '../time.js';
export const taskCreate=z.object({objectType:z.enum(['plant','candidate_site']),objectId:id,action:z.enum(['inspect','water','weed','plant']),description:text,priority:z.enum(['low','medium','high','critical']).default('medium'),priorityWeight:z.number().min(0).max(100).default(50),dueAt:timestamp.nullable().default(null),estimatedMinutes:z.number().int().positive().max(1440),requiredWaterLiters:z.number().positive().nullable().default(null),minWorkers:z.number().int().min(1).max(20).default(1),requiredSkills:z.array(text).max(20).default([]),evidenceIds:uniqueIds.min(1)}).strict();
export const designTasks=z.object({expectedVersion:version,revision:version,estimatedMinutes:z.number().int().positive().max(1440),minWorkers:z.number().int().min(1).max(20),requiredSkills:z.array(text).max(20).default(['plant'])}).strict();
// minWorkers (необязательно): минимальный состав задаёт специалист при назначении бригады; людей выбирает бригадир.
export const assignInput=z.object({expectedVersion:version,crewId:id,scheduledStart:timestamp,scheduledEnd:timestamp,resourceIds:uniqueIds.default([]),minWorkers:z.number().int().min(1).max(20).optional()}).strict().refine(b=>b.scheduledStart<b.scheduledEnd,'Invalid assignment interval');
export const assignWorkersInput=z.object({expectedVersion:version,workerIds:uniqueIds.min(1)}).strict();
export const taskQuery=z.object({status:z.enum(['draft','assigned','in_progress','submitted','verified']).optional(),crewId:id.optional(),workerId:id.optional(),objectId:id.optional(),date:z.iso.date().optional(),limit:z.coerce.number().int().min(1).max(200).default(100),offset:z.coerce.number().int().nonnegative().default(0)}).strict();
export function allTasks(s:Store): Doc[] { return runSync(s, workflow.allTasks(queries)); }
// Read scope only. Mutations keep their separate role/assignment checks before idempotent replay.
export function canTask(s:Store,a:User,t:Doc): any { return runSync(s, workflow.canTask(queries, a, t)); }
export function task(s:Store,a:User,taskId:string): Doc { return runSync(s, workflow.task(queries, a, taskId)); }
export function listTasks(s:Store,a:User,q:unknown): { data: Doc[]; meta: { limit: number; offset: number; total: number; }; } { return runSync(s, workflow.listTasks(queries, a, q)); }
export function saveTask(s:Store,a:User,before:Doc,after:Doc,action:string): Doc { return runSync(s, workflow.saveTask(queries, a, before, after, action)); }
export function insertTask(s:Store,a:User,b:Record<string,any>,designRef?:Doc): { id: `${string}-${string}-${string}-${string}-${string}`; createdAt: string; updatedAt: string; status: string; version: number; isDemo: boolean; assignedCrewId: null; assignedWorkerIds: never[]; resourceIds: never[]; scheduledStart: null; scheduledEnd: null; planId: null; approvedDesignId: string | null; approvedDesignVersion: any; latestReportId: null; } { return runSync(s, workflow.insertTask(queries, a, b, designRef)); }
export function createDesignTasks(s:Store,a:User,designId:string,b:z.infer<typeof designTasks>): { id: `${string}-${string}-${string}-${string}-${string}`; createdAt: string; updatedAt: string; status: string; version: number; isDemo: boolean; assignedCrewId: null; assignedWorkerIds: never[]; resourceIds: never[]; scheduledStart: null; scheduledEnd: null; planId: null; approvedDesignId: string | null; approvedDesignVersion: any; latestReportId: null; }[] { return runSync(s, workflow.createDesignTasks(queries, a, designId, b)); }
export function authorizeForeman(s:Store,a:User,t:Doc): void { return runSync(s, workflow.authorizeForeman(queries, a, t)); }
function currentSite(s:Store,d:Doc): void { return runSync(s, workflow.currentSite(queries, d)); }
export function validateAssignment(s:Store,t:Doc,workerIds:string[],requireWorkers=true): void { return runSync(s, workflow.validateAssignment(queries, t, workerIds, requireWorkers)); }
export function assign(s:Store,a:User,taskId:string,b:z.infer<typeof assignInput>): Doc { return runSync(s, workflow.assign(queries, a, taskId, b)); }
export function assignWorkers(s:Store,a:User,taskId:string,b:z.infer<typeof assignWorkersInput>): Doc { return runSync(s, workflow.assignWorkers(queries, a, taskId, b)); }
export function start(s:Store,a:User,taskId:string,expectedVersion:number): Doc { return runSync(s, workflow.start(queries, a, taskId, expectedVersion)); }
