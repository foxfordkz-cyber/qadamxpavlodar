import { useEffect, useMemo, useState } from 'react';
import { useData, useResource } from '../../../shared/api/DataProvider';
import { ApiError } from '../../../shared/api/transport';
import type { CandidateSite, PlantSelection } from '../../../shared/api/types';
import { Badge, Button, DataClassTag, ErrorNote, Limitations, MethodLine, MissingList, StateView, useGuarded } from '../../../shared/ui/components';
import { t } from '../../../shared/i18n';
import { fmtDateTime } from '../../../shared/format';
import { hrefFor } from '../../../shared/router';
import { eligibilityOf } from './eligibility';
import type { TaskDraft } from '../tasks/TaskForm';

export function PlantSelectionPanel({ site }: { site: CandidateSite; onCreateTask?: (d: TaskDraft) => void }) {
  const { api } = useData();
  const catalog = useResource(() => api.species(), []);
  const [sel, setSel] = useState<PlantSelection | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [picked, setPicked] = useState<string[]>([]); // отметки для сравнения; в проект виды выбираются в редакторе
  const { run, busy } = useGuarded();
  const byId = useMemo(() => new Map((catalog.data ?? []).map((s) => [s.id, s])), [catalog.data]);
  const canPlant = eligibilityOf(site) === 'planting_candidate';

  const load = () =>
    run(async () => {
      setError(null);
      try {
        setSel(await api.plantSelection(site.id));
      } catch (e) {
        setSel(null);
        setError(e);
      }
    });
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const aiDown = error instanceof ApiError && error.status === 503;

  return (
    <div className="gp-selection">
      <p className="gp-alert gp-alert--info gp-small"><span aria-hidden="true">ⓘ </span>{t('sel.notDecision')}</p>
      {busy && !sel && <div className="gp-state" role="status"><span className="gp-spinner" aria-hidden="true" /> {t('state.loading')}</div>}
      {aiDown ? (
        <div className="gp-alert gp-alert--warn" role="alert">
          <span aria-hidden="true">⚠ </span>{t('sel.aiDown')} <a href={hrefFor('/species')}>{t('nav.species')}</a>
          <div className="gp-btn-row"><Button onClick={load} busy={busy}>{t('state.retry')}</Button></div>
        </div>
      ) : (
        <ErrorNote error={error} />
      )}
      {sel && (
        <>
          <MethodLine method={sel.method} />
          <p className="gp-small gp-muted">{t('sel.inputVersion', { v: sel.inputVersion })} · {fmtDateTime(sel.createdAt)}</p>
          <div className="gp-grid-2">
            <div className="gp-limits"><h4>{t('sel.assumptions')}</h4><ul>{sel.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>
            <MissingList items={sel.missingData} />
          </div>
          <StateView loading={catalog.loading} error={catalog.error} hasData={!!catalog.data} onRetry={catalog.reload}>
            <ul className="gp-species-list">
              {sel.items.map((it) => {
                const sp = byId.get(it.speciesId);
                return (
                  <li key={it.speciesId} className="gp-card gp-species-item">
                    <label className="gp-species-item__head">
                      <input type="checkbox" checked={picked.includes(it.speciesId)} onChange={() => toggle(it.speciesId)} aria-label={`${t('sel.pick')}: ${sp?.nameRu ?? it.speciesId}`} />
                      <span><strong>{sp?.nameRu ?? it.speciesId}</strong> <i className="gp-muted">{sp?.latin}</i></span>
                      {it.fit === 'suitable' ? <Badge tone="ok" icon="✓">{t('sel.suitable')}</Badge> : <Badge tone="warn" icon="!">{t('sel.conditional')}</Badge>}
                      {sp && <span className="gp-muted gp-small">{t(`species.form.${sp.form}`)}</span>}
                      {sp && <DataClassTag value={sp.dataClass} />}
                    </label>
                    {it.reasons.length > 0 && <div className="gp-small"><strong>{t('sel.reasons')}:</strong> {it.reasons.join(' ')}</div>}
                    {it.cautions.length > 0 && <div className="gp-small gp-caution"><strong><span aria-hidden="true">! </span>{t('sel.cautions')}:</strong> {it.cautions.join(' ')}</div>}
                  </li>
                );
              })}
            </ul>
            {sel.excluded.length > 0 && (
              <details className="gp-excluded">
                <summary>{t('sel.excluded')}: {sel.excluded.length}</summary>
                <ul className="gp-small">{sel.excluded.map((x) => <li key={x.speciesId}><strong>{byId.get(x.speciesId)?.nameRu ?? x.speciesId}</strong> — {x.reason}</li>)}</ul>
              </details>
            )}
          </StateView>
          <Limitations items={sel.limitations} />
        </>
      )}
      <div className="gp-selection__foot">
        <span className="gp-small">{t('sel.picked', { n: picked.length })}</span>
        <Button onClick={load} busy={busy}>↻ {t('sel.rerun')}</Button>
        <a className="gp-btn gp-btn--primary" href={hrefFor('/projects/new', { site: site.id })}>＋ {t('sel.toProject')}</a>
        <p className="gp-small gp-muted"><span aria-hidden="true">ⓘ </span>{canPlant ? t('sel.projectNote') : t('site.plantingBlocked')}</p>
      </div>
    </div>
  );
}

