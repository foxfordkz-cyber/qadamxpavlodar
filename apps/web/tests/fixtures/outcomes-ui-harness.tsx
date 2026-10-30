// Development/test entry only. Not linked or imported by the application.
import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OutcomesPanel } from '../../src/features/coordinator/outcomes/OutcomesPanel';
import type { OutcomesData, OutcomesLoader } from '../../src/features/coordinator/outcomes/model';
import { LanguageSwitcher } from '../../src/shared/i18n/LanguageSwitcher';
import { ApiError } from '../../src/shared/api/transport';
import { fixtureSite, outcomesFixture, fixtureInput } from './outcomes-ui';
import { calculateOutcomeVariant } from '../../src/shared/analytics/outcomes';
import '../../src/shared/ui/theme.css';
import '../../src/features/coordinator/coordinator.css';
import '../../src/features/coordinator/tz.css';

function Harness() {
  const scenario = new URLSearchParams(location.search).get('case') ?? 'ready';
  const [request, setRequest] = useState('first');
  const load = useMemo<OutcomesLoader>(() => {
    let attempts = 0;
    return async () => {
      attempts++;
      await new Promise(resolve => setTimeout(resolve, scenario === 'loading' ? 60000 : scenario === 'race' && request === 'first' ? 2000 : 80));
      if (scenario === 'retry' && attempts === 1) throw new ApiError(503, 'test_failure', 'Deliberate test error');
      const data: OutcomesData = outcomesFixture();
      if (scenario === 'empty' || request === 'second') return { ...data, variants: [], cohorts: [] };
      if (scenario === 'invalid') data.variants[0].siteId = 'foreign-site';
      if (scenario === 'incomplete') {
        const input = fixtureInput(); input.rates.find(r => r.key === 'care.tree')!.value = null;
        data.variants = [calculateOutcomeVariant(input)]; data.cohorts = [];
      }
      if (scenario === 'partial') {
        const entry = data.cohorts[0]; data.cohorts = [entry];
        entry.latestInspection = { ...entry.latestInspection!, observations: entry.latestInspection!.observations.slice(0, 16) };
      }
      return data;
    };
  }, [scenario, request]);
  return <main style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
    <p style={{ position: 'sticky', top: 0, zIndex: 5, padding: 12, background: '#fff1cc', fontWeight: 600 }}>Изолированный тест UI · синтетические данные · без API</p>
    <LanguageSwitcher />
    {scenario === 'race' && <button onClick={() => setRequest('second')}>Switch request</button>}
    <OutcomesPanel siteId={fixtureSite.id} requestKey={request} load={scenario === 'unavailable' ? undefined : load} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
