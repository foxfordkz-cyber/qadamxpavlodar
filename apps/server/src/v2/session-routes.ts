import { z } from 'zod';
import type { Store } from '../db.js';
import type { AuthRepository } from './auth-repository.js';
import { authenticate, actor, login, logout, loginInput } from './auth.js';
import type { Api } from './router.js';

export function sessionRoutes(s: Store | AuthRepository, api: Pick<Api, 'route' | 'router'>, secureCookies=false) {
  const { route, router } = api;
  route({method:'post',path:'/auth/login',input:loginInput,public:true,summary:'Login with password; rotate persistent server session'},async(req,res)=>res.json({data:await login(s,req,res,secureCookies)}));
  router.use(authenticate(s));
  route({method:'get',path:'/auth/me',summary:'Current server identity and CSRF token'},(_req,res)=>res.json({data:{user:actor(res),csrfToken:res.locals.csrf}}));
  route({method:'post',path:'/auth/logout',input:z.object({}).strict(),summary:'Revoke the current session'},async(req,res)=>{z.object({}).strict().parse(req.body);res.json({data:await logout(s,res,secureCookies)});});
}
