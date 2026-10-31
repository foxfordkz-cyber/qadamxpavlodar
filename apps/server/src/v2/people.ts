import type { Role } from "./core.js";
import * as workflow from "./flows/people.js";
import { runSync, queries } from "./flow.js";
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,roles,canonicalRole,shortText,timestamp,intervals,uniqueIds,version,now,allow,fail,audit,getUser,userDto,parseRow,matchVersion,getDoc,type User,type Doc } from './core.js';
import { password } from './auth.js';

export const profileInput=z.object({shiftStart:timestamp,shiftEnd:timestamp,capacityMinutes:z.number().int().positive().max(1440),
  skills:z.array(shortText).max(30),unavailableIntervals:intervals,startLocation:z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)}).strict().nullable().optional()}).strict()
  .refine(p=>p.shiftStart<p.shiftEnd&&p.capacityMinutes<=(Date.parse(p.shiftEnd)-Date.parse(p.shiftStart))/60000,'Invalid shift/capacity');
export const userCreate=z.object({login:z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,80}$/),displayName:shortText,role:roles,password,profile:profileInput.optional()}).strict();
export const userPatch=z.object({expectedVersion:version,displayName:shortText.optional(),role:roles.optional(),active:z.boolean().optional(),password:password.optional(),profile:profileInput.optional()}).strict()
  .refine(b=>Object.keys(b).length>1,'No changes');
export const crewCreate=z.object({name:shortText,foremanId:id,resourceIds:uniqueIds.default([])}).strict();
export const crewPatch=z.object({expectedVersion:version,name:shortText.optional(),foremanId:id.optional(),active:z.boolean().optional(),resourceIds:uniqueIds.optional()}).strict().refine(b=>Object.keys(b).length>1,'No changes');
export const membershipInput=z.object({expectedVersion:version,userId:id,active:z.boolean(),validFrom:timestamp.optional(),validUntil:timestamp.nullable().optional()}).strict();
export function profile(s:Store,userId:string): Doc | null { return runSync(s, workflow.profile(queries, userId)); }
function saveProfile(s:Store,userId:string,input:z.infer<typeof profileInput>): void { return runSync(s, workflow.saveProfile(queries, userId, input)); }
export function createUser(s:Store,a:User,b:z.infer<typeof userCreate>,passwordHash:string): User { return runSync(s, workflow.createUser(queries, a, b, passwordHash)); }
export function patchUser(s:Store,a:User,userId:string,b:z.infer<typeof userPatch>,passwordHash?:string): { displayName: string; role: "admin" | "coordinator" | "foreman" | "worker" | "viewer"; active: boolean; version: number; id: string; } { return runSync(s, workflow.patchUser(queries, a, userId, b, passwordHash)); }
export function crew(s:Store,crewId:string): Doc { return runSync(s, workflow.crew(queries, crewId)); }
export function isMember(s:Store,crewId:string,userId:string,start=now(),end=start): boolean { return runSync(s, workflow.isMember(queries, crewId, userId, start, end)); }
export function canCrew(s:Store,a:User,c:Doc): boolean { return runSync(s, workflow.canCrew(queries, a, c)); }
export function ownCrew(s:Store,a:User,crewId:string): Doc { return runSync(s, workflow.ownCrew(queries, a, crewId)); }
function checkForeman(s:Store,userId:string): void { return runSync(s, workflow.checkForeman(queries, userId)); }
function checkResources(s:Store,ids:string[]): void { return runSync(s, workflow.checkResources(queries, ids)); }
function persistCrew(s:Store,c:Doc): void { return runSync(s, workflow.persistCrew(queries, c)); }
export function createCrew(s:Store,a:User,b:z.infer<typeof crewCreate>): { id: `${string}-${string}-${string}-${string}-${string}`; active: boolean; version: number; name: string; foremanId: string; resourceIds: string[]; } { return runSync(s, workflow.createCrew(queries, a, b)); }
export function patchCrew(s:Store,a:User,crewId:string,b:z.infer<typeof crewPatch>): { version: number; name?: string | undefined; foremanId?: string | undefined; active?: boolean | undefined; resourceIds?: string[] | undefined; id: string; } { return runSync(s, workflow.patchCrew(queries, a, crewId, b)); }
export function membership(s:Store,a:User,crewId:string,b:z.infer<typeof membershipInput>): { members: { id: string | number | null | undefined; crewId: string | number | null | undefined; userId: string | number | null | undefined; validFrom: string | number | null | undefined; validUntil: string | number | null | undefined; active: boolean; }[]; version: number; id: string; } { return runSync(s, workflow.membership(queries, a, crewId, b)); }
export function members(s:Store,crewId:string): { id: string | number | null | undefined; crewId: string | number | null | undefined; userId: string | number | null | undefined; validFrom: string | number | null | undefined; validUntil: string | number | null | undefined; active: boolean; }[] { return runSync(s, workflow.members(queries, crewId)); }
export function listUsers(s:Store,a:User): { profile: Doc | null; id: string; displayName: string; role: Role; active: boolean; version: number; }[] { return runSync(s, workflow.listUsers(queries, a)); }
export function workers(s:Store,a:User): { profile: Doc | null; id: string; displayName: string; role: Role; active: boolean; version: number; }[] { return runSync(s, workflow.workers(queries, a)); }
