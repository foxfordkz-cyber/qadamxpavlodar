// Shared Outcomes domain operations; SQLite and PostgreSQL execute these same rules.
import { ApiError } from "../errors.js";
import { allow, fail, parseRow, now, matchVersion, type User, type Doc } from "../v2/core.js";
import { getDoc, maybeDoc, audit } from "../v2/flows/core.js";
import { allTasks, canTask } from "../v2/flows/tasks.js";
import { analyze, type candidate, type reference, type speciesList } from "../tz/data.js";
import { shared, today, day, type Json } from "./shared.js";
import { validate, metadata } from "./service.js";
import { FlowContext, type Flow, flowMap, flowFilter, flowSome, flowEvery, flowFind } from "../v2/flow.js";
export type SnapshotInput={site:ReturnType<typeof candidate>;ref:ReturnType<typeof reference>};

export function* canRead(s: FlowContext, a: User, c: Json): Flow<any> {
    if (['admin', 'coordinator', 'specialist', 'viewer'].includes(a.role))
        return true;
    // Explicit task links only; coordinate proximity never establishes ownership.
    const tasks = (yield* flowFilter((yield* allTasks(s)), function* (t: Doc): Flow<any> {
        return (yield* canTask(s, a, t));
    }));
    return tasks.some(t => t.objectType === 'candidate_site' && t.objectId === c.siteId) || c.plants.every((p: Json) => tasks.some(t => t.objectType === 'plant' && t.objectId === p.plantId));
}

export function* cohort(s: FlowContext, a: User, id: string): Flow<{ data: Doc; meta: { createdAt: any; createdBy: any; }; }> { const row = (yield* s.get('SELECT * FROM outcome_cohorts WHERE id=?', id)); const c = parseRow(row, 'Cohort'); if (!(yield* canRead(s, a, c)))
    fail('NOT_FOUND', 'Cohort not found', 404); return { data: c, meta: metadata(row!) }; }

export function* cohorts(s: FlowContext, a: User): Flow<{ data: Doc; meta: { createdAt: any; createdBy: any; }; }[]> { return (yield* flowFilter((yield* s.all('SELECT * FROM outcome_cohorts ORDER BY created_at,id')).map(r => ({ data: parseRow(r), meta: metadata(r) })), function* (r: { data: Doc; meta: { createdAt: any; createdBy: any; }; }): Flow<any> {
    return (yield* canRead(s, a, r.data));
})); }

/** Read model for the specialist screen; all domain records retain the #18 DTOs. */
export function* siteOutcomes(s: FlowContext, a: User, siteId: string, speciesCatalog: ReturnType<typeof speciesList>): Flow<{ siteId: string; asOf: string; cohorts: Doc[]; inspections: Doc[]; registry: { plantId: string; speciesId: any; siteId: any; kind: string; plantedOn: string | null; isDemo: boolean; }[]; forecasts: { id: string | number | null | undefined; snapshot: Doc; }[]; }> {
    allow(a, 'admin', 'coordinator', 'viewer');
    (yield* getDoc(s, 'site', siteId));
    const cs = (yield* cohorts(s, a)).map(r => r.data).filter(c => c.siteId === siteId);
    const plantIds = [...new Set<string>(cs.flatMap(c => c.plants.map((p: Json) => p.plantId)))];
    return { siteId, asOf: today(), cohorts: cs, inspections: (yield* flowMap(cs, function* (c: Doc): Flow<Doc[]> {
            return (yield* history(s, a, c.id)).map(r => r.data);
        })).flat(),
        registry: (yield* flowMap(plantIds, function* (id: string): Flow<{ plantId: string; speciesId: any; siteId: any; kind: string; plantedOn: string | null; isDemo: boolean; }> {
            return (yield* registry(s, id, speciesCatalog));
        })),
        forecasts: (yield* s.all('SELECT id,data FROM outcome_snapshots WHERE site_id=? ORDER BY created_at,id', siteId)).map(row => ({ id: row.id, snapshot: parseRow(row) })) };
}

export function* registry(s: FlowContext, plantId: string, speciesCatalog: ReturnType<typeof speciesList>): Flow<{ plantId: string; speciesId: any; siteId: any; kind: string; plantedOn: string | null; isDemo: boolean; }> {
    const p = (yield* getDoc(s, 'plant', plantId));
    if (p.kind !== 'tree')
        fail('TREE_ONLY', 'MVP requires individually registered trees', 400);
    const receipt = (yield* s.get("SELECT r.data AS report,t.data AS task FROM v2_planting_receipts x JOIN v2_reports r ON r.id=x.report_id JOIN v2_tasks t ON t.id=x.task_id WHERE x.plant_id=? AND r.status='accepted'", plantId));
    const report = receipt ? JSON.parse(String(receipt.report)) : null, t = receipt ? JSON.parse(String(receipt.task)) : null;
    const siteId = p.siteId ?? (t?.objectType === 'candidate_site' ? t.objectId : null);
    if (!siteId)
        fail('PLANT_SITE_UNCONFIRMED', 'Plant requires an explicit site or accepted planting receipt', 400);
    if (p.siteId && t && t.objectId !== p.siteId)
        fail('PLANT_SITE_CONFLICT', 'Registry and planting receipt disagree', 400);
    const catalog = speciesCatalog.filter(sp => sp.id === p.speciesId || sp.latin === p.species);
    if (catalog.length !== 1)
        fail('SPECIES_UNCONFIRMED', 'Registry species must match exactly one catalog species', 400);
    const date = p.plantedAt ?? report?.createdAt ?? null;
    return { plantId, speciesId: catalog[0]!.id, siteId, kind: 'tree', plantedOn: date ? day(date) : null, isDemo: p.isDemo === true };
}

export function* provenance(s: FlowContext, isDemo: boolean, evidenceIds: string[], siteId: string): Flow<{ source: string; capturedAt: string; dataClass: string; isDemo: boolean; evidenceIds: string[]; siteVersion: number; ratesVersion: null; }> {
    for (const id of evidenceIds)
        (yield* getDoc(s, 'evidence', id));
    return { source: 'api', capturedAt: now(), dataClass: isDemo ? 'demo' : 'real', isDemo, evidenceIds, siteVersion: (yield* getDoc(s, 'site', siteId)).version, ratesVersion: null };
}

export function* snapshot(s: FlowContext, a: User, b: Json, input: SnapshotInput): Flow<{ id: any; snapshot: Json; createdAt: string; }> {
    allow(a, 'admin', 'coordinator');
    if ((yield* s.get('SELECT id FROM outcome_snapshots WHERE id=?', b.id)))
        fail('DUPLICATE_ID', 'Snapshot already exists');
    const site = input.site, ref = input.ref;
    matchVersion((yield* getDoc(s, 'site', b.siteId)), b.expectedVersion);
    if (b.expectedRatesVersion !== undefined)
        matchVersion({ version: ref.version }, b.expectedRatesVersion);
    const analysis = analyze(site, ref, { variant: b.variant, careYears: 3, excluded: ref.species.filter(sp => sp.form !== 'tree').map(sp => sp.id) });
    const p = { source: 'api', capturedAt: now(), dataClass: 'estimate', isDemo: true, evidenceIds: site.evidenceIds ?? [], siteVersion: site.version ?? null, ratesVersion: ref.version };
    const result = validate(() => shared.createOutcomeSnapshot({ id: b.id, site, analysis, catalog: ref.species, rates: ref.rates, provenance: p }));
    (yield* s.run('INSERT INTO outcome_snapshots(id,site_id,data,created_at,created_by) VALUES (?,?,?,?,?)', b.id, b.siteId, JSON.stringify(result), p.capturedAt, a.id));
    (yield* audit(s, a, 'outcome_snapshot', b.id, 'create', null, { id: b.id, siteId: b.siteId }));
    return { id: b.id, snapshot: result, createdAt: p.capturedAt };
}

export function* createCohort(s: FlowContext, a: User, b: Json, speciesCatalog: ReturnType<typeof speciesList>): Flow<Json> {
    allow(a, 'admin', 'coordinator');
    if ((yield* s.get('SELECT id FROM outcome_cohorts WHERE id=?', b.id)))
        fail('DUPLICATE_ID', 'Cohort already exists');
    (yield* getDoc(s, 'site', b.siteId));
    const plants = (yield* flowMap(b.plantIds, function* (id: string): Flow<{ plantId: string; speciesId: any; siteId: any; kind: string; plantedOn: string | null; isDemo: boolean; }> {
        return (yield* registry(s, id, speciesCatalog));
    }));
    for (const id of b.plantIds)
        if ((yield* s.get('SELECT plant_id FROM outcome_members WHERE plant_id=?', id)))
            fail('PLANT_ALREADY_IN_COHORT', 'Tree already belongs to an original cohort');
    let forecast = null;
    if (b.snapshotId) {
        const row = (yield* s.get('SELECT data FROM outcome_snapshots WHERE id=?', b.snapshotId));
        if (!row)
            fail('NOT_FOUND', 'Snapshot not found', 404);
        forecast = JSON.parse(String(row!.data));
    }
    const p = (yield* provenance(s, plants.some((v: Json) => v.isDemo), b.evidenceIds, b.siteId));
    const c = validate(() => shared.createOutcomeCohort({ id: b.id, siteId: b.siteId, plants: plants.map((v: Json) => ({ plantId: v.plantId, speciesId: v.speciesId })), plantedOn: b.plantedOn, forecast, provenance: p, version: 1 }, plants, today()));
    (yield* s.run('INSERT INTO outcome_cohorts(id,site_id,snapshot_id,data,version,created_at,created_by) VALUES (?,?,?,?,1,?,?)', c.id, c.siteId, b.snapshotId, JSON.stringify(c), p.capturedAt, a.id));
    for (const v of plants)
        (yield* s.run('INSERT INTO outcome_members(cohort_id,plant_id) VALUES (?,?)', c.id, v.plantId));
    (yield* audit(s, a, 'outcome_cohort', c.id, 'create', null, c));
    return c;
}

export function* confirmObservation(s: FlowContext, c: Json, o: Json, observedOn: string): Flow<void> {
    if (!c.plants.some((p: Json) => p.plantId === o.plantId))
        fail('FOREIGN_PLANT', 'Observation outside cohort', 400);
    let confirmed = false;
    if (o.reportId) {
        const row = (yield* s.get('SELECT * FROM v2_reports WHERE id=?', o.reportId));
        if (!row)
            fail('INVALID_REPORT', 'Report not found', 400);
        const report = parseRow(row);
        const t = parseRow((yield* s.get('SELECT data FROM v2_tasks WHERE id=?', report.taskId)));
        if (row.status !== 'accepted' || report.reviewStatus !== 'accepted' || !report.reviewerId || !report.reviewedAt)
            fail('UNACCEPTED_REPORT', 'Report must be accepted and reviewed', 400);
        if (t.objectType !== 'plant' || t.objectId !== o.plantId || t.action !== 'inspect')
            fail('REPORT_TARGET_MISMATCH', 'Require an inspection report for this tree', 400);
        // Existing V2 report has no structured alive/dead assertion. Do not interpret prose or late watering.
        // Coordinator explicitly attests state when submitting this immutable inspection with accepted evidence.
        if (day(report.createdAt) !== observedOn)
            fail('REPORT_DATE_MISMATCH', 'Observation must match the report calendar day', 400);
        confirmed = true;
    }
    for (const id of o.evidenceIds) {
        const e = (yield* getDoc(s, 'evidence', id));
        if (c.provenance.isDemo && id === 'outcomes-demo-evidence' && e.sourceType === 'fixture' && e.dataClass === 'demo')
            confirmed = true;
        else if (!o.reportId)
            fail('UNCONFIRMED_EVIDENCE', 'Evidence alone is not an accepted plant inspection', 400);
    }
    if (o.state !== 'unknown' && !confirmed)
        fail('UNCONFIRMED_OBSERVATION', 'Alive/dead requires accepted report or labelled demo fixture', 400);
}

export function* inspection(s: FlowContext, a: User, cohortId: string, b: Json): Flow<{ id: any; cohortId: string; observedOn: any; observations: any; provenance: { source: string; capturedAt: string; dataClass: string; isDemo: boolean; evidenceIds: string[]; siteVersion: number; ratesVersion: null; }; version: number; }> {
    allow(a, 'admin', 'coordinator');
    const c = (yield* cohort(s, a, cohortId)).data;
    matchVersion(c, b.expectedVersion);
    if ((yield* s.get('SELECT id FROM outcome_inspections WHERE id=? OR (cohort_id=? AND observed_on=?)', b.id, cohortId, b.observedOn)))
        fail('DUPLICATE_INSPECTION', 'One immutable inspection per cohort and day');
    for (const o of b.observations)
        (yield* confirmObservation(s, c, o, b.observedOn));
    const p = (yield* provenance(s, c.provenance.isDemo, b.evidenceIds, c.siteId));
    const i = { id: b.id, cohortId, observedOn: b.observedOn, observations: b.observations, provenance: p, version: 1 };
    validate(() => shared.summarizeOutcomeInspection(c, i, today()));
    (yield* s.run('INSERT INTO outcome_inspections VALUES (?,?,?,?,?,?)', i.id, cohortId, i.observedOn, JSON.stringify(i), p.capturedAt, a.id));
    for (const o of i.observations)
        (yield* s.run('INSERT INTO outcome_sources(inspection_id,plant_id,report_id) VALUES (?,?,?)', i.id, o.plantId, o.reportId));
    const after = { ...c, version: c.version + 1 };
    (yield* s.run('UPDATE outcome_cohorts SET data=?,version=? WHERE id=? AND version=?', JSON.stringify(after), after.version, c.id, c.version));
    (yield* audit(s, a, 'outcome_inspection', i.id, 'accept', null, i));
    return i;
}

export function* history(s: FlowContext, a: User, id: string): Flow<{ data: Doc; meta: { createdAt: string | number | null | undefined; reviewerId: string | number | null | undefined; }; }[]> { (yield* cohort(s, a, id)); return (yield* s.all('SELECT * FROM outcome_inspections WHERE cohort_id=? ORDER BY observed_on,id', id)).map(row => ({ data: parseRow(row), meta: { createdAt: row.created_at, reviewerId: row.reviewer_id } })); }

export function* summary(s: FlowContext, a: User, id: string, inspectionId: string | null): Flow<{ summary: Json; comparison: Json; asOf: string; }> {
    const c = (yield* cohort(s, a, id)).data;
    let i = null;
    if (inspectionId) {
        const row = (yield* s.get('SELECT data FROM outcome_inspections WHERE id=? AND cohort_id=?', inspectionId, id));
        if (!row)
            fail('NOT_FOUND', 'Inspection not found', 404);
        i = parseRow(row);
    }
    return { summary: validate(() => shared.summarizeOutcomeInspection(c, i, today())), comparison: validate(() => shared.compareOutcomeForecast(c, i, today())), asOf: today() };
}
