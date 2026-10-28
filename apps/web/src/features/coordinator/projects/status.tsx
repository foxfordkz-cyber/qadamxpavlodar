import type { PlantingProject, Task } from '../../../shared/api/types';
import { Badge } from '../../../shared/ui/components';
import { t } from '../../../shared/i18n';

/** Статус проекта отдельно от графика, задачи и приёмки: «согласован» ≠ «посажено». */
export function ProjectStatusBadge({ p }: { p: PlantingProject }) {
  if (p.implementedAt) return <Badge tone="ok" icon="❦">{t('project.status.implemented')}</Badge>;
  switch (p.status) {
    case 'draft':
      return <Badge tone="neutral" icon="✎">{p.approved ? t('project.status.draftAfterApproval', { v: p.approved.designVersion }) : t('project.status.draft')}</Badge>;
    case 'submitted':
      return <Badge tone="warn" icon="◔">{t('project.status.submitted')}</Badge>;
    case 'approved':
      return <Badge tone="ok" icon="✓">{t('project.status.approved')}</Badge>;
    case 'returned':
      return <Badge tone="bad" icon="↩">{t('project.status.returned')}</Badge>;
  }
}

/** Четыре независимых статуса (B22). */
export function LifecycleStrip({ p, tasks, reportPending }: { p: PlantingProject; tasks: Task[]; reportPending: boolean }) {
  const planting = tasks.filter((x) => x.action === 'plant' && x.projectId === p.id);
  const last = planting.at(-1);
  const scheduled = planting.some((x) => x.scheduledStart);
  return (
    <ol className="gp-lifecycle" aria-label={t('project.lifecycle')}>
      <li><span className="gp-lifecycle__k">{t('project.lc.project')}</span><ProjectStatusBadge p={p} /></li>
      <li><span className="gp-lifecycle__k">{t('project.lc.schedule')}</span>{scheduled ? <Badge tone="info" icon="◷">{t('project.lc.scheduled')}</Badge> : <Badge tone="neutral" icon="○">{t('project.lc.notScheduled')}</Badge>}</li>
      <li><span className="gp-lifecycle__k">{t('project.lc.task')}</span>{last ? <Badge tone="info">{last.id} · {t(`status.${last.status}`)}</Badge> : <Badge tone="neutral" icon="○">{t('project.lc.noTask')}</Badge>}</li>
      <li><span className="gp-lifecycle__k">{t('project.lc.acceptance')}</span>{p.implementedAt ? <Badge tone="ok" icon="✓">{t('project.lc.accepted')}</Badge> : reportPending ? <Badge tone="warn" icon="◕">{t('project.lc.reportPending')}</Badge> : <Badge tone="neutral" icon="○">{t('project.lc.notAccepted')}</Badge>}</li>
    </ol>
  );
}
