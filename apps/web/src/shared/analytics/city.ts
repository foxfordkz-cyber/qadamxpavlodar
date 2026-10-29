// Проблемные зоны (ТЗ 3.2) и приоритет озеленения с дорожной картой под бюджет (ТЗ 3.7).
import type { CandidateSite, Species } from '../api/types';
import type { Rates } from './rates';
import { analyzeZone } from './plan';
import { SALINITY_LABEL, soilFor } from './zone';

export type ProblemType = 'deficit' | 'degradation' | 'soil' | 'heat' | 'unprotected';
export type Severity = 'high' | 'medium' | 'low';
export const PROBLEM_LABEL: Record<ProblemType, string> = { deficit: 'Дефицит озеленения', degradation: 'Деградация насаждений', soil: 'Неблагоприятная почва', heat: 'Остров тепла', unprotected: 'Нет защитной зелёной полосы' };

export interface Problem {
  id: string;
  siteId: string;
  type: ProblemType;
  severity: Severity;
  cause: string;
  action: string;
  dataNote: string | null;
}

export function detectProblems(sites: CandidateSite[]): { problems: Problem[]; notDetectable: string[] } {
  const out: Problem[] = [];
  for (const s of sites) {
    const ctx = s.context ?? {};
    const share = ctx.greenShare200m ?? null;
    const gap = s.factors.greeneryGap.value;
    if (share !== null && gap !== null && (share < 0.1 || gap >= 60)) {
      const sev: Severity = share < 0.03 || gap >= 80 ? 'high' : share < 0.08 ? 'medium' : 'low';
      out.push({ id: `${s.id}-deficit`, siteId: s.id, type: 'deficit', severity: sev, cause: `Зелени в радиусе 200 м: ${Math.round(share * 100)}%; до ближайшей зелёной зоны ≈${ctx.distanceToGreenM ?? '?'} м.`, action: 'Включить в первоочередное озеленение: деревья + кустарники.', dataNote: 'Доля на жителя не рассчитана: нет данных о населении.' });
    }
    const soil = soilFor(s.centroid!.lat, s.centroid!.lng);
    if (soil.salinity === 'medium' || soil.salinity === 'high') {
      out.push({ id: `${s.id}-soil`, siteId: s.id, type: 'soil', severity: soil.salinity === 'high' ? 'high' : 'medium', cause: `Засоление ${SALINITY_LABEL[soil.salinity]}, pH ${soil.ph}, почва ${soil.type}.`, action: 'Гипсование или промывка; солеустойчивые виды (лох, тамарикс, карагана, вяз).', dataNote: 'Синтетический слой почв — заменить картой почв организатора.' });
    }
    const bld = ctx.buildings200m ?? 0;
    if (bld >= 30 && (share ?? 1) < 0.08) {
      out.push({ id: `${s.id}-heat`, siteId: s.id, type: 'heat', severity: bld >= 50 ? 'high' : 'medium', cause: `Плотная застройка (${bld} зданий в 200 м) и мало зелени.`, action: 'Деревья с широкой кроной для тени.', dataNote: 'Оценка по застройке: данных о температуре поверхности нет.' });
    }
    const road = ctx.nearestMajorRoadM ?? null;
    const social = ctx.socialWithin400m ?? [];
    const trees = ctx.osmTrees150m ?? 0;
    if ((road !== null && road < 40 && trees < 5) || (social.length > 0 && trees < 3 && (share ?? 1) < 0.1)) {
      out.push({ id: `${s.id}-unprotected`, siteId: s.id, type: 'unprotected', severity: road !== null && road < 25 && social.length ? 'high' : 'medium', cause: road !== null && road < 40 ? `Магистраль в ≈${road} м, деревьев OSM рядом: ${trees}.` : `Рядом соцобъекты (${social.slice(0, 2).join(', ')}), деревьев OSM: ${trees}.`, action: 'Защитная полоса: ряд деревьев + живая изгородь из солеустойчивых кустарников.', dataNote: 'Деревья в OSM нанесены неполно.' });
    }
  }
  const sev = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => sev[a.severity] - sev[b.severity]);
  return { problems: out, notDetectable: ['Деградация насаждений: нужна карта насаждений организатора с состоянием деревьев — пока не выявляется.'] };
}

export type PriorityFactor = 'deficit' | 'density' | 'social' | 'load' | 'soil' | 'benefit';
export const PRIORITY_LABEL: Record<PriorityFactor, string> = { deficit: 'Дефицит зелени', density: 'Плотность застройки', social: 'Социальные объекты рядом', load: 'Тепловая и воздушная нагрузка', soil: 'Состояние почвы', benefit: 'Выгода / затраты' };
export const DEFAULT_PRIORITY_WEIGHTS: Record<PriorityFactor, number> = { deficit: 0.25, density: 0.15, social: 0.2, load: 0.15, soil: 0.1, benefit: 0.15 };

export interface PriorityItem {
  siteId: string;
  index: number;
  factors: Record<PriorityFactor, number>;
  cost: number;
  co2t20: number;
  explanation: string[];
}

export function priorities(sites: CandidateSite[], catalog: Species[], rates: Rates, weights: Record<PriorityFactor, number>) {
  const raw = sites.map((s) => {
    const a = analyzeZone(s, catalog, rates, { variant: 'optimal' });
    const ctx = s.context ?? {};
    const sal = a.facts.soil.salinity;
    const road = ctx.nearestMajorRoadM ?? null;
    const e20 = a.effect.find((e) => e.years === 20)!;
    return { s, a, bld: ctx.buildings200m ?? 0, social: (ctx.socialWithin400m ?? []).length, share: ctx.greenShare200m ?? 0, load: (road !== null ? Math.max(0, 1 - road / 150) : 0) * 0.6 + Math.min(1, (ctx.buildings200m ?? 0) / 60) * 0.4, soil: { none: 100, low: 75, medium: 45, high: 20 }[sal], eff: a.cost.total > 0 ? e20.co2t / a.cost.total : 0, cost: a.cost.total, co2: e20.co2t };
  });
  const maxB = Math.max(1, ...raw.map((r) => r.bld));
  const maxE = Math.max(1e-9, ...raw.map((r) => r.eff));
  const wSum = Object.values(weights).reduce((x, y) => x + y, 0) || 1;
  const items: PriorityItem[] = raw.map((r) => {
    const f: Record<PriorityFactor, number> = {
      deficit: Math.round(Math.max(0, 1 - r.share / 0.3) * 100),
      density: Math.round((r.bld / maxB) * 100),
      social: Math.min(100, r.social * 25),
      load: Math.round(r.load * 100),
      soil: r.soil,
      benefit: Math.round((r.eff / maxE) * 100),
    };
    const index = Math.round((Object.keys(f) as PriorityFactor[]).reduce((acc, k) => acc + f[k] * weights[k], 0) / wSum);
    const top = (Object.keys(f) as PriorityFactor[]).map((k) => ({ k, c: f[k] * weights[k] })).sort((a, b) => b.c - a.c).slice(0, 2);
    return { siteId: r.s.id, index, factors: f, cost: r.cost, co2t20: r.co2, explanation: top.map((t) => `${PRIORITY_LABEL[t.k]}: ${f[t.k]}/100`) };
  });
  items.sort((a, b) => b.index - a.index);
  return items;
}

/** Дорожная карта: по убыванию приоритета, пока помещается в бюджет (жадно; не оптимум). */
export function roadmap(items: PriorityItem[], budget: number) {
  const chosen: PriorityItem[] = [];
  let spent = 0;
  for (const it of items) {
    if (spent + it.cost <= budget) {
      chosen.push(it);
      spent += it.cost;
    }
  }
  return { chosen, spent, left: budget - spent, co2t20: chosen.reduce((a, i) => a + i.co2t20, 0), method: 'Жадный выбор по убыванию индекса приоритета в пределах бюджета. Это эвристика, не математический оптимум.' };
}
