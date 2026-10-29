// @ts-nocheck
// Team rules snapshot: coordinator 8456529; no LLM or calibrated prediction.
// Аналитика зоны (ТЗ 3.3–3.8): подбор с оценкой 0–100, схема посадки, смета, приживаемость,
// уход, экологический эффект. Чистые функции без доступа к базе — участник 1 переносит их на сервер.
// Все результаты оценочные (ТЗ 5.2); допущения перечислены в assumptions.
import type { CandidateSite, Species } from './types.js';
import type { Rates } from './rates.js';
import { guessPurpose, lightLevel, PURPOSE_LABEL, SALINITY_LABEL, soilFor, type Purpose, type SoilInfo } from './zone.js';

export type Variant = 'econom' | 'optimal' | 'max';
export const VARIANT_LABEL: Record<Variant, string> = { econom: 'Эконом', optimal: 'Оптимальный', max: 'Максимальный эффект' };

export interface PlanOptions {
  variant: Variant;
  purpose?: Purpose;
  careYears: 1 | 2 | 3;
  excluded: string[];
  locked: string[];
  replacements: Record<string, string>;
  watering: 'regular' | 'rare' | 'none';
  improveSoil: boolean;
  maxSpeciesShare: number; // 0..1
}
export const DEFAULT_OPTIONS: PlanOptions = { variant: 'optimal', careYears: 2, excluded: [], locked: [], replacements: {}, watering: 'regular', improveSoil: false, maxSpeciesShare: 0.3 };

export interface ScoredSpecies {
  speciesId: string;
  score: number;
  excludedBy: string | null;
  reasons: string[];
  penalties: string[];
  factors: { climate: number; soil: number; urban: number; purpose: number; local: number };
}

export interface SchemeRow { speciesId: string; tier: 'tree' | 'shrub' | 'flower'; quantity: number; locked: boolean; replacedFrom?: string }
export interface CostItem { key: string; label: string; amount: number; formula: string; dataClass: 'demo' | 'estimate' }
export interface SurvivalRow { speciesId: string; y1: number; y2: number; y3: number; low: number; high: number; risks: { label: string; pp: number }[] }
export interface Measure { label: string; effect: string; apply: Partial<PlanOptions> | { replace: [string, string] } }
export interface CareRow { month: number; operation: string; detail: string; visits: number }
export interface EffectRow { years: 5 | 10 | 20; co2t: number; o2t: number; rainM3: number; coolingC: number; canopyM2: number; dustKg: number | null }

export interface ZoneAnalysis {
  siteId: string;
  options: PlanOptions;
  facts: { areaM2: number | null; soil: SoilInfo; purpose: Purpose; purposeLabel: string; light: string; greenShare: number | null; nearRoadM: number | null; social: string[]; buildings200: number | null };
  ranked: ScoredSpecies[];
  scheme: SchemeRow[];
  tiersNote: string;
  cost: { items: CostItem[]; total: number; perM2: number | null };
  survival: SurvivalRow[];
  survivalAvg: { y1: number; y2: number; y3: number };
  measures: Measure[];
  care: CareRow[];
  careWarnings: string[];
  effect: EffectRow[];
  costPerTonCo2: number | null;
  before: { canopyM2: number; greenShare: number | null };
  assumptions: string[];
  missing: string[];
  method: 'rules';
}

const LV = { low: 0, medium: 1, high: 2 } as const;
const clamp = (v: number, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const salRank = { none: 0, low: 1, medium: 2, high: 3 } as const;
const PURPOSE_USE: Record<Purpose, string[]> = { park: ['square', 'greenbelt', 'alley'], square: ['square', 'yard'], yard: ['yard', 'hedge'], street: ['alley', 'roadside'], sanitary: ['greenbelt', 'roadside', 'hedge'], school: ['yard', 'square', 'hedge'] };
const POISONOUS = new Set(['sp-juniperus-sabina']);
const THORNY = new Set(['sp-elaeagnus-angustifolia', 'sp-rosa-majalis', 'sp-berberis-vulgaris', 'sp-crataegus-sanguinea', 'sp-hippophae-rhamnoides', 'sp-rosa-rugosa']);

/** Подбор: жёсткие ограничения + оценка пригодности 0–100 (ТЗ 3.3.2). */
export function scoreSpecies(site: CandidateSite, catalog: Species[], purpose: Purpose, soil: SoilInfo): ScoredSpecies[] {
  const water = site.factors.waterAvailability.value;
  const road = site.context?.nearestMajorRoadM ?? null;
  const area = site.areaM2 ?? 0;
  const utilities = site.checks.utilities.state;
  const sensitive = purpose === 'school';
  const light = lightLevel(site, site.context?.buildings200m ?? 0);
  return catalog
    .map((sp) => {
      const reasons: string[] = [];
      const penalties: string[] = [];
      let excludedBy: string | null = null;
      if (sp.invasiveRisk && sp.id === 'sp-acer-negundo') excludedBy = 'Инвазивный вид.';
      else if (sp.form === 'tree' && utilities === 'blocked') excludedBy = 'Сети отмечены как ограничение — деревья запрещены.';
      else if (area < sp.minAreaM2) excludedBy = `Площадь ${area} м² меньше ориентира ${sp.minAreaM2} м².`;
      else if (sensitive && (sp.allergenic || POISONOUS.has(sp.id))) excludedBy = 'Аллерген или ядовитое растение — не для школьной территории.';
      else if (sensitive && THORNY.has(sp.id)) excludedBy = 'Колючее — не для детской территории.';
      else if (soil.salinity === 'high' && sp.saltTolerance === 'low') excludedBy = 'Сильное засоление почвы, а вид не солеустойчив.';
      // Климат: мороз и засуха с учётом известной воды.
      const frost = sp.frostHardiness === 'high' ? 100 : sp.frostHardiness === 'medium' ? 65 : sp.form === 'flower' ? 70 : 30;
      const drought = water === null || water < 40 ? [30, 65, 100][LV[sp.droughtTolerance]] : [75, 90, 100][LV[sp.droughtTolerance]];
      const climate = (frost + drought) / 2;
      if (sp.frostHardiness === 'high') reasons.push('морозостойкий');
      if (sp.droughtTolerance === 'high') reasons.push('засухоустойчивый');
      if (water === null && sp.droughtTolerance === 'low') penalties.push('требует полива, а доступ к воде неизвестен');
      // Почва: засоление против солеустойчивости.
      const salNeed = salRank[soil.salinity];
      const salHave = [0, 2, 3][LV[sp.saltTolerance]];
      const soilScore = salNeed <= salHave ? 100 : clamp(100 - (salNeed - salHave) * 30);
      if (salNeed >= 2 && sp.saltTolerance === 'high') reasons.push('переносит засоление');
      if (salNeed > salHave) penalties.push(`засоление почвы (${SALINITY_LABEL[soil.salinity]}) выше устойчивости вида`);
      // Городская нагрузка: дорога и пыль.
      const urban = road !== null && road < 50 ? [35, 70, 100][LV[sp.saltTolerance]] : 90;
      if (road !== null && road < 50 && sp.saltTolerance === 'low') penalties.push('у магистрали — реагенты и пыль');
      // Назначение зоны и освещённость.
      const uses = sp.uses ?? [];
      let purposeScore = sp.form === 'flower' ? (purpose === 'street' || purpose === 'sanitary' ? 40 : 75) : uses.some((u) => PURPOSE_USE[purpose].includes(u)) ? 100 : 55;
      if (light === 'тень' && sp.form !== 'flower' && sp.id !== 'sp-hosta') purposeScore -= 15;
      if (uses.some((u) => PURPOSE_USE[purpose].includes(u))) reasons.push(`подходит для: ${PURPOSE_LABEL[purpose].toLowerCase()}`);
      const local = (sp.pavlodarEvidenceId ? 60 : 0) + (sp.native ? 40 : 0);
      if (sp.pavlodarEvidenceId) reasons.push('сажают в Павлодаре');
      const raw = Math.round(climate * 0.35 + soilScore * 0.25 + urban * 0.15 + purposeScore * 0.15 + local * 0.1);
      // Несовпадение по почве не компенсируется другими факторами: балл не выше 70.
      const score = salNeed > salHave ? Math.min(70, raw) : raw;
      return { speciesId: sp.id, score: excludedBy ? 0 : score, excludedBy, reasons, penalties, factors: { climate: Math.round(climate), soil: Math.round(soilScore), urban: Math.round(urban), purpose: Math.round(purposeScore), local } };
    })
    .sort((a, b) => b.score - a.score);
}

const DENSITY: Record<Variant, { treePerM2: number; shrubPerM2: number; flowerShare: number }> = {
  econom: { treePerM2: 1 / 120, shrubPerM2: 1 / 20, flowerShare: 0 },
  optimal: { treePerM2: 1 / 70, shrubPerM2: 1 / 14, flowerShare: 0.03 },
  max: { treePerM2: 1 / 45, shrubPerM2: 1 / 10, flowerShare: 0.05 },
};

/** Схема посадки: ярусы, количество на площадь, лимит доли одного вида (ТЗ 3.3.3). */
export function buildScheme(site: CandidateSite, ranked: ScoredSpecies[], catalog: Map<string, Species>, opt: PlanOptions): SchemeRow[] {
  const area = Math.max(0, site.areaM2 ?? 0);
  const d = DENSITY[opt.variant];
  const ok = ranked.filter((r) => !r.excludedBy && !opt.excluded.includes(r.speciesId) && r.score >= 50);
  const pick = (form: Species['form']) => {
    const list = ok.filter((r) => catalog.get(r.speciesId)?.form === form);
    const locked = list.filter((r) => opt.locked.includes(r.speciesId));
    const rest = list.filter((r) => !opt.locked.includes(r.speciesId));
    // Минимум столько видов, чтобы доля одного не превышала лимит.
    const n = Math.max(locked.length, Math.ceil(1 / Math.max(0.1, opt.maxSpeciesShare)));
    return [...locked, ...rest].slice(0, n);
  };
  const rows: SchemeRow[] = [];
  const add = (form: 'tree' | 'shrub' | 'flower', total: number) => {
    const sel = pick(form);
    if (!sel.length || total <= 0) return;
    const per = Math.max(1, Math.floor(total / sel.length));
    let left = total;
    sel.forEach((r, i) => {
      const q = i === sel.length - 1 ? Math.max(1, left) : per;
      left -= q;
      const replacement = opt.replacements[r.speciesId];
      rows.push({ speciesId: replacement ?? r.speciesId, tier: form, quantity: q, locked: opt.locked.includes(r.speciesId), ...(replacement ? { replacedFrom: r.speciesId } : {}) });
    });
  };
  add('tree', site.checks.utilities.state === 'blocked' ? 0 : Math.round(area * d.treePerM2));
  add('shrub', Math.round(area * d.shrubPerM2));
  add('flower', Math.round(area * d.flowerShare * 9));
  return rows;
}

export function costEstimate(site: CandidateSite, scheme: SchemeRow[], catalog: Map<string, Species>, survival: SurvivalRow[], opt: PlanOptions, rates: Rates, soil: SoilInfo): ZoneAnalysis['cost'] {
  const area = site.areaM2 ?? 0;
  const r = (k: string) => rates[k] ?? 0;
  let material = 0;
  const big = opt.variant === 'max';
  for (const row of scheme) {
    const sp = catalog.get(row.speciesId);
    const unit = sp?.pricePerUnitKzt ?? (row.tier === 'tree' ? (big ? r('price.tree.large') : r('price.tree')) : row.tier === 'shrub' ? r('price.shrub') : r('price.flower'));
    material += unit * row.quantity;
  }
  const count = (t: SchemeRow['tier']) => scheme.filter((s) => s.tier === t).reduce((a, s) => a + s.quantity, 0);
  const [nT, nS, nF] = [count('tree'), count('shrub'), count('flower')];
  const prepArea = opt.variant === 'econom' ? area * 0.3 : area * 0.6;
  const salinity = soil.salinity === 'medium' || soil.salinity === 'high' || opt.improveSoil;
  const prep = prepArea * (r('soil.prep') + (salinity ? r('soil.salinity') : 0));
  const work = nT * r('work.tree') + nS * r('work.shrub') + nF * r('work.flower');
  const delivery = (material * r('delivery.share')) / 100;
  const care = opt.careYears * (nT * r('care.tree') + nS * r('care.shrub') + nF * r('care.flower'));
  const survBy = new Map(survival.map((s) => [s.speciesId, s.y1]));
  let reserve = 0;
  for (const row of scheme) {
    const sp = catalog.get(row.speciesId);
    const unit = sp?.pricePerUnitKzt ?? (row.tier === 'tree' ? (big ? r('price.tree.large') : r('price.tree')) : row.tier === 'shrub' ? r('price.shrub') : r('price.flower'));
    reserve += unit * row.quantity * (1 - (survBy.get(row.speciesId) ?? 80) / 100);
  }
  const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU');
  const items: CostItem[] = [
    { key: 'material', label: 'Посадочный материал', amount: material, formula: `Σ(цена × количество): деревья ${nT}, кусты ${nS}, цветы ${nF}${big ? ', крупномеры' : ''}`, dataClass: 'demo' },
    { key: 'prep', label: 'Подготовка территории и почвы', amount: prep, formula: `${fmt(prepArea)} м² × (${r('soil.prep')}${salinity ? ` + ${r('soil.salinity')} за засоление` : ''}) ₸/м²`, dataClass: 'demo' },
    { key: 'work', label: 'Посадочные работы и доставка', amount: work + delivery, formula: `работы ${fmt(work)} ₸ + доставка ${r('delivery.share')}% от материала (${fmt(delivery)} ₸)`, dataClass: 'demo' },
    { key: 'care', label: `Полив и уход (${opt.careYears} г.)`, amount: care, formula: `${opt.careYears} × (${nT}×${r('care.tree')} + ${nS}×${r('care.shrub')} + ${nF}×${r('care.flower')}) ₸`, dataClass: 'demo' },
    { key: 'reserve', label: 'Резерв на замену неприжившихся', amount: reserve, formula: 'Σ(стоимость вида × (1 − приживаемость за 1-й год))', dataClass: 'estimate' },
  ];
  const total = items.reduce((a, i) => a + i.amount, 0);
  return { items, total, perM2: area ? total / area : null };
}

/** Приживаемость: экспертные правила, п.п. по факторам риска (ТЗ 3.5). Не ML, не калибровано. */
export function survivalForecast(site: CandidateSite, scheme: SchemeRow[], catalog: Map<string, Species>, opt: PlanOptions, soil: SoilInfo, rates: Rates): SurvivalRow[] {
  const water = site.factors.waterAvailability.value;
  const road = site.context?.nearestMajorRoadM ?? null;
  const base = rates['surv.base'] ?? 88;
  const ids = [...new Set(scheme.map((s) => s.speciesId))];
  return ids.map((id) => {
    const sp = catalog.get(id);
    const risks: { label: string; pp: number }[] = [];
    if (!sp) return { speciesId: id, y1: 0, y2: 0, y3: 0, low: 0, high: 0, risks };
    const sal = salRank[soil.salinity] - (opt.improveSoil ? 1 : 0);
    const tol = [0, 2, 3][LV[sp.saltTolerance]];
    if (sal > tol) risks.push({ label: `засоление почвы (${SALINITY_LABEL[soil.salinity]}${opt.improveSoil ? ', с улучшением' : ''})`, pp: -8 * (sal - tol) });
    if (opt.watering === 'none') risks.push({ label: 'нет полива', pp: sp.droughtTolerance === 'high' ? -6 : sp.droughtTolerance === 'medium' ? -14 : -25 });
    else if (opt.watering === 'rare') risks.push({ label: 'редкий полив', pp: sp.droughtTolerance === 'high' ? -2 : sp.droughtTolerance === 'medium' ? -6 : -12 });
    if (water === null && sp.droughtTolerance !== 'high') risks.push({ label: 'доступ к воде на участке неизвестен', pp: -3 });
    if (sp.frostHardiness === 'medium') risks.push({ label: 'средняя морозостойкость', pp: -6 });
    if (sp.frostHardiness === 'low' && sp.form !== 'flower') risks.push({ label: 'низкая морозостойкость', pp: -18 });
    if (road !== null && road < 40 && sp.saltTolerance === 'low') risks.push({ label: 'у магистрали: реагенты, пыль', pp: -7 });
    if (soil.ph > 8.2 && /betula|pinus|picea|larix/.test(id)) risks.push({ label: `щелочная почва (pH ${soil.ph})`, pp: -5 });
    if (opt.variant === 'max' && sp.form === 'tree') risks.push({ label: 'крупномер: дольше адаптация, но меньше вандализма', pp: -2 });
    const y1 = clamp(base + risks.reduce((a, r) => a + r.pp, 0), 5, 99);
    const decay = opt.watering === 'regular' ? 0.97 : opt.watering === 'rare' ? 0.93 : 0.88;
    const annual = sp.form === 'flower' && /однолетник/.test(sp.nameRu);
    const y2 = annual ? 0 : clamp(Math.round(y1 * decay), 0, 99);
    const y3 = annual ? 0 : clamp(Math.round(y2 * (decay + 0.01)), 0, 99);
    const unknowns = (water === null ? 1 : 0) + 1 /* почва синтетическая */;
    const spread = 6 + unknowns * 3;
    return { speciesId: id, y1: Math.round(y1), y2, y3, low: clamp(Math.round(y1 - spread)), high: clamp(Math.round(y1 + spread)), risks };
  });
}

export function careCalendar(scheme: SchemeRow[], catalog: Map<string, Species>, soil: SoilInfo, opt: PlanOptions, rates: Rates): { care: CareRow[]; warnings: string[] } {
  const has = (t: SchemeRow['tier']) => scheme.some((s) => s.tier === t);
  const nT = scheme.filter((s) => s.tier === 'tree').reduce((a, s) => a + s.quantity, 0);
  const nS = scheme.filter((s) => s.tier === 'shrub').reduce((a, s) => a + s.quantity, 0);
  const lowDrought = scheme.some((s) => catalog.get(s.speciesId)?.droughtTolerance === 'low');
  const evergreen = scheme.some((s) => catalog.get(s.speciesId)?.evergreen);
  const hedge = scheme.some((s) => catalog.get(s.speciesId)?.uses?.includes('hedge') && s.tier === 'shrub');
  const wPerMonth: Record<number, number> = opt.watering === 'none' ? {} : { 5: 4, 6: 6, 7: 8, 8: 6, 9: 3, 10: 1 };
  const scale = opt.watering === 'rare' ? 0.5 : 1;
  const care: CareRow[] = [];
  const volT = rates['care.water.tree'] ?? 50;
  const volS = rates['care.water.shrub'] ?? 15;
  for (const [m, n0] of Object.entries(wPerMonth)) {
    const n = Math.max(1, Math.round(n0 * scale * (lowDrought ? 1.2 : 1)));
    const litres = n * (nT * volT + nS * volS);
    care.push({ month: Number(m), operation: 'Полив', detail: `${n} раз; ≈${Math.round(litres / 1000)} м³ за месяц (дерево ${volT} л, куст ${volS} л за раз)`, visits: n });
  }
  care.push({ month: 4, operation: 'Обрезка санитарная', detail: 'Удалить сухие и повреждённые ветви до распускания почек', visits: 1 });
  care.push({ month: 4, operation: 'Побелка стволов', detail: 'Защита коры от весенних ожогов', visits: 1 });
  care.push({ month: 5, operation: 'Мульчирование', detail: 'Приствольные круги 5–7 см (кора, щепа) — сохраняет влагу', visits: 1 });
  care.push({ month: 5, operation: 'Подкормка', detail: 'Комплексное удобрение по инструкции', visits: 1 });
  care.push({ month: 6, operation: 'Осмотр на вредителей и болезни', detail: 'Тля, моль, грибковые пятна; при выявлении — обработка', visits: 1 });
  if (hedge) care.push({ month: 6, operation: 'Формовка изгороди', detail: 'Стрижка после цветения', visits: 1 });
  care.push({ month: 7, operation: 'Осмотр на вредителей и болезни', detail: 'Повторный осмотр в жару', visits: 1 });
  if (hedge) care.push({ month: 8, operation: 'Формовка изгороди', detail: 'Вторая стрижка', visits: 1 });
  care.push({ month: 10, operation: 'Влагозарядковый полив', detail: 'Обильный полив перед заморозками', visits: 1 });
  care.push({ month: 10, operation: 'Побелка стволов', detail: 'Осенняя побелка от морозобоин', visits: 1 });
  care.push({ month: 11, operation: 'Зимняя защита', detail: evergreen ? 'Укрытие молодых хвойных от солнечных ожогов, обвязка кроны' : 'Защита стволов сеткой от грызунов', visits: 1 });
  if (has('flower')) care.push({ month: 5, operation: 'Высадка цветников', detail: 'Однолетники — после заморозков; многолетники — прополка', visits: 1 });
  if (soil.salinity === 'medium' || soil.salinity === 'high') care.push({ month: 4, operation: 'Мелиорация почвы', detail: 'Гипсование или промывка засолённых участков', visits: 1 });
  care.sort((a, b) => a.month - b.month);
  const warnings: string[] = [];
  const allowed = rates['care.visits'] ?? 6;
  const byMonth = new Map<number, number>();
  for (const c of care) byMonth.set(c.month, (byMonth.get(c.month) ?? 0) + c.visits);
  for (const [m, v] of byMonth) if (v > allowed) warnings.push(`Месяц ${m}: нужно ≈${v} выездов, а допустимо ${allowed}. Совместите операции или выберите засухоустойчивые виды.`);
  return { care, warnings };
}

export function ecoEffect(site: CandidateSite, scheme: SchemeRow[], catalog: Map<string, Species>, survival: SurvivalRow[], rates: Rates): EffectRow[] {
  const area = site.areaM2 ?? 0;
  const surv = new Map(survival.map((s) => [s.speciesId, s.y3 / 100]));
  const growth = { 5: 0.3, 10: 0.6, 20: 1 } as const;
  return ([5, 10, 20] as const).map((years) => {
    let co2 = 0, rain = 0, canopy = 0, trees = 0;
    for (const row of scheme) {
      const sp = catalog.get(row.speciesId);
      const alive = row.quantity * (surv.get(row.speciesId) ?? 0.8);
      const g = growth[years];
      if (row.tier === 'tree') {
        co2 += alive * (rates['eff.co2.tree'] ?? 0) * g;
        rain += alive * (rates['eff.rain.tree'] ?? 0) * g;
        trees += alive;
      } else if (row.tier === 'shrub') {
        co2 += alive * (rates['eff.co2.shrub'] ?? 0) * g;
        rain += alive * (rates['eff.rain.shrub'] ?? 0) * g;
      }
      const crown = sp?.crownDiameterM ?? 1;
      canopy += alive * Math.PI * (crown / 2) ** 2 * Math.min(1, g + 0.1);
    }
    canopy = Math.min(canopy, area || canopy);
    const cover = area ? canopy / area : 0;
    const cooling = (rates['eff.cool.max'] ?? 0) * Math.min(1, cover / (rates['eff.cool.canopy'] ?? 0.4));
    const dust = rates['eff.dust.tree'] == null ? null : trees * rates['eff.dust.tree']! * growth[years];
    return { years, co2t: co2 / 1000, o2t: (co2 * (rates['eff.o2.ratio'] ?? 0.727)) / 1000, rainM3: rain / 1000, coolingC: Math.round(cooling * 100) / 100, canopyM2: Math.round(canopy), dustKg: dust };
  });
}

export function analyzeZone(site: CandidateSite, catalog: Species[], rates: Rates, options: Partial<PlanOptions> = {}): ZoneAnalysis {
  const opt: PlanOptions = { ...DEFAULT_OPTIONS, ...options };
  const byId = new Map(catalog.map((s) => [s.id, s]));
  const c = site.centroid!;
  const soil = (site as any).soilOverride ?? soilFor(c.lat, c.lng);
  const purpose = opt.purpose ?? guessPurpose(site);
  const ranked = scoreSpecies(site, catalog, purpose, soil);
  const scheme = buildScheme(site, ranked, byId, opt);
  const survival = survivalForecast(site, scheme, byId, opt, soil, rates);
  const cost = costEstimate(site, scheme, byId, survival, opt, rates, soil);
  const { care, warnings } = careCalendar(scheme, byId, soil, opt, rates);
  const effect = ecoEffect(site, scheme, byId, survival, rates);
  const weight = (r: SurvivalRow, k: 'y1' | 'y2' | 'y3') => r[k] * (scheme.find((s) => s.speciesId === r.speciesId)?.quantity ?? 0);
  const totalQ = scheme.reduce((a, s) => a + s.quantity, 0) || 1;
  const perennial = survival.filter((r) => r.y3 > 0);
  const totalP = perennial.reduce((a, r) => a + (scheme.find((s) => s.speciesId === r.speciesId)?.quantity ?? 0), 0) || 1;
  const survivalAvg = {
    y1: Math.round(survival.reduce((a, r) => a + weight(r, 'y1'), 0) / totalQ),
    y2: Math.round(perennial.reduce((a, r) => a + weight(r, 'y2'), 0) / totalP),
    y3: Math.round(perennial.reduce((a, r) => a + weight(r, 'y3'), 0) / totalP),
  };
  // Меры повышения приживаемости и их влияние (ТЗ 3.5.5): пересчёт с изменённым параметром.
  const measures: Measure[] = [];
  const tryMeasure = (label: string, apply: Partial<PlanOptions>) => {
    const alt = survivalForecast(site, scheme, byId, { ...opt, ...apply }, soil, rates);
    const a = Math.round(alt.reduce((s, r) => s + r.y1 * (scheme.find((x) => x.speciesId === r.speciesId)?.quantity ?? 0), 0) / totalQ);
    if (a > survivalAvg.y1) measures.push({ label, effect: `приживаемость 1-го года ${survivalAvg.y1}% → ${a}%`, apply });
  };
  if (!opt.improveSoil && soil.salinity !== 'none') tryMeasure('Улучшить почву (гипс, промывка, дренаж)', { improveSoil: true });
  if (opt.watering !== 'regular') tryMeasure('Регулярный полив', { watering: 'regular' });
  const weakest = [...survival].sort((a, b) => a.y1 - b.y1)[0];
  if (weakest && weakest.y1 < 80) {
    const form = byId.get(weakest.speciesId)?.form;
    const alt = ranked.find((r) => !r.excludedBy && byId.get(r.speciesId)?.form === form && !scheme.some((s) => s.speciesId === r.speciesId));
    if (alt) measures.push({ label: `Заменить «${byId.get(weakest.speciesId)?.nameRu}» на «${byId.get(alt.speciesId)?.nameRu}»`, effect: `у замены выше оценка пригодности (${alt.score} против ${ranked.find((r) => r.speciesId === weakest.speciesId)?.score ?? '?'})`, apply: { replace: [weakest.speciesId, alt.speciesId] } });
  }
  const e20 = effect.find((e) => e.years === 20)!;
  // ₸ за тонну CO₂ за 20 лет: рост до взрослого линейно → накопленно ≈ 10,5 × годовое значение на 20-й год.
  const co2Total = e20.co2t * 10.5;
  const missing: string[] = [];
  if (site.factors.waterAvailability.value === null) missing.push('Доступ к воде на участке неизвестен.');
  if(!(site as any).soilOverride)missing.push('Карта почв организатора не загружена — используется синтетический слой.');
  if ((rates['eff.dust.tree'] ?? null) === null) missing.push('Нет коэффициента улавливания пыли — эффект по пыли не рассчитан.');
  if ((rates['eff.population'] ?? null) === null) missing.push('Нет данных о населении — зелень на жителя не рассчитана.');
  return {
    siteId: site.id,
    options: opt,
    facts: { areaM2: site.areaM2 ?? null, soil, purpose, purposeLabel: PURPOSE_LABEL[purpose], light: lightLevel(site, site.context?.buildings200m ?? 0), greenShare: site.context?.greenShare200m ?? null, nearRoadM: site.context?.nearestMajorRoadM ?? null, social: site.context?.socialWithin400m ?? [], buildings200: site.context?.buildings200m ?? null },
    ranked,
    scheme,
    tiersNote: `Ярусы: деревья, кустарники${scheme.some((s) => s.tier === 'flower') ? ', цветы' : ''}. Доля одного вида в ярусе — не более ${Math.round(opt.maxSpeciesShare * 100)}%.`,
    cost,
    survival,
    survivalAvg,
    measures,
    care,
    careWarnings: warnings,
    effect,
    costPerTonCo2: co2Total > 0 ? cost.total / co2Total : null,
    before: { canopyM2: 0, greenShare: site.context?.greenShare200m ?? null },
    assumptions: [
      'Все значения оценочные и носят рекомендательный характер; решение принимает специалист акимата (ТЗ 5.2).',
      'Приживаемость — экспертные правила команды (п.п. по факторам риска), модель не калибрована на данных Павлодара.',
      (site as any).soilOverride?'Почва из импортированного слоя; достоверность определяется источником.':'Почва — синтетический слой до получения карты почв организатора.',
      'Расценки — демо-справочник команды; администратор меняет их в «Справочниках».',
      'Экоэффект: рост кроны до взрослого — 30% за 5 лет, 60% за 10, 100% за 20; учтена приживаемость за 3 года.',
    ],
    missing,
    method: 'rules',
  };
}
