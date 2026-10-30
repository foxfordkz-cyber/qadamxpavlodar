import { speciesName } from '../../../shared/i18n';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { CandidateSite, GeoJsonPoint, GeoJsonPolygon, PlantingProject, ProjectItem, SiteContext, Species } from '../../../shared/api/types';
import { Badge, Button, CheckBadge, ErrorNote, Field, MethodLine, Modal, StateView, useGuarded } from '../../../shared/ui/components';
import { t, type Key } from '../../../shared/i18n';
import { fmtDateTime } from '../../../shared/format';
import { hrefFor } from '../../../shared/router';
import { makeProjection, ringAreaXY } from '../../../shared/geo';
import { computeConflicts, unresolved, type Conflict } from '../../../shared/projectRules';
import { CHECK_KEYS, eligibilityOf } from '../sites/eligibility';
import { SchemeEditor, type Tool } from './SchemeEditor';
import { CatalogPanel } from './CatalogPanel';
import { BomTable } from './BomTable';
import { LifecycleStrip } from './status';
import { suggestLayout, templateLayout, type TemplateKind } from './suggest';
import { TaskForm, type TaskDraft } from '../tasks/TaskForm';
import { useMe } from '../me';

const ProjectMap3D = lazy(() => import('./ProjectMap3D').then((m) => ({ default: m.ProjectMap3D })));

let localSeq = 0;
const newItemId = () => `pi-${Date.now().toString(36)}-${++localSeq}`;

export function ProjectEditor({ id }: { id: string }) {
  const { api } = useData();
  const res = useResource(() => api.project(id), [id]);
  const site = useResource(() => (res.data ? api.site(res.data.siteId) : Promise.resolve(null)), [res.data?.siteId]);
  const context = useResource(() => (res.data ? api.siteContext(res.data.siteId, 50) : Promise.resolve(null)), [res.data?.siteId]);
  const catalog = useResource(() => api.species(), []);
  return (
    <StateView loading={res.loading || site.loading || catalog.loading} error={res.error ?? site.error ?? catalog.error} hasData={!!res.data && !!site.data && !!catalog.data} onRetry={() => { res.reload(); site.reload(); catalog.reload(); }}>
      {res.data && site.data && catalog.data && (
        <EditorBody key={`${res.data.id}-${res.data.version}`} initial={res.data} site={site.data} catalog={catalog.data} context={context.data ?? null} contextError={context.error} onReload={res.reload} />
      )}
    </StateView>
  );
}

interface Pending {
  kind: 'add' | 'move';
  itemId?: string;
  geometry: GeoJsonPoint | GeoJsonPolygon;
  speciesId: string;
  quantity: number;
  conflicts: Conflict[];
}

function EditorBody({ initial, site, catalog, context, contextError, onReload }: { initial: PlantingProject; site: CandidateSite; catalog: Species[]; context: SiteContext | null; contextError: unknown; onReload: () => void }) {
  const { api, bump } = useData();
  const me = useMe();
  const [server, setServer] = useState(initial);
  const [items, setItems] = useState<ProjectItem[]>(initial.items);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [active, setActive] = useState<Species | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<'now' | 'plan' | 'after'>('plan');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conflict, setConflict] = useState<PlantingProject | null>(null);
  const [itemErrors, setItemErrors] = useState<Record<string, string>>({});
  const [taskOpen, setTaskOpen] = useState(false);
  const [suggestNote, setSuggestNote] = useState<unknown>(null);
  const { run, busy } = useGuarded();
  const byId = useMemo(() => new Map(catalog.map((s) => [s.id, s])), [catalog]);
  const plants = useResource(() => api.plants(), []);
  const tasks = useResource(() => api.tasks({ objectId: site.id }), [site.id]);
  const reports = useResource(() => api.reports({ reviewStatus: 'pending' }), []);
  const buildings = context?.buildings ?? [];

  const editable = (me.role === 'coordinator' || me.role === 'admin') && server.status !== 'submitted' && !server.implementedAt;
  const nearPlants = (plants.data?.data ?? []).filter((p) => p.projectId === server.id || Math.abs(p.lat - site.centroid!.lat) < 0.0015 && Math.abs(p.lng - site.centroid!.lng) < 0.0025);
  const reportPending = (reports.data?.data ?? []).some((r) => (tasks.data?.data ?? []).some((x) => x.id === r.taskId && x.projectId === server.id));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', warn);
    return () => removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (next: ProjectItem[]) => {
    setItems(next);
    setDirty(true);
    setNotice(null);
  };

  const quantityFor = (sp: Species, geometry: GeoJsonPoint | GeoJsonPolygon) => {
    if (geometry.type === 'Point') return 1;
    const proj = makeProjection(site.centroid!);
    const area = ringAreaXY(geometry.coordinates[0].map(proj.toXY));
    const d = sp.crownDiameterM ?? 0.5;
    return Math.max(1, Math.round(area / (d * d)));
  };

  const add = (geometry: GeoJsonPoint | GeoJsonPolygon) => {
    if (!active) return;
    const conflicts = computeConflicts({ geometry, speciesId: active.id }, site, buildings, active);
    const quantity = quantityFor(active, geometry);
    if (conflicts.length) setPending({ kind: 'add', geometry, speciesId: active.id, quantity, conflicts });
    else commit({ kind: 'add', geometry, speciesId: active.id, quantity, conflicts: [] }, '');
  };
  const move = (itemId: string, geometry: GeoJsonPoint) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    const sp = byId.get(it.speciesId);
    const conflicts = computeConflicts({ geometry, speciesId: it.speciesId }, site, buildings, sp);
    const open = unresolved(it, conflicts);
    if (open.length) setPending({ kind: 'move', itemId, geometry, speciesId: it.speciesId, quantity: it.quantity, conflicts });
    else change(items.map((x) => (x.id === itemId ? { ...x, geometry, conflicts: x.conflicts.filter((c) => conflicts.some((n) => n.type === c.type)) } : x)));
  };
  const commit = (p: Pending, reason: string) => {
    const conflicts = p.conflicts.map((c) => ({ ...c, resolution: reason }));
    if (p.kind === 'add') {
      const item: ProjectItem = { id: newItemId(), speciesId: p.speciesId, kind: p.geometry.type === 'Point' ? 'point' : 'bed', geometry: p.geometry, quantity: p.quantity, origin: 'manual', conflicts };
      change([...items, item]);
      setSelected(item.id);
    } else change(items.map((x) => (x.id === p.itemId ? { ...x, geometry: p.geometry, conflicts, origin: 'manual' } : x)));
    setPending(null);
  };

  const save = async (): Promise<PlantingProject | null> => {
    setError(null);
    setItemErrors({});
    try {
      const r = await api.saveProject(server.id, { expectedVersion: server.version, items });
      setServer(r);
      setItems(r.items);
      setDirty(false);
      setNotice(t('ed.saved', { v: r.version, dv: r.designVersion }));
      bump();
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.isConflict && e.code === 'version_conflict') {
        try { setConflict(await api.project(server.id)); } catch { /* показываем общую ошибку */ }
      }
      const det = (e as ApiError).details as { items?: Record<string, string> } | undefined;
      if (det?.items) setItemErrors(det.items);
      setError(e);
      return null;
    }
  };
  const submit = () => run(async () => {
    const base = dirty ? await save() : server;
    if (!base) return;
    try {
      const r = await api.submitProject(base.id, base.version);
      setServer(r);
      setNotice(t('ed.submitted'));
      bump();
    } catch (e) {
      const det = (e as ApiError).details as { items?: Record<string, string> } | undefined;
      if (det?.items) setItemErrors(det.items);
      setError(e);
    }
  });
  const withdraw = () => run(async () => {
    setError(null);
    try { setServer(await api.withdrawProject(server.id, server.version)); bump(); } catch (e) { setError(e); }
  });
  const suggest = () => run(async () => {
    setSuggestNote(null);
    try {
      const sel = await api.plantSelection(site.id);
      const proposal = suggestLayout(site, sel, byId, buildings, newItemId);
      if (!proposal.length) {
        setSuggestNote(new Error(t('ed.suggest.none')));
        return;
      }
      change([...items, ...proposal]);
      setSuggestNote({ method: sel.method, n: proposal.length });
    } catch (e) {
      setSuggestNote(e);
    }
  });

  const applyTemplate = (kind: TemplateKind) => {
    if (!kind) return;
    const need = kind === 'alley' ? 'tree' : 'shrub';
    if (!active || active.form !== need) {
      setSuggestNote(new Error(kind === 'alley' ? t('ed.template.needTree') : t('ed.template.needShrub')));
      return;
    }
    const { items: add, skipped } = templateLayout(kind, site, active, buildings, newItemId);
    if (!add.length) {
      setSuggestNote(new Error(t('ed.suggest.none')));
      return;
    }
    change([...items, ...add]);
    setSuggestNote({ method: 'rules', n: add.length, skipped });
  };

  const taskDraft: TaskDraft | null = server.approved
    ? {
        objectId: site.id, action: 'plant', priority: 'medium', projectId: server.id, projectDesignVersion: server.approved.designVersion, projectTitle: server.title,
        description: t('dynamic.003', { p0: String(server.title), p1: String(server.approved.designVersion), p2: String(summarize(server.approved.items, byId)) }),
        estimatedMinutes: estimateMinutes(server.approved.items, byId),
      }
    : null;
  const elig = eligibilityOf(site);

  return (
    <div className="gp-editor">
      <div className="gp-editor__head">
        <div>
          <p className="gp-eyebrow"><a href={hrefFor('/map', { site: site.id })}>{site.name}</a> · {server.season}{server.isDemo ? ' · демо' : ''}</p>
          <h1 className="gp-h1">{server.title}</h1>
          <p className="gp-small gp-muted">{t('ed.versions', { dv: server.designVersion, v: server.version, at: fmtDateTime(server.updatedAt) })}{server.approved ? ` · ${t('ed.approvedVersion', { v: server.approved.designVersion, by: server.approved.by })}` : ''}</p>
        </div>
        <div className="gp-btn-row gp-editor__actions">
          {dirty && <Badge tone="warn" icon="●">{t('ed.unsaved')}</Badge>}
          {editable && <Button busy={busy} disabled={!dirty} onClick={() => run(save)}>{t('ed.save')}</Button>}
          {editable && (server.status === 'draft' || server.status === 'returned') && <Button variant="primary" busy={busy} disabled={!items.length} onClick={submit}>{dirty ? t('ed.saveSubmit') : t('ed.submit')}</Button>}
          {server.status === 'submitted' && <Button busy={busy} onClick={withdraw}>{t('ed.withdraw')}</Button>}
          {server.approved && !server.implementedAt && <Button variant="primary" onClick={() => setTaskOpen(true)}>＋ {t('ed.createTask', { v: server.approved.designVersion })}</Button>}
        </div>
      </div>
      <LifecycleStrip p={server} tasks={tasks.data?.data ?? []} reportPending={reportPending} />
      {server.status === 'approved' && editable && <div className="gp-alert gp-alert--info gp-small">{t('ed.editApprovedWarn', { v: server.designVersion + 1 })}</div>}
      {server.status === 'submitted' && <div className="gp-alert gp-alert--warn gp-small">{t('ed.lockedSubmitted')}</div>}
      {server.reviews.at(-1)?.decision === 'returned' && server.status !== 'approved' && <div className="gp-alert gp-alert--bad"><strong>{t('ed.returnedBy', { by: server.reviews.at(-1)!.by })}:</strong> {server.reviews.at(-1)!.comment}</div>}
      {elig !== 'planting_candidate' && (
        <div className="gp-alert gp-alert--warn gp-small">
          <strong>{t('ed.checksOpen')}</strong> {CHECK_KEYS.map((k) => <span key={k} className="gp-kv">{t(`check.${k}` as Key)} <CheckBadge state={site.checks[k].state} /></span>)}
        </div>
      )}
      {notice && <div className="gp-alert gp-alert--ok" role="status">✓ {notice}</div>}
      {conflict && (
        <div className="gp-alert gp-alert--warn" role="alert">
          <strong>{t('conflict.title')}.</strong> {t('ed.conflictText', { v: conflict.version, n: conflict.items.length, at: fmtDateTime(conflict.updatedAt) })}
          <div className="gp-btn-row">
            <Button onClick={() => { setConflict(null); setError(null); onReload(); }}>{t('ed.conflictLoad')}</Button>
            <Button variant="danger" onClick={() => { setServer({ ...conflict, items: conflict.items }); setConflict(null); setError(null); setDirty(true); }}>{t('ed.conflictKeepMine')}</Button>
          </div>
        </div>
      )}
      <ErrorNote error={conflict ? null : error} notSaved />

      <div className="gp-viewtabs" role="tablist" aria-label={t('ed.views')}>
        {(['now', 'plan', 'after'] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}>{t(`ed.view.${v}` as Key)}</button>
        ))}
      </div>

      <div className="gp-editor__grid">
        <aside className="gp-card gp-editor__catalog" aria-label={t('ed.catalog')}>
          <SiteConditions site={site} context={context} contextError={contextError} />
          <CatalogPanel catalog={catalog} active={active} onPick={(s) => { setActive(s); if (tool === 'select') setTool(s.form === 'flower' ? 'bed' : 'point'); }} disabled={!editable} />
        </aside>

        <section className="gp-editor__center">
          {view === 'plan' && (
            <>
              {editable && (
                <div className="gp-toolbar" role="toolbar" aria-label={t('ed.tools')}>
                  {(['select', 'point', 'bed'] as Tool[]).map((x) => (
                    <button key={x} className={`gp-btn ${tool === x ? 'gp-btn--primary' : ''}`} aria-pressed={tool === x} onClick={() => setTool(x)}>{t(`ed.tool.${x}` as Key)}</button>
                  ))}
                  <span className="gp-small gp-toolbar__active">{active ? t('ed.activeSpecies', { name: speciesName(active) }) : t('ed.pickSpecies')}</span>
                  <Button variant="ghost" busy={busy} onClick={suggest}>✦ {t('ed.suggest')}</Button>
                  <label className="gp-kv gp-small">{t('ed.template')}
                    <select className="gp-input" value="" onChange={(e) => applyTemplate(e.target.value as TemplateKind)} aria-describedby="tpl-hint">
                      <option value="">—</option>
                      <option value="alley">{t('ed.template.alley')}</option>
                      <option value="hedge">{t('ed.template.hedge')}</option>
                    </select>
                  </label>
                  <span id="tpl-hint" className="gp-sr">{t('ed.template.hint')}</span>
                </div>
              )}
              <SuggestNote note={suggestNote} />
              <SchemeEditor site={site} context={context} items={items} species={byId} existingPlants={nearPlants} selectedId={selected} onSelect={setSelected} tool={editable ? tool : 'select'} activeSpecies={active} onAdd={add} onMove={move} onDelete={(id) => change(items.filter((x) => x.id !== id))} readOnly={!editable} />
              <SchemeLegend />
            </>
          )}
          {view === 'now' && <NowView site={site} />}
          {view === 'after' && (
            <Suspense fallback={<div className="gp-state">{t('state.loading')}</div>}>
              <ProjectMap3D site={site} items={items} species={byId} versionLabel={dirty ? t('ed.after.unsaved') : t('ed.after.version', { v: server.designVersion })} />
            </Suspense>
          )}
        </section>

        <aside className="gp-card gp-editor__bom" aria-label={t('ed.bom')}>
          <BomTable items={items} species={byId} selectedId={selected} onSelect={setSelected} errors={itemErrors} editable={editable}
            onQuantity={(id, q) => change(items.map((x) => (x.id === id ? { ...x, quantity: q } : x)))}
            onDelete={(id) => change(items.filter((x) => x.id !== id))}
            onAccept={(id) => change(items.map((x) => (x.id === id ? { ...x, origin: 'manual' } : x)))} />
        </aside>
      </div>

      <Modal open={!!pending} title={t('ed.conflictDialog')} onClose={() => setPending(null)}>
        {pending && <ConflictDialog pending={pending} species={byId.get(pending.speciesId)} onConfirm={(r) => commit(pending, r)} onCancel={() => setPending(null)} />}
      </Modal>
      <Modal open={taskOpen} title={t('form.title')} onClose={() => setTaskOpen(false)}>
        {taskDraft && <TaskForm initial={taskDraft} onDone={() => { setTaskOpen(false); tasks.reload(); }} onCancel={() => setTaskOpen(false)} />}
      </Modal>
    </div>
  );
}

function ConflictDialog({ pending, species, onConfirm, onCancel }: { pending: Pending; species?: Species; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div>
      <p><strong>{speciesName(species)}</strong> — {pending.kind === 'add' ? t('ed.conflictAdd') : t('ed.conflictMove')}</p>
      <ul className="gp-conflicts">{pending.conflicts.map((c) => <li key={c.type}><span aria-hidden="true">✕ </span>{c.message}</li>)}</ul>
      <p className="gp-small gp-muted">{t('ed.conflictHelp')}</p>
      <Field label={t('ed.conflictReason')} required error={err}>
        {(id, d) => <textarea ref={ref} id={id} aria-describedby={d} className="gp-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('ed.conflictPlaceholder')} />}
      </Field>
      <div className="gp-btn-row">
        <Button variant="primary" onClick={onCancel}>{pending.kind === 'add' ? t('ed.conflictCancelAdd') : t('ed.conflictRevert')}</Button>
        <Button variant="danger" onClick={() => (reason.trim().length < 10 ? setErr(t('ed.conflictReasonShort')) : onConfirm(reason.trim()))}>{t('ed.conflictConfirm')}</Button>
      </div>
    </div>
  );
}

function SuggestNote({ note }: { note: unknown }) {
  if (!note) return null;
  if (note instanceof ApiError && note.status === 503) return <div className="gp-alert gp-alert--warn gp-small" role="alert">{t('ed.suggest.down')}</div>;
  if (note instanceof Error) return <ErrorNote error={note} />;
  const n = note as { method: 'model' | 'rules' | 'recorded_demo'; n: number; skipped?: number };
  return (
    <div className="gp-alert gp-alert--info gp-small" role="status">
      {t('ed.suggest.done', { n: n.n })}{n.skipped ? ` ${t('ed.template.skipped', { n: n.skipped })}` : ''} <MethodLine method={n.method} />
    </div>
  );
}

function SiteConditions({ site, context, contextError }: { site: CandidateSite; context: SiteContext | null; contextError: unknown }) {
  const water = site.factors.waterAvailability.value;
  return (
    <div className="gp-conditions">
      <h2 className="gp-eyebrow">{t('ed.conditions')}</h2>
      <ul className="gp-small">
        <li>{t('factor.waterAvailability')}: {water === null ? <Badge tone="warn" icon="?">{t('common.unknown')}</Badge> : `${water}/100`}</li>
        <li>{t('ed.soil')}: <Badge tone="warn" icon="?">{t('common.unknown')}</Badge></li>
        <li>{t('check.utilities')}: <CheckBadge state={site.checks.utilities.state} /></li>
        <li>{t('ed.zones')}: {(site.exclusionZones ?? []).length ? site.exclusionZones!.map((z) => z.label).join(', ') : t('ed.zonesNone')}</li>
        <li>{t('ed.buildings50')}: {contextError ? <span className="gp-caution">{t('ctx.failed')}</span> : context ? context.buildings.length : '…'}</li>
      </ul>
    </div>
  );
}

function SchemeLegend() {
  return (
    <ul className="gp-scheme-legend gp-small" aria-label={t('map.legend')}>
      <li><span className="gp-sw gp-sw--site" />{t('ed.lg.site')}</li>
      <li><span className="gp-sw gp-sw--ez" />{t('ed.lg.zone')}</li>
      <li><span className="gp-sw gp-sw--bld" />{t('ed.lg.building')}</li>
      <li><span className="gp-sw gp-sw--foot" />{t('ed.lg.foot')}</li>
      <li><span aria-hidden="true">▲</span> {t('ed.lg.entrance')}</li>
      <li><span className="gp-sw gp-sw--existing" />{t('ed.lg.existing')}</li>
      <li><span className="gp-sw gp-sw--planned" />{t('ed.lg.planned')}</li>
      <li><span className="gp-sw gp-sw--suggested" />{t('ed.lg.suggested')}</li>
      <li><span className="gp-caution">!</span> {t('ed.lg.conflict')}</li>
    </ul>
  );
}

function NowView({ site }: { site: CandidateSite }) {
  const photos = site.photos ?? [];
  return (
    <div className="gp-nowview">
      <a className="gp-btn" href={hrefFor('/map', { site: site.id })}>{t('ed.now.openMap')}</a>
      {photos.length ? (
        <div className="gp-photos">{photos.map((p) => <figure key={p.id} className="gp-photo"><img src={p.url} alt={t('ed.now.photoAlt', { date: fmtDateTime(p.capturedAt) })} /><figcaption className="gp-small">{fmtDateTime(p.capturedAt)}{p.isDemo ? ' · демо' : ''}</figcaption></figure>)}</div>
      ) : (
        <div className="gp-state gp-state--empty"><span className="gp-state__icon" aria-hidden="true">∅</span>{t('ed.now.noPhoto')}</div>
      )}
      <div className="gp-limits gp-small"><h4>{t('ed.now.sketchTitle')}</h4><p>{t('ed.now.sketchText')}</p></div>
    </div>
  );
}

function summarize(items: ProjectItem[], byId: Map<string, Species>) {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.speciesId, (m.get(i.speciesId) ?? 0) + i.quantity);
  return [...m].map(([id, q]) => `${speciesName(byId.get(id), id)} — ${q}`).join(', ');
}
/** Оценка трудозатрат команды (не норматив): дерево 30 мин, куст 15, цветы 1 мин/шт. */
function estimateMinutes(items: ProjectItem[], byId: Map<string, Species>) {
  return Math.max(30, items.reduce((a, i) => a + i.quantity * ({ tree: 30, shrub: 15, flower: 1 }[byId.get(i.speciesId)?.form ?? 'shrub']), 0));
}
