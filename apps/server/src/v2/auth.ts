import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type { Request, Response, RequestHandler } from 'express';
import { z } from 'zod';
import { Store } from '../db.js';
import { fail, now, userDto, type User } from './core.js';

import { authRepository, type AuthRepository } from './auth-repository.js';

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
export function authenticate(s:Store | AuthRepository):RequestHandler { const repository=authRepository(s); return async(req,res,next)=>{
  try {
    const token=sessionToken(req);
    const row=token?await repository.session(digest(token),now()):undefined;
    if(!row) fail('AUTH_REQUIRED','Sign in with a server session',401);
    res.locals.v2user=userDto(row!); res.locals.v2session=row!.token_hash; res.locals.csrf=row!.csrf_token;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)) {
      const submitted=req.get('X-CSRF-Token')??''; const expected=String(row!.csrf_token);
      if(!/^[0-9a-f]{64}$/.test(submitted)||!timingSafeEqual(Buffer.from(submitted),Buffer.from(expected))) fail('CSRF_REQUIRED','Supply the session X-CSRF-Token',403);
    }
    next();
  } catch(error){next(error);}
}; }
export async function login(s:Store | AuthRepository,req:Request,res:Response,secureCookies=false) {
  const repository=authRepository(s),body=loginInput.parse(req.body),at=Date.now();
  await repository.attempts([{key:digest(`ip:${req.ip}`),limit:100},{key:digest(`login:${body.login}`),limit:10}],at);
  const row=await repository.credentials(body.login);
  const dummy='scrypt32768$00000000000000000000000000000000$'+'00'.repeat(32);
  const valid=await verify(body.password,row?String(row.password_hash):dummy);
  if(!row||!valid||row.active!==1) fail('INVALID_CREDENTIALS','Invalid login or password',401);
  const token=randomBytes(32).toString('hex'),csrf=randomBytes(32).toString('hex'),old=sessionToken(req);
  const expiresAt=new Date(at+duration).toISOString();
  const user=await repository.finishLogin(row!,old?digest(old):undefined,{tokenHash:digest(token),csrf,createdAt:now(),expiresAt,at});
  res.cookie(COOKIE,token,{...cookieOptions,secure:secureCookies,maxAge:duration});
  return {user,csrfToken:csrf,expiresAt,mode:'DEMO'};
}
export async function logout(s:Store | AuthRepository,res:Response,secureCookies=false) {
  await authRepository(s).logout(res.locals.v2session);
  res.clearCookie(COOKIE,{...cookieOptions,secure:secureCookies});return {loggedOut:true};
}
export const actor = (res:Response):User => res.locals.v2user as User;
