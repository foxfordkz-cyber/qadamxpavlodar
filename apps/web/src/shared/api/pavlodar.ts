// Проверенные данные о Павлодаре (исследование 29.10.2026, fixtures/pavlodar): источники, факты и климат.
// Общие для тестового источника, сервера apps/server и ассистента: факты — со ссылками на источники,
// null и «не найдено» сохраняются как есть (не ноль). Подробности и оговорки — fixtures/pavlodar/SOURCE-NOTES.txt.
import sources from '../../../../../fixtures/pavlodar/sources.json';
import facts from '../../../../../fixtures/pavlodar/facts.json';
import climate from '../../../../../fixtures/pavlodar/climate.json';
import type { EvidenceRef } from './types';

export type FactTopic = 'climate' | 'norms' | 'air' | 'green' | 'prices' | 'population' | 'social' | 'soil' | 'districts' | 'problems';
export interface PavlodarFact {
  id: string;
  topic: FactTopic;
  title: string;
  text: string;
  dataClass: 'real' | 'estimate';
  evidenceIds: string[];
  /** Факт об отсутствии данных: что именно не найдено в проверенных источниках. */
  gap?: boolean;
}
export type PavlodarSource = EvidenceRef & { publishedAt: string | null };

export const TOPIC_LABEL: Record<FactTopic, string> = {
  climate: 'Климат', norms: 'Нормы и правила озеленения', air: 'Воздух', green: 'Зелёный фонд и посадки', prices: 'Цены из госзакупок',
  population: 'Население и территория', social: 'Социальные объекты', soil: 'Почвы', districts: 'Микрорайоны', problems: 'Сигналы для обследования',
};
export const pavlodarSources = sources as PavlodarSource[];
export const pavlodarFacts = facts as PavlodarFact[];
export const pavlodarClimate = climate;
export const RESEARCH_DATE = '2026-10-29';

const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
/** Основы слов запроса: «морозы», «мороза» → «мороз». */
const stems = (q: string) => norm(q).split(/[^a-zа-я0-9-]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, Math.max(3, Math.min(6, w.length - 1))));

/** Поиск фактов по словам запроса: совпадения в заголовке весят больше. Пусто — ничего не нашлось. */
export function searchFacts(query: string, limit = 3): PavlodarFact[] {
  const keys = stems(query);
  if (!keys.length) return [];
  return pavlodarFacts
    .map((f) => ({ f, n: keys.filter((k) => norm(f.title).includes(k)).length * 2 + keys.filter((k) => norm(f.text).includes(k)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((x) => x.f);
}

/** Источники фактов в форме, которую показывают экраны и ассистент. */
export function factSources(list: PavlodarFact[]) {
  const ids = [...new Set(list.flatMap((f) => f.evidenceIds))];
  return ids.map((id) => pavlodarSources.find((s) => s.id === id)).filter((s): s is PavlodarSource => !!s).map((s) => ({ id: s.id, label: s.sourceLabel, ...(s.sourceUrl ? { url: s.sourceUrl } : {}) }));
}

/** Ответ GET /reference/facts — одинаковый в тестовом источнике и на сервере. */
export function referenceFacts() {
  return {
    data: { facts: pavlodarFacts, sources: pavlodarSources, climate: pavlodarClimate },
    meta: { researchedAt: RESEARCH_DATE, note: 'Проверенные открытые источники; null — не найдено, а не ноль. Население, границы микрорайонов и цены на саженцы пока не найдены.' },
  };
}
