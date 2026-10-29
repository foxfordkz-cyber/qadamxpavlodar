// Пример отчёта для сдачи (ТЗ 9): те же модули, что в интерфейсе, — цифры совпадают.
// Запуск из apps/web: npm run report:example → ../../docs/example-report.md
import { writeFileSync } from 'node:fs';
import osm from '../../../fixtures/osm/sites.json';
import { species } from '../src/shared/api/mock/species';
import { analyzeZone, VARIANT_LABEL } from '../src/shared/analytics/plan';
import { DEFAULT_RATES, ratesMap } from '../src/shared/analytics/rates';
import { detectProblems, priorities, roadmap, DEFAULT_PRIORITY_WEIGHTS, PROBLEM_LABEL, PRIORITY_LABEL } from '../src/shared/analytics/city';
import { SALINITY_LABEL } from '../src/shared/analytics/zone';
import type { CandidateSite } from '../src/shared/api/types';

const sites = osm.sites as unknown as CandidateSite[];
const rates = ratesMap(DEFAULT_RATES);
const byId = new Map(species.map((s) => [s.id, s]));
const money = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`;
const site = sites.find((s) => s.id === 'site-osm-1569993037') ?? sites[0];
const a = analyzeZone(site, species, rates, { variant: 'optimal', careYears: 3 });
const pr = priorities(sites, species, rates, DEFAULT_PRIORITY_WEIGHTS);
const rm = roadmap(pr, 50e6);
const { problems } = detectProblems(sites);
const nm = (id: string) => sites.find((s) => s.id === id)?.name ?? id;
const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const md = `# Пример отчёта Green Pavlodar

Сгенерирован командой \`npm run report:example\` ${new Date().toISOString().slice(0, 10)} на демонстрационном наборе: 114 зон из OpenStreetMap, синтетический слой почв, справочник расценок команды. **Все значения оценочные, решение принимает специалист акимата.**

## 1. Зона «${site.name}» (${site.id})

| Параметр | Значение |
|---|---|
| Площадь | ${a.facts.areaM2} м² |
| Назначение | ${a.facts.purposeLabel} |
| Почва (синтетика) | ${a.facts.soil.type}, pH ${a.facts.soil.ph}, засоление ${SALINITY_LABEL[a.facts.soil.salinity]} |
| Зелень в 200 м | ${a.facts.greenShare === null ? 'нет данных' : Math.round(a.facts.greenShare * 100) + '%'} |
| Вариант | ${VARIANT_LABEL[a.options.variant]}, уход ${a.options.careYears} г. |

### Подбор (топ-5 по пригодности 0–100)

| Вид | Балл | Обоснование |
|---|---|---|
${a.ranked.filter((r) => !r.excludedBy).slice(0, 5).map((r) => `| ${byId.get(r.speciesId)?.nameRu} | ${r.score} | ${[...r.reasons, ...r.penalties.map((p) => '⚠ ' + p)].join('; ')} |`).join('\n')}

### Схема посадки

| Ярус | Вид | Кол-во |
|---|---|---|
${a.scheme.map((s) => `| ${s.tier === 'tree' ? 'Деревья' : s.tier === 'shrub' ? 'Кустарники' : 'Цветы'} | ${byId.get(s.speciesId)?.nameRu} | ${s.quantity} |`).join('\n')}

### Смета: ${money(a.cost.total)}

| Статья | Сумма | Расчёт |
|---|---|---|
${a.cost.items.map((i) => `| ${i.label} | ${money(i.amount)} | ${i.formula} |`).join('\n')}

### Приживаемость (экспертные правила, не калиброваны)

Средняя по зоне: **${a.survivalAvg.y1}% / ${a.survivalAvg.y2}% / ${a.survivalAvg.y3}%** за 1 / 2 / 3 года.

| Вид | 1 год | Диапазон | Риски |
|---|---|---|---|
${a.survival.map((s) => `| ${byId.get(s.speciesId)?.nameRu} | ${s.y1}% | ${s.low}–${s.high}% | ${s.risks.map((r) => `${r.label} ${r.pp} п.п.`).join('; ') || '—'} |`).join('\n')}

${a.measures.length ? `Меры: ${a.measures.map((m) => `${m.label} — ${m.effect}`).join('; ')}.` : ''}

### План ухода

${a.care.map((c) => `- **${MONTHS[c.month - 1]}** — ${c.operation}: ${c.detail}`).join('\n')}

### Экологический эффект (оценка)

| Показатель | 5 лет | 10 лет | 20 лет |
|---|---|---|---|
| CO₂, т/год | ${a.effect.map((e) => e.co2t.toFixed(2)).join(' | ')} |
| O₂, т/год | ${a.effect.map((e) => e.o2t.toFixed(2)).join(' | ')} |
| Дождь, м³/год | ${a.effect.map((e) => Math.round(e.rainM3)).join(' | ')} |
| Охлаждение, °C | ${a.effect.map((e) => e.coolingC).join(' | ')} |
| Пыль | нет коэффициента | нет коэффициента | нет коэффициента |

Стоимость тонны CO₂ за 20 лет: ${a.costPerTonCo2 ? money(a.costPerTonCo2) : '—'}.

## 2. Приоритеты (веса по умолчанию)

| № | Зона | Индекс | Главные факторы | Смета |
|---|---|---|---|---|
${pr.slice(0, 10).map((p, i) => `| ${i + 1} | ${nm(p.siteId)} | ${p.index} | ${p.explanation.join('; ')} | ${money(p.cost)} |`).join('\n')}

Веса: ${Object.entries(DEFAULT_PRIORITY_WEIGHTS).map(([k, v]) => `${PRIORITY_LABEL[k as keyof typeof PRIORITY_LABEL]} ${v}`).join(', ')}.

**Дорожная карта на 50 млн ₸:** ${rm.chosen.length} зон, ${money(rm.spent)}, CO₂ через 20 лет ≈ ${rm.co2t20.toFixed(1)} т/год. ${rm.method}

## 3. Проблемные зоны

${Object.entries(PROBLEM_LABEL).map(([k, v]) => `- ${v}: ${problems.filter((p) => p.type === k).length}`).join('\n')}

| Зона | Проблема | Острота | Причина |
|---|---|---|---|
${problems.filter((p) => p.severity === 'high').slice(0, 10).map((p) => `| ${nm(p.siteId)} | ${PROBLEM_LABEL[p.type]} | высокая | ${p.cause} |`).join('\n')}

## 4. Допущения

${[...a.missing, ...a.assumptions].map((x) => `- ${x}`).join('\n')}
`;
writeFileSync(new URL('../../../docs/example-report.md', import.meta.url), md);
console.log('docs/example-report.md');
