// Shared domain operations. Both SQLite and PostgreSQL execute this same workflow.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, text, shortText, uniqueIds, version, allow, fail, parseRow, matchVersion, now, type User, type Doc } from ".././core.js";
import { getDoc, audit, evidence } from "./core.js";
import { geometry, requireSiteCleared } from ".././data.js";
import { plantingItem, designCreate, designPatch, designReview } from "../designs.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../flow.js";

export function* design(s: FlowContext, designId: string): Flow<Doc> { return parseRow((yield* s.get('SELECT data FROM v2_designs WHERE id=?', designId)), 'Design'); }

export function* approvedRevision(s: FlowContext, designId: string, revision: number): Flow<Doc> {
    const row = (yield* s.get("SELECT data FROM v2_design_revisions WHERE design_id=? AND revision=? AND status='approved'", designId, revision));
    if (!row)
        fail('DESIGN_NOT_APPROVED', 'This exact design revision is not approved');
    return parseRow(row);
}

export function* validate(s: FlowContext, d: Record<string, any>): Flow<Doc> {
    const site = (yield* getDoc(s, 'site', d.siteId));
    const context = (yield* getDoc(s, 'context', site.contextId));
    if (context.version !== d.contextVersion)
        fail('CONTEXT_CHANGED', 'Design must reference the current site context version');
    if (new Set(d.plantingItems.map((i: any) => i.id)).size !== d.plantingItems.length)
        fail('DUPLICATE_PLANTING_ITEM', 'Planting item IDs must be unique', 400);
    (yield* evidence(s, d.evidenceIds));
    for (const item of d.plantingItems) {
        (yield* getDoc(s, 'catalog', item.catalogItemId));
        (yield* evidence(s, item.evidenceIds));
        if (item.carePolicyId)
            (yield* getDoc(s, 'care_policy', item.carePolicyId));
    }
    return site;
}

export function* save(s: FlowContext, d: Doc): Flow<Doc> {
    (yield* s.run('UPDATE v2_designs SET revision=?,status=?,version=?,data=? WHERE id=?', d.revision, d.status, d.version, JSON.stringify(d), d.id));
    (yield* s.run('INSERT INTO v2_design_revisions VALUES (?,?,?,?) ON CONFLICT(design_id,revision) DO UPDATE SET status=excluded.status,data=excluded.data', d.id, d.revision, d.status, JSON.stringify(d)));
    return d;
}

export function* createDesign(s: FlowContext, a: User, b: z.infer<typeof designCreate>): Flow<{ id: `${string}-${string}-${string}-${string}-${string}`; revision: number; status: string; version: number; createdBy: string; createdByName: string; createdAt: string; updatedAt: string; checkSnapshot: any; siteVersion: number; estimatedCost: null; costCompleteness: string; season: string | null; exclusionZones: ({ type: "Point"; coordinates: [number, number]; } | { type: "MultiPoint"; coordinates: [number, number][]; } | { type: "Polygon"; coordinates: [number, number][][]; })[]; sourcePhotoIds: string[]; name: string; objective: string; contextVersion: number; plantingItems: { id: string; catalogItemId: string; geometry: { type: "Point"; coordinates: [number, number]; } | { type: "MultiPoint"; coordinates: [number, number][]; } | { type: "Polygon"; coordinates: [number, number][][]; }; quantity: number | null; quantityMethod: string | null; spacingM: number | null; bedAreaM2: number | null; phase: string | null; carePolicyId: string | null; evidenceIds: string[]; kind?: "point" | "bed" | undefined; note?: string | undefined; origin?: "manual" | "suggested" | undefined; conflicts?: { type: "exclusion_zone" | "outside_site" | "near_building"; message: string; resolution: string | null; }[] | undefined; }[]; evidenceIds: string[]; siteId: string; }> {
    allow(a, 'coordinator');
    const site = (yield* validate(s, b));
    const d = { ...b, id: randomUUID(), revision: 1, status: 'draft', version: 1, createdBy: a.id, createdByName: a.displayName, createdAt: now(), updatedAt: now(), checkSnapshot: site.checks, siteVersion: site.version, estimatedCost: null, costCompleteness: 'unknown' };
    (yield* s.run('INSERT INTO v2_designs VALUES (?,?,1,\'draft\',1,?)', d.id, d.siteId, JSON.stringify(d)));
    (yield* save(s, d));
    (yield* audit(s, a, 'design', d.id, 'create', null, d));
    return d;
}

export function* patchDesign(s: FlowContext, a: User, designId: string, b: z.infer<typeof designPatch>): Flow<Doc> {
    allow(a, 'coordinator');
    const before = (yield* design(s, designId));
    matchVersion(before, b.expectedVersion);
    if (before.status === 'submitted')
        fail('DESIGN_UNDER_REVIEW', 'Request changes before editing a submitted design');
    const { expectedVersion, ...patch } = b;
    const after: Doc = { ...before, ...patch, revision: before.revision + (before.status === 'approved' ? 1 : 0), status: 'draft', version: before.version + 1, updatedAt: now(), submittedAt: null, approvedBy: null, approvedAt: null, reviewComment: null };
    const site = (yield* validate(s, after));
    after.checkSnapshot = site.checks;
    after.siteVersion = site.version;
    (yield* save(s, after));
    (yield* audit(s, a, 'design', designId, 'edit', before, after));
    return after;
}

export function* submitDesign(s: FlowContext, a: User, designId: string, expectedVersion: number): Flow<{ status: string; checkSnapshot: any; siteVersion: number; submittedAt: string; version: number; updatedAt: string; id: string; }> {
    allow(a, 'coordinator');
    const before = (yield* design(s, designId));
    matchVersion(before, expectedVersion);
    if (!['draft', 'changes_requested'].includes(before.status))
        fail('INVALID_TRANSITION', 'Only drafts or requested changes can be submitted');
    if (!before.plantingItems.length)
        fail('DESIGN_EMPTY', 'Add at least one planting item before submitting', 400);
    const site = (yield* validate(s, before));
    const after = { ...before, status: 'submitted', checkSnapshot: site.checks, siteVersion: site.version, submittedAt: now(), version: before.version + 1, updatedAt: now() };
    (yield* save(s, after));
    (yield* audit(s, a, 'design', designId, 'submit', before, after));
    return after;
}

export function* reviewDesign(s: FlowContext, a: User, designId: string, b: z.infer<typeof designReview>): Flow<{ status: "approved" | "changes_requested"; reviewComment: string; reviewedBy: string; reviewedByName: string; reviewedAt: string; approvedBy: string | null; approvedByName: string | null; approvedAt: string | null; version: number; updatedAt: string; id: string; }> {
    allow(a, 'admin');
    const before = (yield* design(s, designId));
    matchVersion(before, b.expectedVersion);
    if (before.status !== 'submitted')
        fail('INVALID_TRANSITION', 'Only submitted designs can be reviewed');
    const site = (yield* validate(s, before));
    if (b.decision === 'approved') {
        requireSiteCleared(site);
        if (site.version !== before.siteVersion)
            fail('SITE_CHANGED', 'Resubmit the project with current site checks');
        for (const item of before.plantingItems) {
            if (item.quantity === null || !item.quantityMethod)
                fail('QUANTITY_UNKNOWN', 'Known sourced quantities required for approval');
        }
    }
    const after = { ...before, status: b.decision, reviewComment: b.comment, reviewedBy: a.id, reviewedByName: a.displayName, reviewedAt: now(), approvedBy: b.decision === 'approved' ? a.id : null, approvedByName: b.decision === 'approved' ? a.displayName : null, approvedAt: b.decision === 'approved' ? now() : null, version: before.version + 1, updatedAt: now() };
    (yield* save(s, after));
    (yield* audit(s, a, 'design', designId, b.decision, before, after));
    return after;
}

// Coordinator withdraws a submitted design back to draft (before the admin decision).
export function* withdrawDesign(s: FlowContext, a: User, designId: string, expectedVersion: number): Flow<{ status: string; submittedAt: null; version: number; updatedAt: string; id: string; }> {
    allow(a, 'coordinator');
    const before = (yield* design(s, designId));
    matchVersion(before, expectedVersion);
    if (before.status !== 'submitted')
        fail('INVALID_TRANSITION', 'Only a submitted design can be withdrawn');
    const after = { ...before, status: 'draft', submittedAt: null, version: before.version + 1, updatedAt: now() };
    (yield* save(s, after));
    (yield* audit(s, a, 'design', designId, 'withdraw', before, after));
    return after;
}
