// Shared domain operations. Both SQLite and PostgreSQL execute this same workflow.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { id, shortText, text, version, timestamp, uniqueIds, intervals, allow, fail, matchVersion, now, type User, type Doc, type Kind } from ".././core.js";
import { evidence, audit, getDoc, listDocs, insertDoc, updateDoc } from "./core.js";
import { point, multiPoint, geometry, plantInput, plantPatch, checkNames, checks, sitePatch, resourceInput, resourcePatch, catalogInput, catalogPatch, evidenceInput, carePolicyInput, newDocument, updatedDocument, requireSiteCleared, listQuery, page } from "../data.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../flow.js";

export function* validateReferences(s: FlowContext, body: Record<string, any>): Flow<void> {
    if (body.evidenceIds)
        (yield* evidence(s, body.evidenceIds));
    if (body.sourceEvidenceIds)
        (yield* evidence(s, body.sourceEvidenceIds));
    if (body.carePolicyId)
        (yield* getDoc(s, 'care_policy', body.carePolicyId));
    if (body.ownerCrewId && !(yield* s.get('SELECT id FROM v2_crews WHERE id=?', body.ownerCrewId)))
        fail('INVALID_REFERENCE', 'Owner crew not found', 400);
}

export function* createData(s: FlowContext, a: User, kind: Kind, body: Record<string, any>): Flow<Doc> {
    (yield* validateReferences(s, body));
    const result = (yield* insertDoc(s, kind, newDocument(kind, body)));
    (yield* audit(s, a, kind, result.id, 'create', null, result));
    return result;
}

export function* patchData(s: FlowContext, a: User, kind: Kind, objectId: string, body: Record<string, any>): Flow<Doc> {
    const before = (yield* getDoc(s, kind, objectId));
    matchVersion(before, body.expectedVersion);
    const { expectedVersion, ...patch } = body;
    (yield* validateReferences(s, patch));
    if (kind === 'site' && patch.checks) {
        patch.checks = { ...before.checks, ...Object.fromEntries(Object.entries(patch.checks).map(([key, value]) => [key, { ...(value as object), reviewedBy: a.id, reviewedByName: a.displayName, reviewedAt: now() }])) };
    }
    if (kind === 'site' && patch.waterAvailability) {
        const { value, note } = patch.waterAvailability;
        delete patch.waterAvailability;
        const ev = (yield* insertDoc(s, 'evidence', { id: randomUUID(), sourceType: 'manual', sourceLabel: `Внесено: ${a.displayName}`, sourceUrl: null, observedAt: now(), validUntil: null, dataClass: 'real', note, version: 1 }));
        patch.factors = { ...before.factors, waterAvailability: { value, evidenceIds: value === null ? [] : [ev.id], method: `Указано специалистом: ${note}` } };
        patch.missingData = (before.missingData ?? []).filter((m: any) => m?.field !== 'factors.waterAvailability');
        if (value === null)
            patch.missingData.push({ field: 'factors.waterAvailability', reason: 'Специалист отметил значение как неизвестное.' });
    }
    const after = updatedDocument(before, patch);
    if (kind === 'catalog')
        catalogInput.parse(Object.fromEntries(Object.entries(after).filter(([k]) => !['id', 'version', 'createdAt', 'updatedAt', 'reviewedBy'].includes(k))));
    if (kind === 'site' && after.isIntersection && after.checks.trafficVisibility.status === 'not_applicable')
        fail('TRAFFIC_CHECK_REQUIRED', 'Intersection visibility cannot be not_applicable', 400);
    (yield* updateDoc(s, kind, after, before.version));
    (yield* audit(s, a, kind, objectId, 'update', before, after));
    return after;
}
