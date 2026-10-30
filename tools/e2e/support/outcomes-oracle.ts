import { readFileSync } from 'node:fs';

export const reference = JSON.parse(readFileSync(new URL('../reference/outcomes-cases.json', import.meta.url), 'utf8'));
export const fraction = (n: any): number | null => n === null ? null : typeof n === 'number' ? n : n.numerator / n.denominator;
export const numericText = (s: string) => Number(s.replace(/[\s\u00a0\u202f₸%]/g, '').replace(',', '.'));

// Independent arithmetic, no imports from production analytics. Probabilities are
// inputs to the outcome metric; this does not independently validate the ML model.
export function expectedTrees(rows: { tier: string; quantity: number; y3Pct: number }[]) {
  return rows.filter(r => r.tier === 'tree').reduce((sum, r) => sum + r.quantity * r.y3Pct / 100, 0);
}
export function observed(total: number, rows: { state: string }[] | null) {
  const inspected = rows?.length ?? 0;
  const alive = rows?.filter(r => r.state === 'alive').length ?? 0;
  const dead = rows?.filter(r => r.state === 'dead').length ?? 0;
  const assessed = alive + dead;
  return { total, inspected, assessed, alive, dead, unknown: total - assessed, notInspected: total - inspected,
    inspectionCoveragePct: inspected / total * 100, assessmentCoveragePct: assessed / total * 100,
    survivalAmongAssessedPct: assessed ? alive / assessed * 100 : null,
    wholeCohortSurvivalPct: assessed === total ? alive / total * 100 : null };
}

// Audit a saved input with the published estimate rules: material, area preparation,
// planting/delivery, three annual care costs and year-1 replacement reserve.
// Neither analysis.cost nor snapshot.outcome supplies the expected amount.
export function auditForecast(snapshot: any) {
  const a = snapshot.analysis;
  const rates = Object.fromEntries(snapshot.rates.map((r: any) => [r.key, r.value]));
  const species = new Map<string, any>(snapshot.catalog.map((s: any) => [s.id, s]));
  const survival = new Map<string, any>(a.survival.map((s: any) => [s.speciesId, s]));
  const input = a.scheme.map((r: any) => ({ ...r, y3Pct: survival.get(r.speciesId).y3 }));
  const expected = expectedTrees(input);
  let material = 0, work = 0, care = 0, reserve = 0;
  for (const row of a.scheme) {
    const price = species.get(row.speciesId).pricePerUnitKzt ?? rates[row.tier === 'tree' && a.options.variant === 'max' ? 'price.tree.large' : `price.${row.tier}`];
    material += row.quantity * price;
    work += row.quantity * rates[`work.${row.tier}`];
    care += row.quantity * rates[`care.${row.tier}`] * a.options.careYears;
    reserve += row.quantity * price * (100 - survival.get(row.speciesId).y1) / 100;
  }
  const salinity = ['medium', 'high'].includes(a.facts.soil.salinity) || a.options.improveSoil;
  const prep = a.facts.areaM2 * (a.options.variant === 'econom' ? 0.3 : 0.6) * (rates['soil.prep'] + (salinity ? rates['soil.salinity'] : 0));
  const total = material + prep + work + material * rates['delivery.share'] / 100 + care + reserve;
  return { expected, total, trees: input.filter((r: any) => r.tier === 'tree').reduce((s: number, r: any) => s + r.quantity, 0),
    unit: expected > 0 && input.every((r: any) => r.tier === 'tree') && a.options.careYears === 3 ? total / expected : null };
}
