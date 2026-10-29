// Сводка плана дня по бригадам (UTC+5). Общая для тестового источника и режима api (v2compat):
// сервер V2 хранит задания и бригады, а сводку и предупреждения экран получает одинаково.
import type { Brigade, DayPlanSummary, Task } from './types';

export function dayOf(iso: string) {
  return new Date(Date.parse(iso) + 5 * 3600e3).toISOString().slice(0, 10);
}

export function daySummary(date: string, allTasks: Task[], brigades: Brigade[]): { tasks: Task[]; summary: DayPlanSummary } {
  const tasks = allTasks.filter((t) => t.brigadeId && t.scheduledStart && dayOf(t.scheduledStart) === date && t.status !== 'verified');
  const warnings: string[] = [];
  const byBrigade = brigades.map((b) => {
    const list = tasks.filter((t) => t.brigadeId === b.id);
    const minutes = list.reduce((a, t) => a + t.estimatedMinutes, 0);
    if (minutes > b.capacityMinutes) warnings.push(`${b.name}: ${minutes} мин работ при ёмкости смены ${b.capacityMinutes} мин.`);
    return { brigadeId: b.id, tasks: list.length, minutes };
  });
  for (const t of tasks) {
    const b = brigades.find((x) => x.id === t.brigadeId);
    if (b && t.scheduledEnd && t.scheduledEnd > b.shiftEnd) warnings.push(`${t.id}: работа заканчивается после конца смены бригады (${b.name}).`);
  }
  for (const t of tasks) if (!t.crewIds?.length) warnings.push(`${t.id}: бригада выбрана, но бригадир ещё не собрал состав (нужно ≥${t.minCrew ?? 1}).`);
  const unassigned = allTasks.filter((t) => t.status === 'draft' && !t.brigadeId && (t.priority === 'high' || t.priority === 'critical'));
  if (unassigned.length) warnings.push(`Без бригады остаются приоритетные задания: ${unassigned.map((t) => t.id).join(', ')}.`);
  const unscheduled = allTasks.filter((t) => t.brigadeId && !t.scheduledStart && t.status === 'assigned');
  if (unscheduled.length) warnings.push(`Без времени начала: ${unscheduled.map((t) => t.id).join(', ')} — в план дня не попали.`);
  return { tasks, summary: { tasks: tasks.length, byBrigade, warnings } };
}
