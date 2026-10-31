import type { Store } from '../db.js';
import { allow, mutate, listDocs, type User, type Doc } from './core.js';
import { actor } from './auth.js';
import { resourceInput, resourcePatch, evidenceInput, listQuery, page, createData, patchData } from './data.js';
import { param, type Api } from './api-contract.js';

export type ReferenceKind = 'resource' | 'evidence';
export type ReferenceMutation = { actor: User; method: string; path: string; key: string | undefined;
  kind: ReferenceKind; id?: string; body: Record<string, any>; status: number };
export type MutationResult = { status: number; body: unknown; replayed: boolean };
export interface ReferenceRepository {
  list(kind: ReferenceKind): Promise<Doc[]>;
  mutate(input: ReferenceMutation): Promise<MutationResult>;
}
export function authorizeReference(a: User, kind: ReferenceKind) {
  if (kind === 'resource') allow(a, 'admin'); else allow(a, 'admin', 'coordinator');
}
export class SqliteReferenceRepository implements ReferenceRepository {
  constructor(private readonly s: Store) {}
  async list(kind: ReferenceKind) { return listDocs(this.s, kind); }
  async mutate(input: ReferenceMutation) {
    const { actor: a, method, path, key, body, status, kind, id } = input;
    return mutate(this.s, a, method, path, key, body, status, () => authorizeReference(a, kind),
      () => id ? patchData(this.s, a, kind, id, body) : createData(this.s, a, kind, body));
  }
}
// One set of HTTP handlers and schemas for both adapters; unsupported cloud domains are not registered.
export function referenceDataRoutes(api: Pick<Api, 'route'>, repository: ReferenceRepository) {
  for (const [kind, path, input, patch] of [
    ['resource', '/resources', resourceInput, resourcePatch], ['evidence', '/evidence', evidenceInput, null]
  ] as const) {
    api.route({ method: 'get', path, query: listQuery, summary: `Read ${kind} with sources; worker catalog is scoped to assigned approved revisions` }, async (req, res) => {
      allow(actor(res), 'admin', 'coordinator', 'viewer', 'foreman');
      res.json(page(await repository.list(kind), req.query));
    });
    for (const updating of patch ? [false, true] : [false]) {
      api.route({ method: updating ? 'patch' : 'post', path: updating ? path + '/:id' : path,
        input: updating ? patch! : input, status: updating ? 200 : 201, idempotent: true,
        summary: updating ? `Update ${kind} with expectedVersion` : `Create ${kind}` }, async (req, res) => {
        const body = (updating ? patch! : input).parse(req.body);
        const result = await repository.mutate({ actor: actor(res), method: req.method, path: req.path,
          key: req.get('Idempotency-Key'), kind, id: updating ? param(req) : undefined, body, status: updating ? 200 : 201 });
        res.set('Idempotency-Replayed', String(result.replayed)).status(result.status).json(result.body);
      });
    }
  }
}
