// HTTP bindings use the existing schemas and shared domain operations; no cloud-specific workflow rules.
import { z } from 'zod';
import { type Request, type Response } from 'express';
import { actor,hashPassword } from '../v2/auth.js';
import { allow,expected,parseRow,fail,id,timestamp,type User,type Kind } from '../v2/core.js';
import { param,type Operation,type Api } from '../v2/api-contract.js';
import { queries as s,type Flow,flowMap,flowFilter,flowSome,flowEvery,flowFind } from '../v2/flow.js';
import {getDoc,listDocs} from '../v2/flows/core.js';
import {task,canTask,authorizeForeman} from '../v2/flows/tasks.js';
import {page} from '../v2/data.js';
import { runPostgres } from './workflow-store.js';
import { PostgresWorkflowRepository } from './workflow-repository.js';
import * as dataSchema from '../v2/data.js';
import * as dataFlow from '../v2/flows/data.js';
const d={...dataSchema,...dataFlow};
import * as peopleSchema from '../v2/people.js';
import * as peopleFlow from '../v2/flows/people.js';
const people={...peopleSchema,...peopleFlow};
import * as designsSchema from '../v2/designs.js';
import * as designsFlow from '../v2/flows/designs.js';
const designs={...designsSchema,...designsFlow};
import * as tasksSchema from '../v2/tasks.js';
import * as tasksFlow from '../v2/flows/tasks.js';
const tasks={...tasksSchema,...tasksFlow};
import * as reportsSchema from '../v2/reports.js';
import * as reportsFlow from '../v2/flows/reports.js';
const reports={...reportsSchema,...reportsFlow};
export function domainRoutes(api: WorkflowApi) {
    const { route, write } = api;
    const managers = (a: User) => allow(a, 'admin', 'coordinator'), coordinator = (a: User) => allow(a, 'coordinator'), admin = (a: User) => allow(a, 'admin');
    function* visible(a: User, kind: Kind, objectId: string): Flow<any> {
        if (a.role === 'admin' || a.role === 'coordinator' || a.role === 'specialist' || a.role === 'viewer')
            return true;
        return (yield* flowSome((yield* tasks.allTasks(s)), function* (t: any): Flow<any> {
            return (yield* tasks.canTask(s, a, t)) && t.objectType === (kind === 'plant' ? 'plant' : 'candidate_site') && t.objectId === objectId;
        }));
    }
    function* requireVisible(a: User, kind: Kind, objectId: string): Flow<any> { if (!(yield* visible(a, kind, objectId)))
        fail('NOT_FOUND', 'Object not found', 404); }
    route({ method: 'get', path: '/plants', summary: 'V2 plants; workers see only assigned object context' }, function* (req: any, res: any): Flow<any> {
        const q = d.listQuery.extend({ condition: z.enum(['unknown', 'observed_ok', 'needs_inspection', 'attention']).optional() }).parse(req.query);
        const items = (yield* flowFilter((yield* listDocs(s, 'plant')), function* (p: any): Flow<any> {
            return (yield* visible(actor(res), 'plant', p.id)) && (!q.condition || p.condition === q.condition);
        }));
        res.json(d.page(items, { limit: q.limit, offset: q.offset }));
    });
    route({ method: 'get', path: '/plants/geojson', summary: 'V2 map points, coordinates [lng,lat]' }, function* (req: any, res: any): Flow<any> {
        const result = d.page((yield* flowFilter((yield* listDocs(s, 'plant')), function* (p: any): Flow<any> {
            return (yield* visible(actor(res), 'plant', p.id));
        })), req.query);
        res.json({ data: { type: 'FeatureCollection', features: result.data.map(p => ({ type: 'Feature', id: p.id, geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: p })) }, meta: result.meta });
    });
    route({ method: 'get', path: '/plants/:id', summary: 'Plant detail' }, function* (req: any, res: any): Flow<any> { (yield* requireVisible(actor(res), 'plant', param(req))); res.json({ data: (yield* getDoc(s, 'plant', param(req))) }); });
    write({ method: 'post', path: '/plants', input: d.plantInput, status: 201, summary: 'Coordinator: register a sourced DEMO plant' }, coordinator, function* (a: any, b: any): Flow<any> {
        return (yield* d.createData(s, a, 'plant', b));
    });
    write({ method: 'patch', path: '/plants/:id', input: d.plantPatch, summary: 'Coordinator: update a plant with expectedVersion' }, coordinator, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* d.patchData(s, a, 'plant', param(req), b));
    });
    route({ method: 'get', path: '/sites', summary: 'Role-scoped candidate sites and explicit checks' }, function* (req: any, res: any): Flow<any> {
        return res.json(d.page((yield* flowFilter((yield* listDocs(s, 'site')), function* (p: any): Flow<any> {
            return (yield* visible(actor(res), 'site', p.id));
        })), req.query));
    });
    route({ method: 'get', path: '/sites/:id', summary: 'Site detail' }, function* (req: any, res: any): Flow<any> { (yield* requireVisible(actor(res), 'site', param(req))); res.json({ data: (yield* getDoc(s, 'site', param(req))) }); });
    write({ method: 'patch', path: '/sites/:id', input: d.sitePatch, summary: 'Record human site checks with server reviewer and time' }, managers, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* d.patchData(s, a, 'site', param(req), b));
    });
    route({ method: 'get', path: '/sites/:id/context', summary: 'Stored context with provenance; no live mapping claim' }, function* (req: any, res: any): Flow<any> { (yield* requireVisible(actor(res), 'site', param(req))); const site = (yield* getDoc(s, 'site', param(req))); res.json({ data: (yield* getDoc(s, 'context', site.contextId)) }); });
    for (const [kind, path, input, patch, authorize] of [
        ['catalog', '/plant-catalog', d.catalogInput, d.catalogPatch, managers],
        ['care_policy', '/care-policies', d.carePolicyInput, null, managers]
    ] as const) {
        route({ method: 'get', path, query: d.listQuery, summary: `Read ${kind} with sources; worker catalog is scoped to assigned approved revisions` }, function* (req: any, res: any): Flow<any> {
            const a = actor(res);
            allow(a, 'admin', 'coordinator', 'viewer', 'foreman', ...(kind === 'catalog' ? ['worker' as const] : []));
            let rows = (yield* listDocs(s, kind));
            if (a.role === 'worker') {
                const catalogIds = new Set<string>();
                for (const t of (yield* flowFilter((yield* tasks.allTasks(s)), function* (t: any): Flow<any> {
                    return (yield* tasks.canTask(s, a, t)) && t.approvedDesignId && t.approvedDesignVersion;
                }))) {
                    const revision = (yield* designs.approvedRevision(s, t.approvedDesignId, t.approvedDesignVersion));
                    for (const item of revision.plantingItems)
                        catalogIds.add(item.catalogItemId);
                }
                rows = rows.filter(row => catalogIds.has(row.id));
            }
            res.json(d.page(rows, req.query));
        });
        write({ method: 'post', path, input, status: 201, summary: `Create ${kind}` }, authorize, function* (a: any, b: any): Flow<any> {
            return (yield* d.createData(s, a, kind, b));
        });
        if (patch)
            write({ method: 'patch', path: path + '/:id', input: patch, summary: `Update ${kind} with expectedVersion` }, authorize, function* (a: any, b: any, req: any): Flow<any> {
                return (yield* d.patchData(s, a, kind, param(req), b));
            });
    }
    function* designAccess(a: User, designId: string): Flow<any> {
        if (a.role === 'admin' || a.role === 'coordinator' || a.role === 'specialist' || a.role === 'viewer')
            return;
        if (!(yield* flowSome((yield* tasks.allTasks(s)), function* (t: any): Flow<any> {
            return t.approvedDesignId === designId && (yield* tasks.canTask(s, a, t));
        })))
            fail('NOT_FOUND', 'Design not found', 404);
    }
    route({ method: 'get', path: '/designs', summary: 'Coordinator/admin/viewer: design proposals' }, function* (req: any, res: any): Flow<any> { allow(actor(res), 'admin', 'coordinator', 'viewer'); res.json(d.page((yield* s.all('SELECT data FROM v2_designs ORDER BY id')).map(r => parseRow(r)), req.query)); });
    route({ method: 'get', path: '/designs/:id', summary: 'Design with immutable approved revisions' }, function* (req: any, res: any): Flow<any> {
        (yield* designAccess(actor(res), param(req)));
        const revisions = (yield* s.all('SELECT data FROM v2_design_revisions WHERE design_id=? ORDER BY revision', param(req))).map(r => parseRow(r));
        if (['admin', 'coordinator', 'specialist', 'viewer'].includes(actor(res).role))
            res.json({ data: { ...(yield* designs.design(s, param(req))), revisions } });
        else {
            const allowed = (yield* flowFilter((yield* tasks.allTasks(s)), function* (t: any): Flow<any> {
                return t.approvedDesignId === param(req) && (yield* tasks.canTask(s, actor(res), t));
            })).map(t => t.approvedDesignVersion);
            res.json({ data: { id: param(req), revisions: revisions.filter(r => allowed.includes(r.revision)) } });
        }
    });
    write({ method: 'post', path: '/designs', input: designs.designCreate, status: 201, summary: 'Coordinator: create a design draft' }, coordinator, function* (a: any, b: any): Flow<any> {
        return (yield* designs.createDesign(s, a, b));
    });
    write({ method: 'patch', path: '/designs/:id', input: designs.designPatch, summary: 'Edit; approved design creates a new revision' }, coordinator, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* designs.patchDesign(s, a, param(req), b));
    });
    write({ method: 'post', path: '/designs/:id/submit', input: expected, summary: 'Coordinator: submit exact design version' }, coordinator, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* designs.submitDesign(s, a, param(req), b.expectedVersion));
    });
    write({ method: 'post', path: '/designs/:id/withdraw', input: expected, summary: 'Coordinator: withdraw a submitted design back to draft' }, coordinator, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* designs.withdrawDesign(s, a, param(req), b.expectedVersion));
    });
    write({ method: 'post', path: '/designs/:id/review', input: designs.designReview, summary: 'Admin: approve or request changes with comment' }, admin, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* designs.reviewDesign(s, a, param(req), b));
    });
    write({ method: 'post', path: '/designs/:id/create-tasks', input: tasks.designTasks, status: 201, summary: 'Coordinator: release approved revision once' }, coordinator, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* tasks.createDesignTasks(s, a, param(req), b));
    });
    route({ method: 'get', path: '/tasks', query: tasks.taskQuery, summary: 'Viewer reads all assignments; workers/foremen retain scope; date uses scheduledStart or dueAt in UTC+5 [start,end)' }, function* (req: any, res: any): Flow<any> {
        return res.json((yield* tasks.listTasks(s, actor(res), req.query)));
    });
    route({ method: 'get', path: '/tasks/:id', summary: 'Task detail with reports; viewer reads all, workers/foremen retain assignment scope' }, function* (req: any, res: any): Flow<any> { const task = (yield* tasks.task(s, actor(res), param(req))); res.json({ data: { ...task, reports: (yield* s.all('SELECT data FROM v2_reports WHERE task_id=? ORDER BY revision', task.id)).map(r => parseRow(r)) } }); });
    route({ method: 'get', path: '/tasks/:id/history', summary: 'Task change history with actor, time and snapshots' }, function* (req: any, res: any): Flow<any> { (yield* tasks.task(s, actor(res), param(req))); res.json({ data: (yield* s.all("SELECT * FROM v2_history WHERE entity_type='task' AND entity_id=? ORDER BY created_at,id", param(req))).map(r => ({ id: r.id, actorId: r.actor_id, action: r.action, before: r.before_json ? JSON.parse(String(r.before_json)) : null, after: JSON.parse(String(r.after_json)), createdAt: r.created_at })) }); });
    write({ method: 'post', path: '/tasks', input: tasks.taskCreate, status: 201, summary: 'Coordinator: create a manual care/inspection draft' }, coordinator, function* (a: any, b: any): Flow<any> {
        return (yield* tasks.insertTask(s, a, b));
    });
    write({ method: 'post', path: '/tasks/:id/assign', input: tasks.assignInput, summary: 'Coordinator: assign crew and interval, clear unconfirmed composition' }, coordinator, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* tasks.assign(s, a, param(req), b));
    });
    write({ method: 'post', path: '/tasks/:id/assign-workers', input: tasks.assignWorkersInput, summary: 'Own foreman: confirm active workers, skills and availability' }, function* (a: any, req: any): Flow<any> {
        return (yield* tasks.authorizeForeman(s, a, (yield* tasks.task(s, a, param(req)))));
    }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* tasks.assignWorkers(s, a, param(req), b));
    });
    write({ method: 'post', path: '/tasks/:id/start', input: expected, summary: 'Assigned executor or own foreman: start after revalidation' }, function* (a: any, req: any): Flow<any> { allow(a, 'worker', 'foreman'); (yield* tasks.task(s, a, param(req))); }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* tasks.start(s, a, param(req), b.expectedVersion));
    });
}
export function reportRoutes(api: WorkflowApi) {
    const { route, write } = api;

    route({ method: 'get', path: '/tasks/:id/report-draft', summary: 'Read group materials and draft version' }, function* (req: any, res: any): Flow<any> {
        return res.json({ data: (yield* reports.getDraft(s, actor(res), param(req))) });
    });
    write({ method: 'put', path: '/tasks/:id/report-draft', input: reports.draftInput, summary: 'Own foreman: save group report summary' }, function* (a: any, req: any): Flow<any> {
        return (yield* authorizeForeman(s, a, (yield* task(s, a, param(req)))));
    }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* reports.editDraft(s, a, param(req), b));
    });
    write({ method: 'post', path: '/tasks/:id/report-draft/contributions', input: reports.contributionInput, summary: 'Assigned participant: edit only own materials' }, function* (a: any, req: any): Flow<any> { allow(a, 'worker', 'foreman'); (yield* task(s, a, param(req))); }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* reports.contribute(s, a, param(req), b));
    });
    write({ method: 'post', path: '/tasks/:id/reports', input: reports.submitInput, status: 201, summary: 'Submit one report: own foreman for a group, assigned executor for solo task' }, function* (a: any, req: any): Flow<any> { allow(a, 'worker', 'foreman'); (yield* task(s, a, param(req))); }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* reports.submit(s, a, param(req), b, req.get('Idempotency-Key')!));
    });
    route({ method: 'get', path: '/reports', summary: 'Viewer reads all reports; workers/foremen retain task scope' }, function* (req: any, res: any): Flow<any> {
        const q = z.object({ reviewStatus: z.enum(['pending', 'accepted', 'changes_requested']).optional(), taskId: id.optional(), limit: z.coerce.number().int().min(1).max(200).default(100), offset: z.coerce.number().int().nonnegative().default(0) }).strict().parse(req.query);
        const rows = (yield* flowFilter((yield* s.all('SELECT data FROM v2_reports ORDER BY id')).map(r => parseRow(r)), function* (r: any): Flow<any> {
            return (yield* canTask(s, actor(res), parseRow((yield* s.get('SELECT data FROM v2_tasks WHERE id=?', r.taskId))))) && (!q.reviewStatus || r.reviewStatus === q.reviewStatus) && (!q.taskId || r.taskId === q.taskId);
        }));
        res.json(page(rows, { limit: q.limit, offset: q.offset }));
    });
    route({ method: 'get', path: '/reports/:id', summary: 'Read report within task scope; viewer allowed' }, function* (req: any, res: any): Flow<any> {
        return res.json({ data: (yield* reports.report(s, actor(res), param(req))) });
    });
    write({ method: 'post', path: '/reports/:id/review', input: reports.reviewInput, summary: 'Coordinator: accept or return; planting and care drafts committed atomically' }, function* (a: any, req: any): Flow<any> { allow(a, 'coordinator'); (yield* reports.report(s, a, param(req))); }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* reports.review(s, a, param(req), b));
    });
    write({ method: 'post', path: '/tasks/:id/issues', input: reports.issueInput, status: 201, summary: 'Record a field issue separately from completion' }, function* (a: any, req: any): Flow<any> { allow(a, 'worker', 'foreman', 'coordinator'); (yield* task(s, a, param(req))); }, function* (a: any, b: any, req: any): Flow<any> {
        return (yield* reports.issue(s, a, param(req), b));
    });
    route({ method: 'get', path: '/tasks/:id/issues', summary: 'Read issues and explicitly confirmed observations' }, function* (req: any, res: any): Flow<any> { (yield* task(s, actor(res), param(req))); res.json({ data: (yield* s.all('SELECT data FROM v2_issues WHERE task_id=? ORDER BY created_at,id', param(req))).map(r => parseRow(r)) }); });
    route({ method: 'get', path: '/plants/:id/care-history', summary: 'Accepted care events; inspection is not watering' }, function* (req: any, res: any): Flow<any> {
        allow(actor(res), 'admin', 'coordinator');
        res.json({ data: (yield* s.all('SELECT * FROM v2_care_events WHERE object_id=? ORDER BY reviewed_at,id', param(req))).map(r => ({ id: r.id, taskId: r.task_id, reportId: r.report_id, action: r.action, reviewedAt: r.reviewed_at, ...JSON.parse(String(r.data)) })) });
    });
    route({ method: 'get', path: '/dashboard', summary: 'Counts by accepted report reviewedAt; empty sample is explicit' }, function* (req: any, res: any): Flow<any> {
        allow(actor(res), 'admin', 'coordinator');
        const q = z.object({ from: timestamp, to: timestamp }).strict().refine(x => x.from < x.to, 'from must precede to').parse(req.query);
        const accepted = (yield* s.all('SELECT data FROM v2_reports WHERE status=\'accepted\'')).map(r => parseRow(r)).filter(r => r.reviewedAt >= q.from && r.reviewedAt < q.to);
        res.json({ data: { from: q.from, to: q.to, acceptedReports: accepted.length, empty: accepted.length === 0, definition: 'Accepted reports with reviewedAt in [from,to); pending reports excluded', method: 'database_count' } });
    });
}


type WorkflowApi={
  route:(op:Operation,handler:(req:Request,res:Response)=>Flow<unknown>)=>void;
  write:(op:Operation,authorize:(a:User,req:Request)=>Flow<unknown>|void,change:(a:User,b:any,req:Request)=>Flow<unknown>)=>void;
};
export function workflowRoutes(api:Pick<Api,'route'>,repo:PostgresWorkflowRepository) {
  const route:WorkflowApi['route']=(op,handler)=>api.route(op,async(req,res)=>{
    let output:unknown;
    const capture={locals:res.locals,json:(body:unknown)=>{output=body;return capture;}} as Response;
    await repo.readFlow(handler(req,capture));res.json(output);
  });
  const write:WorkflowApi['write']=(op,authorize,change)=>api.route({...op,idempotent:true},async(req,res)=>{
    const a=actor(res),b=op.input!.parse(req.body) as any;
    const result=await repo.mutate(a,req.method,req.path,req.get('Idempotency-Key'),b,op.status??200,
      async(current,c)=>{const check=authorize(current,req);if(check)await runPostgres(c,check);},
      c=>runPostgres(c,change(a,b,req)));
    res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
  });
  const admin=(a:User)=>allow(a,'admin');
  route({method:'get',path:'/users',summary:'Admin: public users and availability'},function*(_req,res){res.json({data:yield* people.listUsers(s,actor(res))});});
  for(const updating of [false,true]){
    const op:Operation={idempotent:true,method:updating?'patch':'post',path:updating?'/users/:id':'/users',status:updating?200:201,input:updating?people.userPatch:people.userCreate,summary:updating?'Admin: versioned user update; revoke sessions':'Admin: create account'};
    api.route(op,async(req,res)=>{
      const a=actor(res);admin(a);const b=op.input!.parse(req.body) as any;
      const passwordHash=b.password?await hashPassword(b.password):undefined;
      const result=await repo.mutate(a,req.method,req.path,req.get('Idempotency-Key'),b,op.status!,admin,
        c=>runPostgres(c,updating?people.patchUser(s,a,param(req),b,passwordHash):people.createUser(s,a,b,passwordHash!)));
      res.set('Idempotency-Replayed',String(result.replayed)).status(result.status).json(result.body);
    });
  }
  route({method:'get',path:'/workers',summary:'Viewer reads public employee DTOs; assignment scope retained'},function*(_req,res){res.json({data:yield* people.workers(s,actor(res))});});
  route({method:'get',path:'/crews',summary:'Scoped crews and membership history; viewer reads all'},function*(_req,res){
    const rows=[];for(const row of yield* s.all('SELECT data FROM v2_crews ORDER BY id')){
      const crew=parseRow(row);if(yield* people.canCrew(s,actor(res),crew))rows.push({...crew,members:yield* people.members(s,crew.id)});
    }res.json({data:rows});
  });
  write({method:'post',path:'/crews',input:people.crewCreate,status:201,summary:'Admin: create crew'},admin,(a,b)=>people.createCrew(s,a,b));
  write({method:'patch',path:'/crews/:id',input:people.crewPatch,summary:'Admin: update crew'},admin,(a,b,q)=>people.patchCrew(s,a,param(q),b));
  write({method:'post',path:'/crews/:id/members',input:people.membershipInput,summary:'Admin: effective membership with history'},admin,(a,b,q)=>people.membership(s,a,param(q),b));
  route({method:'get',path:'/users/:id/history',summary:'Admin: privilege audit'},function*(q,r){
    admin(actor(r));r.json({data:(yield* s.all("SELECT * FROM v2_history WHERE entity_type='user' AND entity_id=? ORDER BY created_at,id",param(q))).map(row=>({id:row.id,actorId:row.actor_id,action:row.action,before:row.before_json?JSON.parse(String(row.before_json)):null,after:JSON.parse(String(row.after_json)),createdAt:row.created_at}))});
  });
  domainRoutes({route,write});reportRoutes({route,write});
}
