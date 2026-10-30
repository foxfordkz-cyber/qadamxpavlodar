import { useEffect, useState, type ReactElement } from 'react';
import { t } from '../../shared/i18n';
import { useLanguage } from '../../shared/i18n/useLanguage';
import { useRoute } from '../../shared/router';
import { Shell } from './Shell';
import { HomePage } from './home/HomePage';
import { SitesPage } from './sites/SitesPage';
import { RankingPage } from './ranking/RankingPage';
import { SpeciesPage } from './species/SpeciesPage';
import { TasksPage } from './tasks/TasksPage';
import { ReportsPage } from './reports/ReportsPage';
import { ProjectsPage } from './projects/ProjectsPage';
import { ApprovalPage } from './approval/ApprovalPage';
import { PeoplePage } from './PeoplePage';
import { GuidePage } from './guide/GuidePage';
import { ProblemsPage } from './tz/ProblemsPage';
import { PrioritiesPage } from './tz/PrioritiesPage';
import { RatesPage } from './tz/RatesPage';
import { ImportPage } from './tz/ImportPage';
import { ReportPage } from './tz/ReportPage';
import { OutcomesPage } from './outcomes/OutcomesPage';
import './coordinator.css';
import './v2.css';
import './v3.css';
import './tz.css';
import './look.css';

const PAGES: [string, () => ReactElement][] = [
  ['/map', () => <SitesPage />],
  ['/projects', () => <ProjectsPage />],
  ['/approval', () => <ApprovalPage />],
  ['/tasks', () => <TasksPage />],
  ['/reports', () => <ReportsPage />],
  ['/ranking', () => <RankingPage />],
  ['/species', () => <SpeciesPage />],
  ['/people', () => <PeoplePage />],
  ['/guide', () => <GuidePage />],
  ['/problems', () => <ProblemsPage />],
  ['/priorities', () => <PrioritiesPage />],
  ['/rates', () => <RatesPage />],
  ['/import', () => <ImportPage />],
  ['/report', () => <ReportPage />],
  ['/outcomes', () => <OutcomesPage />],
];

const PRESENT_KEY = 'gp-present';
function readPresent() {
  if (new URLSearchParams(location.search).has('present')) return true;
  try { return localStorage.getItem(PRESENT_KEY) === '1'; } catch { return false; }
}

/** Режим презентации для защиты: крупнее текст, без служебной строки. Alt+P или ?present=1 в адресе. */
function usePresentation() {
  const [on, setOn] = useState(readPresent);
  useEffect(() => {
    document.documentElement.classList.toggle('gp-present', on);
    try { localStorage.setItem(PRESENT_KEY, on ? '1' : '0'); } catch { /* без хранилища — до перезагрузки */ }
  }, [on]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.altKey && e.code === 'KeyP') { e.preventDefault(); setOn((v) => !v); } };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, []);
  return [on, setOn] as const;
}

export function CoordinatorApp() {
  useLanguage();
  const { path } = useRoute();
  const [present, setPresent] = usePresentation();
  const page = PAGES.find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? (() => <HomePage />);
  return (
    <>
      <Shell>{page()}</Shell>
      {present && <button className="gp-present-pill" onClick={() => setPresent(false)} title="Alt+P">{t('present.exit')}</button>}
    </>
  );
}
