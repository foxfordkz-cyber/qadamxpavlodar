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
export function profile(s:Store,userId:string) { const r=s.get('SELECT data FROM v2_profiles WHERE user_id=?',userId); return r?parseRow(r):null; }
function saveProfile(s:Store,userId:string,input:z.infer<typeof profileInput>) { const old=profile(s,userId); const p={...input,userId,version:(old?.version??0)+1};
  s.run('INSERT INTO v2_profiles VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,version=excluded.version',userId,JSON.stringify(p),p.version); }
export function createUser(s:Store,a:User,b:z.infer<typeof userCreate>,passwordHash:string) {
  allow(a,'admin'); if(s.get('SELECT id FROM v2_users WHERE login=? COLLATE NOCASE',b.login))fail('LOGIN_EXISTS','Login is already in use');
  const role=canonicalRole(b.role),userId=randomUUID(); s.run('INSERT INTO v2_users VALUES (?,?,?,?,1,?,1,?,?)',userId,b.login,b.displayName,role==='viewer'?'coordinator':role,passwordHash,now(),now());
  if(role==='viewer')s.run('INSERT INTO municipal_roles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role',userId,role);
  if(b.profile)saveProfile(s,userId,b.profile);
  const user=getUser(s,userId); audit(s,a,'user',userId,'create',null,user); return user;
}
export function patchUser(s:Store,a:User,userId:string,b:z.infer<typeof userPatch>,passwordHash?:string) {
  allow(a,'admin'); const before=getUser(s,userId); matchVersion(before,b.expectedVersion);
  if(userId===a.id&&(b.role!==undefined||b.active===false))fail('SELF_PRIVILEGE_CHANGE','Cannot change your own role or disable yourself',403);
  if(b.role&&b.role!==before.role&&(s.get('SELECT id FROM v2_crews WHERE foreman_id=? AND active=1',userId)||s.get('SELECT id FROM v2_memberships WHERE user_id=? AND active=1',userId)))fail('CREW_ROLE_IN_USE','Remove active crew responsibilities before changing role');
  const after={...before,displayName:b.displayName??before.displayName,role:canonicalRole(b.role??before.role),active:b.active??before.active,version:before.version+1};
  s.run('UPDATE v2_users SET display_name=?,role=?,active=?,version=?,password_hash=COALESCE(?,password_hash),updated_at=? WHERE id=?',after.displayName,['specialist','viewer'].includes(after.role)?'coordinator':after.role,after.active?1:0,after.version,passwordHash??null,now(),userId);
  if(b.role){if(after.role==='viewer')s.run('INSERT INTO municipal_roles VALUES (?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role',userId,after.role);else s.run('DELETE FROM municipal_roles WHERE user_id=?',userId);}
  if(b.profile)saveProfile(s,userId,b.profile);
  s.run('DELETE FROM v2_sessions WHERE user_id=?',userId);
  audit(s,a,'user',userId,'update',before,{...after,profile:b.profile?profile(s,userId):undefined,credentialsChanged:!!passwordHash}); return after;
}
export function crew(s:Store,crewId:string) { return parseRow(s.get('SELECT data FROM v2_crews WHERE id=?',crewId),'Crew'); }
export function isMember(s:Store,crewId:string,userId:string,start=now(),end=start) {
  const c=crew(s,crewId); if(c.foremanId===userId)return true;
  return !!s.get('SELECT id FROM v2_memberships WHERE crew_id=? AND user_id=? AND active=1 AND valid_from<=? AND (valid_until IS NULL OR valid_until>=?)',crewId,userId,start,end);
}
export function canCrew(s:Store,a:User,c:Doc) { return a.role==='admin'||a.role==='coordinator'||a.role==='specialist'||(a.role==='foreman'&&c.foremanId===a.id)||(a.role==='worker'&&isMember(s,c.id,a.id)); }
export function ownCrew(s:Store,a:User,crewId:string) { const c=crew(s,crewId); if(!canCrew(s,a,c))fail('NOT_FOUND','Crew not found',404); return c; }
function checkForeman(s:Store,userId:string) { const u=getUser(s,userId);if(!u.active||u.role!=='foreman')fail('INVALID_FOREMAN','An active foreman is required',400); }
function checkResources(s:Store,ids:string[]) { for(const resourceId of ids)getDoc(s,'resource',resourceId); }
function persistCrew(s:Store,c:Doc) { s.run('UPDATE v2_crews SET name=?,foreman_id=?,active=?,data=?,version=? WHERE id=?',c.name,c.foremanId,c.active?1:0,JSON.stringify(c),c.version,c.id); }
export function createCrew(s:Store,a:User,b:z.infer<typeof crewCreate>) {
  allow(a,'admin');checkForeman(s,b.foremanId);checkResources(s,b.resourceIds);
  const c={...b,id:randomUUID(),active:true,version:1};s.run('INSERT INTO v2_crews VALUES (?,?,?,1,?,1)',c.id,c.name,c.foremanId,JSON.stringify(c));audit(s,a,'crew',c.id,'create',null,c);return c;
}
export function patchCrew(s:Store,a:User,crewId:string,b:z.infer<typeof crewPatch>) {
  allow(a,'admin');const before=crew(s,crewId);matchVersion(before,b.expectedVersion);
  if(b.foremanId)checkForeman(s,b.foremanId);if(b.resourceIds)checkResources(s,b.resourceIds);
  const {expectedVersion,...patch}=b;const after={...before,...patch,version:before.version+1};persistCrew(s,after);audit(s,a,'crew',crewId,'update',before,after);return after;
}
export function membership(s:Store,a:User,crewId:string,b:z.infer<typeof membershipInput>) {
  allow(a,'admin');const before=crew(s,crewId);matchVersion(before,b.expectedVersion);const u=getUser(s,b.userId);
  if(u.role!=='worker'||!u.active)fail('INVALID_MEMBER','An active worker is required',400);
  const at=now(),from=b.validFrom??at,until=b.validUntil??null;
  if(from>at||(until&&until<=at)||(until&&until<=from))fail('INVALID_MEMBERSHIP_INTERVAL','P0 membership must be effective now; end must follow start',400);
  const existing=s.get('SELECT * FROM v2_memberships WHERE user_id=? AND active=1',u.id);
  if(b.active&&existing)fail('ALREADY_MEMBER','Worker already has an active crew');
  if(!b.active&&(!existing||existing.crew_id!==crewId))fail('NOT_MEMBER','No active membership in this crew');
  if(b.active)s.run('INSERT INTO v2_memberships VALUES (?,?,?,?,?,1)',randomUUID(),crewId,u.id,from,until);
  else s.run('UPDATE v2_memberships SET active=0,valid_until=? WHERE id=?',at,existing!.id!);
  const after={...before,version:before.version+1};persistCrew(s,after);audit(s,a,'crew',crewId,b.active?'add_member':'remove_member',before,{...after,userId:u.id,at});return {...after,members:members(s,crewId)};
}
export function members(s:Store,crewId:string) { return s.all('SELECT * FROM v2_memberships WHERE crew_id=? ORDER BY valid_from,id',crewId).map(r=>({id:r.id,crewId:r.crew_id,userId:r.user_id,validFrom:r.valid_from,validUntil:r.valid_until,active:r.active===1})); }
export function listUsers(s:Store,a:User) { allow(a,'admin');return s.all('SELECT u.*,r.role AS municipal_role FROM v2_users u LEFT JOIN municipal_roles r ON r.user_id=u.id ORDER BY u.id').map(r=>({...userDto(r),profile:profile(s,String(r.id))})); }
export function workers(s:Store,a:User) {
  return s.all("SELECT * FROM v2_users WHERE role IN ('worker','foreman') ORDER BY id").map(userDto).filter(u=>a.role==='admin'||a.role==='coordinator'||a.role==='specialist'||u.id===a.id||
    (a.role==='foreman'&&s.all('SELECT id FROM v2_crews WHERE foreman_id=? AND active=1',a.id).some(c=>isMember(s,String(c.id),u.id))))
    .map(u=>({...u,profile:profile(s,u.id)}));
}
