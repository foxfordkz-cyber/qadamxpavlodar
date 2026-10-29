import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { Store } from '../db.js';
import { fail, now, userDto, type User } from './core.js';

export const COOKIE = 'gp_v2_session';
const cookieOptions = { httpOnly:true, sameSite:'strict' as const, secure:false, path:'/api/v1' };
const duration = 8*3600_000;
const digest = (token:string)=>createHash('sha256').update(token).digest('hex');
const derive = (password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,32,
  { N:32768,r:8,p:1,maxmem:64*1024*1024 },(error,key)=>error?reject(error):resolve(key)));
export const password = z.string().min(12).max(128);
export const loginInput = z.object({login:z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,80}$/),password:z.string().min(1).max(128)}).strict();
export async function hashPassword(value:string) { const salt=randomBytes(16).toString('hex'); return `scrypt32768$${salt}$${(await derive(value,salt)).toString('hex')}`; }
async function verify(value:string,stored:string) {
  const [kind,salt,key]=stored.split('$');
  if(kind!=='scrypt32768'||!salt||!key) return false;
  const actual=await derive(value,salt); const expected=Buffer.from(key,'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
function sessionToken(req:Request) {
  const values=(req.get('Cookie')??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${COOKIE}=`));
  if(values.length!==1) return undefined;
  const value=values[0]!.slice(COOKIE.length+1); return /^[0-9a-f]{64}$/.test(value)?value:undefined;
}
export function authenticate(s:Store):RequestHandler { return(req,res,next)=>{
  try {
    const token=sessionToken(req);
    const row=token?s.get(`SELECT u.*,s.csrf_token,s.token_hash,s.expires_at FROM v2_sessions s JOIN v2_users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1`,digest(token),now()):undefined;
    if(!row) fail('AUTH_REQUIRED','Sign in with a server session',401);
    res.locals.v2user=userDto(row!); res.locals.v2session=row!.token_hash; res.locals.csrf=row!.csrf_token;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const submitted=req.get('X-CSRF-Token')??''; const expected=String(row!.csrf_token);
      if(!/^[0-9a-f]{64}$/.test(submitted)||!timingSafeEqual(Buffer.from(submitted),Buffer.from(expected))) fail('CSRF_REQUIRED','Supply the session X-CSRF-Token',403);
    }
    next();
  } catch(error){next(error);}
}; }
export async function login(s:Store,req:Request,res:Response) {
  const body=loginInput.parse(req.body); const at=Date.now();
  // Persistent bounded IP/account throttling; errors do not reveal account existence.
  for(const bucket of [`ip:${req.ip}`,`login:${body.login}`]) {
    const key=digest(bucket); const row=s.get('SELECT * FROM v2_login_attempts WHERE key=?',key);
    if(row&&Number(row.reset_at)>at&&Number(row.count)>=(bucket.startsWith('ip:')?100:10)) fail('LOGIN_RATE_LIMIT','Too many attempts; retry in 15 minutes',429);
    s.run(`INSERT INTO v2_login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset_at<=? THEN 1 ELSE count+1 END,
      reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END`,key,at+900_000,at,at);
  }
  const row=s.get('SELECT * FROM v2_users WHERE login=? COLLATE NOCASE',body.login);
  const dummy='scrypt32768$00000000000000000000000000000000$'+'00'.repeat(32);
  const valid=await verify(body.password,row?String(row.password_hash):dummy);
  if(!row||!valid||row.active!==1) fail('INVALID_CREDENTIALS','Invalid login or password',401);
  // Re-read after asynchronous hashing: disabling/changing credentials revokes an in-flight login.
  const current=s.get('SELECT * FROM v2_users WHERE id=?',row!.id!);
  if(!current||current.active!==1||current.version!==row!.version||current.password_hash!==row!.password_hash) fail('INVALID_CREDENTIALS','Invalid login or password',401);
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex');
  s.transaction(()=>{
    const old=sessionToken(req); if(old)s.run('DELETE FROM v2_sessions WHERE token_hash=?',digest(old));
    s.run('DELETE FROM v2_sessions WHERE expires_at<=?',now());
    s.run('DELETE FROM v2_login_attempts WHERE reset_at<=?',at);
    s.run('INSERT INTO v2_sessions VALUES (?,?,?,?,?)',digest(token),current!.id!,csrf,now(),new Date(at+duration).toISOString());
  });
  res.cookie(COOKIE,token,{...cookieOptions,maxAge:duration});
  return {user:userDto(current!),csrfToken:csrf,expiresAt:new Date(at+duration).toISOString(),mode:'DEMO'};
}
export function logout(s:Store,res:Response) { s.run('DELETE FROM v2_sessions WHERE token_hash=?',res.locals.v2session); res.clearCookie(COOKIE,cookieOptions); return {loggedOut:true}; }
export const actor = (res:Response):User => res.locals.v2user as User;
