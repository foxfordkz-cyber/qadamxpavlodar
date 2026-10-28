// Правила тестового источника — временная замена функций участника 1
// (rankSites, подбор растений). Реальный сервер возвращает те же формы ответа.
import type {
  CandidateSite, CheckKey, FactorKey, PlantSelection, PlantSelectionItem, RankWeights, SiteRankItem, SiteRanking, Species,
} from '../types';

export const FACTORS: FactorKey[] = ['greeneryGap', 'publicUsePriority', 'waterAvailability', 'maintenanceFeasibility'];
export const CHECKS: CheckKey[] = ['landPermission', 'utilities', 'access', 'siteSuitability'];

export function eligibilityOf(site: CandidateSite): SiteRankItem['eligibility'] {
  const states = CHECKS.map((k) => site.checks[k].state);
  if (states.includes('blocked')) return 'blocked';
  if (states.every((s) => s === 'cleared')) return 'planting_candidate';
  return 'survey_needed';
}

export function rankSites(sites: CandidateSite[], weights: RankWeights): SiteRanking {
  const items: SiteRankItem[] = sites.map((s) => {
    const contributions = FACTORS.map((f) => {
      const value = s.factors[f].value;
      return { factor: f, value, weight: weights[f], contribution: value === null ? null : +(value * weights[f]).toFixed(2) };
    });
    const missingFactors = FACTORS.filter((f) => s.factors[f].value === null);
    const known = contributions.filter((c) => c.value !== null);
    const wKnown = known.reduce((a, c) => a + c.weight, 0);
    const wAll = FACTORS.reduce((a, f) => a + weights[f], 0);
    const partial = wKnown > 0 ? +(known.reduce((a, c) => a + (c.contribution ?? 0), 0) / wKnown).toFixed(1) : null;
    const complete = missingFactors.length === 0;
    const eligibility = eligibilityOf(s);
    const explanation = [
      complete ? `Балл по всем четырём факторам.` : `Недостаточно данных: ${missingFactors.length} из 4 факторов неизвестны, полный балл не рассчитан.`,
      eligibility === 'blocked' ? 'Есть ограничение по проверке — посадка не предлагается.' : eligibility === 'survey_needed' ? 'Проверки не завершены — можно предложить обследование, не посадку.' : 'Все проверки отмечены человеком как пройденные.',
    ].join(' ');
    return {
      siteId: s.id,
      score: complete && wAll > 0 ? partial : null,
      partialScore: partial,
      completeness: complete ? 'complete' : 'partial',
      contributions,
      missingFactors,
      eligibility,
      explanation,
    };
  });
  items.sort((a, b) => (b.partialScore ?? -1) - (a.partialScore ?? -1));
  return {
    scenarioId: `rank-${Object.values(weights).join('-')}`,
    weights,
    items,
    limitations: [
      'Веса — демонстрационная политика команды, а не утверждённая методика.',
      'Баллы сравнимы только внутри группы с одинаковым набором известных факторов.',
      'Рейтинг показывает приоритет обследования, а не разрешение на посадку и не вероятность приживаемости.',
      'Факторы вычислены по OpenStreetMap, где деревья и газоны нанесены неполно.',
    ],
    method: 'rules',
  };
}

const lvl = { low: 0, medium: 1, high: 2 } as const;

export function selectPlants(site: CandidateSite, catalog: Species[]): PlantSelection {
  const area = site.areaM2 ?? null;
  const water = site.factors.waterAvailability.value;
  const road = site.context?.nearestMajorRoadM ?? null;
  const social = site.context?.socialWithin400m ?? [];
  const nearChildren = social.some((s) => /школа|детсад/.test(s));
  const utilities = site.checks.utilities.state;
  const items: PlantSelectionItem[] = [];
  const excluded: PlantSelection['excluded'] = [];

  for (const sp of catalog) {
    const reasons: string[] = [];
    const cautions: string[] = [];
    if (sp.invasiveRisk && sp.id === 'sp-acer-negundo') {
      excluded.push({ speciesId: sp.id, reason: 'Инвазивный вид — не предлагается для новых посадок.' });
      continue;
    }
    if (sp.form === 'tree' && utilities === 'blocked') {
      excluded.push({ speciesId: sp.id, reason: 'Проверка сетей отмечена как ограничение — деревья не предлагаются.' });
      continue;
    }
    if (area !== null && area < sp.minAreaM2) {
      excluded.push({ speciesId: sp.id, reason: `Площадь участка ${area} м² меньше ориентира ${sp.minAreaM2} м² на одно растение.` });
      continue;
    }
    if (water === null) {
      if (sp.droughtTolerance === 'high') reasons.push('Высокая засухоустойчивость — подходит, пока доступ к воде неизвестен.');
      else if (sp.droughtTolerance === 'low') {
        excluded.push({ speciesId: sp.id, reason: 'Требует регулярного полива, а доступ к воде на участке неизвестен.' });
        continue;
      } else cautions.push('Средняя засухоустойчивость: нужен полив в первые годы, а доступ к воде неизвестен.');
    } else if (water < 40 && lvl[sp.droughtTolerance] < 2) cautions.push(`Доступ к воде оценён низко (${water}/100), а вид требует полива.`);
    if (road !== null && road < 50) {
      if (sp.saltTolerance === 'high') reasons.push(`Устойчив к соли и пыли — магистраль примерно в ${road} м.`);
      else if (sp.saltTolerance === 'low') cautions.push(`Магистраль примерно в ${road} м, а вид плохо переносит реагенты.`);
    }
    if (sp.frostHardiness === 'high') reasons.push('Высокая морозостойкость.');
    else cautions.push('Морозостойкость средняя — нужна защищённая позиция.');
    if (sp.native) reasons.push('Местный для региона вид.');
    if (sp.invasiveRisk) cautions.push('Есть сведения об инвазивности — решение за специалистом.');
    if (sp.allergenic && nearChildren) cautions.push('Аллерген, а рядом школа или детсад.');
    else if (sp.allergenic) cautions.push('Аллерген.');
    if (sp.form === 'tree' && utilities === 'unknown') cautions.push('Сети не проверены: дерево сажать только после проверки охранных зон.');
    items.push({ speciesId: sp.id, fit: cautions.length === 0 ? 'suitable' : 'conditional', reasons, cautions });
  }
  items.sort((a, b) => (a.fit === b.fit ? b.reasons.length - a.reasons.length : a.fit === 'suitable' ? -1 : 1));

  const missingData = [
    ...(water === null ? [{ field: 'factors.waterAvailability', reason: 'Доступ к воде неизвестен — выбраны засухоустойчивые виды.' }] : []),
    { field: 'soil', reason: 'Тип почвы и засолённость неизвестны.' },
    ...(utilities === 'unknown' ? [{ field: 'checks.utilities', reason: 'Подземные сети не проверены.' }] : []),
  ];
  return {
    siteId: site.id,
    items,
    excluded,
    assumptions: [
      area !== null ? `Площадь по контуру OSM: ${area} м².` : 'Площадь неизвестна.',
      road !== null ? `До магистральной улицы ≈${road} м (по центрам линий OSM).` : 'Расстояние до магистрали не определено.',
    ],
    missingData,
    limitations: [
      'Подбор по общим характеристикам видов из справочника команды; характеристики не проверены дендрологом.',
      'Не учитываются почва, затенение зданиями, наличие посадочного материала и бюджет.',
      'Окончательный выбор делает специалист после обследования участка.',
    ],
    method: 'rules',
    inputVersion: `${site.id}@v${site.version}`,
    createdAt: new Date().toISOString(),
  };
}
