import { useCallback } from 'react';
import { useData } from '../../../shared/api/DataProvider';
import { useMe } from '../me';
import { t } from '../../../shared/i18n';
import { createOutcomeCohort } from '../../../shared/analytics/outcomes';
import { OutcomesPanel } from './OutcomesPanel';
import { loadOutcomePlans } from './pageModel';

/** Connect PR #21's compact view to the same repository as the dedicated workflow page. */
export function OutcomeZonePanel({ siteId, requestKey }: { siteId: string; requestKey: string }) {
  const { api, revision } = useData();
  const me = useMe();
  const load = useCallback(async (signal: AbortSignal) => {
    const [plans, history] = await Promise.all([loadOutcomePlans(api, siteId, true), api.outcomes.list(siteId)]);
    signal.throwIfAborted();
    if (history.siteId !== siteId) throw new Error('site_mismatch');
    return { variants: plans.variants, catalog: plans.inputs[0].catalog, asOf: history.asOf,
      cohorts: history.cohorts.map(candidate => ({
        cohort: createOutcomeCohort({ ...candidate, plants: candidate.plants.map(p => ({ ...p })),
          provenance: { ...candidate.provenance, evidenceIds: [...candidate.provenance.evidenceIds] } }, history.registry, history.asOf),
        latestInspection: history.inspections.filter(i => i.cohortId === candidate.id)
          .sort((a, b) => b.observedOn.localeCompare(a.observedOn) || b.provenance.capturedAt.localeCompare(a.provenance.capturedAt))[0] ?? null,
      })) };
  }, [api, siteId, revision, me.id]);
  return <><p className="gp-small gp-muted">{t('outcomePage.planNote')}</p>
    <OutcomesPanel siteId={siteId} requestKey={requestKey} load={api.outcomes.available ? load : undefined} /></>;
}
