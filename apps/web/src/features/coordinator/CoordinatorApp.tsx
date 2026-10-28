import type { ReactElement } from 'react';
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
import './coordinator.css';
import './v2.css';
import './v3.css';

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
];

export function CoordinatorApp() {
  const { path } = useRoute();
  const page = PAGES.find(([p]) => path === p || path.startsWith(p + '/'))?.[1] ?? (() => <HomePage />);
  return <Shell>{page()}</Shell>;
}
