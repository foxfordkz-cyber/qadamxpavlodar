// Shared domain operations. Both SQLite and PostgreSQL execute this same workflow.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, text, version, timestamp, uniqueIds, allow, fail, parseRow, matchVersion, now, type User, type Doc } from ".././core.js";
import { getDoc, audit, evidence, insertDoc, updateDoc } from "./core.js";
import { point, multiPoint } from ".././data.js";
import { task, saveTask, authorizeForeman, insertTask } from "./tasks.js";
import { approvedRevision } from "./designs.js";
import { validatePhotos } from "./uploads.js";
import { location, observation, actualItem, reportContent, submitInput, draftInput, contributionInput, reviewInput, issueInput } from "../reports.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../flow.js";

export function* report(s: FlowContext, a: User, reportId: string): Flow<Doc> { const r = parseRow((yield* s.get('SELECT data FROM v2_reports WHERE id=?', reportId)), 'Report'); (yield* task(s, a, r.taskId)); return r; }

export function* getDraft(s: FlowContext, a: User, taskId: string): Flow<Doc | { taskId: string; version: number; contributions: never[]; summary: null; }> { (yield* task(s, a, taskId)); const row = (yield* s.get('SELECT data FROM v2_report_drafts WHERE task_id=?', taskId)); return row ? parseRow(row) : { taskId, version: 0, contributions: [], summary: null }; }

export function* checkDraft(s: FlowContext, a: User, t: Doc, expectedVersion: number, expectedDraftVersion: number): Flow<Doc | { taskId: string; version: number; contributions: never[]; summary: null; }> { matchVersion(t, expectedVersion); if (t.status !== 'in_progress')
    fail('INVALID_TRANSITION', 'Materials can be edited only while in_progress'); const draft = (yield* getDraft(s, a, t.id)); matchVersion(draft, expectedDraftVersion); return draft; }

export function* storeDraft(s: FlowContext, d: Record<string, any>): Flow<Record<string, any>> { (yield* s.run('INSERT INTO v2_report_drafts VALUES (?,?,?) ON CONFLICT(task_id) DO UPDATE SET data=excluded.data,version=excluded.version', d.taskId, JSON.stringify(d), d.version)); return d; }

export function* confirmed(s: FlowContext, a: User, value: z.infer<typeof observation> | null | undefined): Flow<{ confirmedBy: string; confirmedAt: string; origin: string; category: "access_problem" | "visible_damage" | "care_completed" | "needs_inspection" | "other"; extractedFacts: string[]; proposedAction: "plant" | "inspect" | "water" | "weed" | null; evidenceIds: string[]; missingData: string[]; confirmed: true; } | null> { if (!value)
    return null; (yield* evidence(s, value.evidenceIds)); return { ...value, confirmedBy: a.id, confirmedAt: now(), origin: 'human_confirmed' }; }

export function* contribute(s: FlowContext, a: User, taskId: string, b: z.infer<typeof contributionInput>): Flow<Record<string, any>> {
    allow(a, 'worker', 'foreman');
    const t = (yield* task(s, a, taskId));
    if (!t.assignedWorkerIds.includes(a.id))
        fail('FORBIDDEN', 'Only an assigned participant may contribute', 403);
    const before = (yield* checkDraft(s, a, t, b.expectedVersion, b.expectedDraftVersion));
    (yield* validatePhotos(s, a, taskId, b.photoIds));
    const contribution = { authorId: a.id, note: b.note, photoIds: b.photoIds, location: b.location ?? null, confirmedObservation: (yield* confirmed(s, a, b.confirmedObservation)), updatedAt: now() };
    const after = (yield* storeDraft(s, { ...before, version: before.version + 1, contributions: [...before.contributions.filter((c: any) => c.authorId !== a.id), contribution] }));
    (yield* audit(s, a, 'report_draft', taskId, 'contribution', before, after));
    return after;
}

export function* editDraft(s: FlowContext, a: User, taskId: string, b: z.infer<typeof draftInput>): Flow<Record<string, any>> {
    const t = (yield* task(s, a, taskId));
    (yield* authorizeForeman(s, a, t));
    const before = (yield* checkDraft(s, a, t, b.expectedVersion, b.expectedDraftVersion));
    (yield* validateContent(s, a, t, b, before));
    const { expectedVersion, expectedDraftVersion, ...summary } = b;
    const after = (yield* storeDraft(s, { ...before, version: before.version + 1, summary: { ...summary, confirmedObservation: (yield* confirmed(s, a, b.confirmedObservation)) }, updatedAt: now() }));
    (yield* audit(s, a, 'report_draft', taskId, 'summary', before, after));
    return after;
}

export function* validateContent(s: FlowContext, a: User, t: Doc, b: z.infer<typeof reportContent>, draft: Record<string, any>): Flow<void> {
    if (b.actualWorkerIds.length < t.minWorkers || b.actualWorkerIds.some(userId => !t.assignedWorkerIds.includes(userId)))
        fail('INVALID_ACTUAL_WORKERS', 'Actual workers must be assigned and meet minWorkers', 400);
    const contributorIds = draft.contributions.filter((c: any) => t.assignedWorkerIds.includes(c.authorId)).map((c: any) => c.authorId);
    const allowedPhotos = new Set(draft.contributions.filter((c: any) => contributorIds.includes(c.authorId)).flatMap((c: any) => c.photoIds));
    for (const photoId of b.photoIds) {
        const owner = (yield* s.get('SELECT owner_id FROM v2_uploads WHERE id=?', photoId))?.owner_id;
        if (owner !== a.id && !allowedPhotos.has(photoId))
            fail('PHOTO_NOT_CONTRIBUTED', 'Another participant must explicitly contribute their photo', 400);
    }
    (yield* validatePhotos(s, a, t.id, b.photoIds, [a.id, ...contributorIds]));
    if (b.confirmedObservation)
        (yield* evidence(s, b.confirmedObservation.evidenceIds));
    if (t.action !== 'plant' && b.actualPlantingItems.length)
        fail('INVALID_PLANTING_REPORT', 'Only planting tasks accept planting items', 400);
    if (t.action === 'plant') {
        const design = (yield* approvedRevision(s, t.approvedDesignId, t.approvedDesignVersion));
        const seen = new Set<string>();
        const positions = new Set<string>();
        for (const item of b.actualPlantingItems) {
            const plan = design.plantingItems.find((p: any) => p.id === item.plantingItemId);
            if (!plan || plan.catalogItemId !== item.catalogItemId || seen.has(item.plantingItemId))
                fail('INVALID_PLANTING_ITEM', 'Actual item must uniquely match the approved catalog item', 400);
            seen.add(item.plantingItemId);
            const points = item.geometry.type === 'Point' ? [item.geometry.coordinates] : item.geometry.coordinates;
            if (points.length !== item.quantity)
                fail('ACTUAL_POSITION_COUNT', 'Provide one actual position per registry object', 400);
            for (const p of points) {
                const key = JSON.stringify(p);
                if (positions.has(key))
                    fail('DUPLICATE_POSITION', 'Actual registry positions must be distinct', 400);
                positions.add(key);
            }
        }
    }
}

export function* submit(s: FlowContext, a: User, taskId: string, b: z.infer<typeof submitInput>, key: string): Flow<{ report: { id: `${string}-${string}-${string}-${string}-${string}`; taskId: string; authorId: string; contributorIds: any; contributions: any; createdAt: string; confirmedObservation: { confirmedBy: string; confirmedAt: string; origin: string; category: "access_problem" | "visible_damage" | "care_completed" | "needs_inspection" | "other"; extractedFacts: string[]; proposedAction: "plant" | "inspect" | "water" | "weed" | null; evidenceIds: string[]; missingData: string[]; confirmed: true; } | null; foremanCheckedAt: string | null; foremanCheckedBy: string | null; reviewStatus: string; reviewerId: null; reviewComment: null; reviewedAt: null; idempotencyKey: string; revision: number; version: number; note: string; photoIds: string[]; actualWorkerIds: string[]; actualPlantingItems: { plantingItemId: string; catalogItemId: string; quantity: number; geometry: { type: "Point"; coordinates: [number, number]; } | { type: "MultiPoint"; coordinates: [number, number][]; }; note?: string | null | undefined; }[]; location?: { lat: number; lng: number; accuracyM: number; capturedAt: string; } | null | undefined; }; task: Doc; }> {
    const before = (yield* task(s, a, taskId));
    allow(a, 'worker', 'foreman');
    matchVersion(before, b.expectedVersion);
    if (before.status !== 'in_progress')
        fail('INVALID_TRANSITION', 'Only in-progress tasks can submit a report');
    if (before.minWorkers > 1)
        (yield* authorizeForeman(s, a, before));
    else if (!before.assignedWorkerIds.includes(a.id))
        fail('FORBIDDEN', 'The assigned executor submits a single-worker report', 403);
    const draft = (yield* getDraft(s, a, taskId));
    if (before.minWorkers > 1 && (b.expectedDraftVersion === undefined || b.expectedDraftVersion !== draft.version))
        fail('DRAFT_VERSION_CONFLICT', 'Read and confirm the current group draft version');
    (yield* validateContent(s, a, before, b, draft));
    const reportId = randomUUID(), revision = Number((yield* s.get('SELECT COALESCE(max(revision),0)+1 n FROM v2_reports WHERE task_id=?', taskId))?.n);
    const { expectedVersion, expectedDraftVersion, ...content } = b;
    const r = { ...content, id: reportId, taskId, authorId: a.id, contributorIds: draft.contributions.filter((c: any) => before.assignedWorkerIds.includes(c.authorId)).map((c: any) => c.authorId), contributions: draft.contributions.filter((c: any) => before.assignedWorkerIds.includes(c.authorId)), createdAt: now(), confirmedObservation: (yield* confirmed(s, a, b.confirmedObservation)), foremanCheckedAt: a.role === 'foreman' ? now() : null, foremanCheckedBy: a.role === 'foreman' ? a.id : null, reviewStatus: 'pending', reviewerId: null, reviewComment: null, reviewedAt: null, idempotencyKey: key, revision, version: 1 };
    (yield* s.run('INSERT INTO v2_reports VALUES (?,?,?,?,\'pending\',1,?)', r.id, taskId, revision, a.id, JSON.stringify(r)));
    for (const photoId of r.photoIds)
        (yield* s.run('UPDATE v2_uploads SET report_id=? WHERE id=? AND report_id IS NULL', r.id, photoId));
    const updated = (yield* saveTask(s, a, before, { ...before, status: 'submitted', latestReportId: r.id }, 'submit_report'));
    (yield* audit(s, a, 'report', r.id, 'submit', null, r));
    return { report: r, task: updated };
}

export function* acceptPlanting(s: FlowContext, a: User, t: Doc, r: Doc, acceptDeviation: boolean): Flow<{ plants: Doc[]; careTasks: Doc[]; warnings: string[]; }> {
    const design = (yield* approvedRevision(s, t.approvedDesignId, t.approvedDesignVersion));
    if (design.plantingItems.some((p: any) => r.actualPlantingItems.find((item: any) => item.plantingItemId === p.id)?.quantity !== p.quantity) || r.actualPlantingItems.length !== design.plantingItems.length)
        fail('INCOMPLETE_PLANTING', 'Return incomplete/excess planting to assigned; revise scope explicitly before acceptance');
    const deviation = design.plantingItems.some((p: any) => JSON.stringify(p.geometry) !== JSON.stringify(r.actualPlantingItems.find((item: any) => item.plantingItemId === p.id)?.geometry));
    if (deviation && !acceptDeviation)
        fail('PLANTING_DEVIATION', 'Coordinator must explicitly accept the geometry deviation with a review comment');
    const plants: Doc[] = [], careTasks: Doc[] = [], warnings: string[] = [];
    for (const item of r.actualPlantingItems) {
        const planned = design.plantingItems.find((p: any) => p.id === item.plantingItemId), catalog = (yield* getDoc(s, 'catalog', item.catalogItemId));
        const points = item.geometry.type === 'Point' ? [item.geometry.coordinates] : item.geometry.coordinates;
        for (const [pointIndex, p] of points.entries()) {
            const existing = (yield* s.get('SELECT plant_id FROM v2_planting_receipts WHERE task_id=? AND planting_item_id=? AND position_index=?', t.id, item.plantingItemId, pointIndex));
            if (existing)
                fail('PLANTING_ALREADY_ACCEPTED', 'Registry objects already exist for this planting');
            const plantId = randomUUID(), evidenceId = randomUUID();
            (yield* insertDoc(s, 'evidence', { id: evidenceId, sourceType: 'field_report', sourceLabel: `DEMO accepted report ${r.id}`, observedAt: r.createdAt, dataClass: 'demo', note: 'Reported positions, accepted by coordinator; not independent proof', version: 1 }));
            const plant = (yield* insertDoc(s, 'plant', { id: plantId, name: `${catalog.displayName} (${pointIndex + 1})`, kind: catalog.kind, species: catalog.botanicalName ?? null, plantedAt: r.createdAt, lat: p[1], lng: p[0], condition: 'unknown', lastVerifiedCareAt: null, carePolicyId: planned.carePolicyId ?? catalog.carePolicyId ?? null, evidenceIds: [...planned.evidenceIds, evidenceId], isDemo: true, version: 1 }));
            (yield* s.run('INSERT INTO v2_planting_receipts VALUES (?,?,?,?,?)', t.id, item.plantingItemId, pointIndex, plantId, r.id));
            plants.push(plant);
            if (plant.carePolicyId) {
                const policy = (yield* getDoc(s, 'care_policy', plant.carePolicyId));
                for (const action of policy.allowedActions) {
                    const intervalDays = policy.intervals[action];
                    if (!intervalDays || !policy.applicableKinds.includes(plant.kind)) {
                        warnings.push(`${plantId}: no applicable interval for ${action}`);
                        continue;
                    }
                    careTasks.push((yield* insertTask(s, a, { objectType: 'plant', objectId: plantId, action, description: `DEMO follow-up by ${policy.label}; duration is a provisional 15-minute estimate`, priority: 'medium', priorityWeight: 50, dueAt: new Date(Date.parse(r.createdAt) + intervalDays * 86400000).toISOString(), estimatedMinutes: 15, requiredWaterLiters: action === 'water' ? policy.waterLiters : null, minWorkers: 1, requiredSkills: [action], evidenceIds: policy.sourceEvidenceIds })));
                }
            }
            else
                warnings.push(`${plantId}: no CarePolicy; no care cadence invented`);
        }
    }
    return { plants, careTasks, warnings };
}

export function* review(s: FlowContext, a: User, reportId: string, b: z.infer<typeof reviewInput>): Flow<{ plants: Doc[]; careTasks: Doc[]; warnings: string[]; report: { reviewStatus: "changes_requested" | "accepted"; reviewerId: string; reviewComment: string; reviewedAt: string; version: number; acceptGeometryDeviation: boolean; id: string; }; task: Doc; }> {
    allow(a, 'coordinator');
    const r = (yield* report(s, a, reportId)), before = (yield* task(s, a, r.taskId));
    if (r.authorId === a.id)
        fail('SELF_REVIEW', 'Author cannot accept their own report', 403);
    matchVersion(before, b.expectedVersion);
    matchVersion(r, b.expectedReportVersion);
    if (r.reviewStatus !== 'pending' || before.status !== 'submitted' || before.latestReportId !== r.id)
        fail('INVALID_TRANSITION', 'Only the current submitted report may be reviewed');
    const acceptance = b.decision === 'accepted' && before.action === 'plant' ? (yield* acceptPlanting(s, a, before, r, b.acceptGeometryDeviation)) : { plants: [], careTasks: [], warnings: [] };
    const afterReport = { ...r, reviewStatus: b.decision, reviewerId: a.id, reviewComment: b.comment, reviewedAt: now(), version: r.version + 1, acceptGeometryDeviation: b.acceptGeometryDeviation };
    (yield* s.run('UPDATE v2_reports SET status=?,version=?,data=? WHERE id=?', b.decision, afterReport.version, JSON.stringify(afterReport), r.id));
    const updated = (yield* saveTask(s, a, before, { ...before, status: b.decision === 'accepted' ? 'verified' : 'assigned' }, b.decision === 'accepted' ? 'verify' : 'return'));
    if (b.decision === 'accepted') {
        (yield* s.run('INSERT INTO v2_care_events VALUES (?,?,?,?,?,?,?)', randomUUID(), before.id, r.id, before.objectId, before.action, afterReport.reviewedAt, JSON.stringify({ action: before.action, actualWorkerIds: r.actualWorkerIds, acceptedBy: a.id })));
        if (before.objectType === 'plant' && before.action !== 'plant') {
            const p = (yield* getDoc(s, 'plant', before.objectId));
            (yield* updateDoc(s, 'plant', { ...p, lastVerifiedCareAt: afterReport.reviewedAt, version: p.version + 1 }, p.version));
        }
    }
    else {
        const old = (yield* getDraft(s, a, before.id));
        (yield* storeDraft(s, { taskId: before.id, version: old.version + 1, contributions: [], summary: null }));
    }
    (yield* audit(s, a, 'report', r.id, b.decision, r, afterReport));
    return { report: afterReport, task: updated, ...acceptance };
}

export function* issue(s: FlowContext, a: User, taskId: string, b: z.infer<typeof issueInput>): Flow<{ id: `${string}-${string}-${string}-${string}-${string}`; taskId: string; authorId: string; text: string; confirmedObservation: { confirmedBy: string; confirmedAt: string; origin: string; category: "access_problem" | "visible_damage" | "care_completed" | "needs_inspection" | "other"; extractedFacts: string[]; proposedAction: "plant" | "inspect" | "water" | "weed" | null; evidenceIds: string[]; missingData: string[]; confirmed: true; } | null; createdAt: string; version: number; }> {
    allow(a, 'worker', 'foreman', 'coordinator');
    const t = (yield* task(s, a, taskId));
    matchVersion(t, b.expectedVersion);
    if (t.status === 'verified')
        fail('TERMINAL_TASK', 'Use a new inspection task for a new issue');
    const result = { id: randomUUID(), taskId, authorId: a.id, text: b.text, confirmedObservation: (yield* confirmed(s, a, b.confirmedObservation)), createdAt: now(), version: 1 };
    (yield* s.run('INSERT INTO v2_issues VALUES (?,?,?,?,?)', result.id, taskId, a.id, JSON.stringify(result), result.createdAt));
    (yield* saveTask(s, a, t, { ...t }, 'issue'));
    (yield* audit(s, a, 'issue', result.id, 'create', null, result));
    return result;
}
