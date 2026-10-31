import * as workflow from "./flows/designs.js";
import { runSync, queries } from "./flow.js";
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Store } from '../db.js';
import { id,text,shortText,uniqueIds,version,allow,fail,getDoc,parseRow,matchVersion,audit,now,evidence,type User,type Doc } from './core.js';
import { geometry,requireSiteCleared } from './data.js';

// kind/note/origin/conflicts — поля редактора проекта (веб-контракт v1.1): разобранные конфликты хранятся вместе с позицией.
const conflict=z.object({type:z.enum(['exclusion_zone','outside_site','near_building']),message:text,resolution:text.nullable()}).strict();
export const plantingItem=z.object({id,catalogItemId:id,geometry,quantity:z.number().int().positive().max(5000).nullable(),quantityMethod:text.nullable(),spacingM:z.number().positive().nullable().default(null),bedAreaM2:z.number().positive().nullable().default(null),phase:shortText.nullable().default(null),carePolicyId:id.nullable().default(null),evidenceIds:uniqueIds.min(1),
  kind:z.enum(['point','bed']).optional(),note:text.optional(),origin:z.enum(['manual','suggested']).optional(),conflicts:z.array(conflict).max(20).optional()}).strict();
// Черновик может быть пустым (редактор добавляет позиции после создания); на согласование — только с позициями.
const designFields={name:shortText,objective:text,season:shortText.nullable(),contextVersion:version,plantingItems:z.array(plantingItem).max(50),exclusionZones:z.array(geometry).max(20),sourcePhotoIds:uniqueIds.max(0),evidenceIds:uniqueIds.min(1)};
export const designCreate=z.object({siteId:id,...designFields,season:designFields.season.default(null),exclusionZones:designFields.exclusionZones.default([]),sourcePhotoIds:designFields.sourcePhotoIds.default([])}).strict();
// Без значений по умолчанию: .partial() в Zod 4 их сохраняет, и правка затирала бы season, exclusionZones и sourcePhotoIds.
export const designPatch=z.object(designFields).partial().extend({expectedVersion:version}).strict().refine(b=>Object.keys(b).length>1,'No changes');
export const designReview=z.object({expectedVersion:version,decision:z.enum(['approved','changes_requested']),comment:text}).strict();
export function design(s:Store,designId:string): Doc { return runSync(s, workflow.design(queries, designId)); }
export function approvedRevision(s:Store,designId:string,revision:number): Doc { return runSync(s, workflow.approvedRevision(queries, designId, revision)); }
function validate(s:Store,d:Record<string,any>): Doc { return runSync(s, workflow.validate(queries, d)); }
function save(s:Store,d:Doc): Doc { return runSync(s, workflow.save(queries, d)); }
export function createDesign(s:Store,a:User,b:z.infer<typeof designCreate>): { id: `${string}-${string}-${string}-${string}-${string}`; revision: number; status: string; version: number; createdBy: string; createdByName: string; createdAt: string; updatedAt: string; checkSnapshot: any; siteVersion: number; estimatedCost: null; costCompleteness: string; season: string | null; exclusionZones: ({ type: "Point"; coordinates: [number, number]; } | { type: "MultiPoint"; coordinates: [number, number][]; } | { type: "Polygon"; coordinates: [number, number][][]; })[]; sourcePhotoIds: string[]; name: string; objective: string; contextVersion: number; plantingItems: { id: string; catalogItemId: string; geometry: { type: "Point"; coordinates: [number, number]; } | { type: "MultiPoint"; coordinates: [number, number][]; } | { type: "Polygon"; coordinates: [number, number][][]; }; quantity: number | null; quantityMethod: string | null; spacingM: number | null; bedAreaM2: number | null; phase: string | null; carePolicyId: string | null; evidenceIds: string[]; kind?: "point" | "bed" | undefined; note?: string | undefined; origin?: "manual" | "suggested" | undefined; conflicts?: { type: "exclusion_zone" | "outside_site" | "near_building"; message: string; resolution: string | null; }[] | undefined; }[]; evidenceIds: string[]; siteId: string; } { return runSync(s, workflow.createDesign(queries, a, b)); }
export function patchDesign(s:Store,a:User,designId:string,b:z.infer<typeof designPatch>): Doc { return runSync(s, workflow.patchDesign(queries, a, designId, b)); }
export function submitDesign(s:Store,a:User,designId:string,expectedVersion:number): { status: string; checkSnapshot: any; siteVersion: number; submittedAt: string; version: number; updatedAt: string; id: string; } { return runSync(s, workflow.submitDesign(queries, a, designId, expectedVersion)); }
export function reviewDesign(s:Store,a:User,designId:string,b:z.infer<typeof designReview>): { status: "approved" | "changes_requested"; reviewComment: string; reviewedBy: string; reviewedByName: string; reviewedAt: string; approvedBy: string | null; approvedByName: string | null; approvedAt: string | null; version: number; updatedAt: string; id: string; } { return runSync(s, workflow.reviewDesign(queries, a, designId, b)); }
// Coordinator withdraws a submitted design back to draft (before the admin decision).
export function withdrawDesign(s:Store,a:User,designId:string,expectedVersion:number): { status: string; submittedAt: null; version: number; updatedAt: string; id: string; } { return runSync(s, workflow.withdrawDesign(queries, a, designId, expectedVersion)); }
