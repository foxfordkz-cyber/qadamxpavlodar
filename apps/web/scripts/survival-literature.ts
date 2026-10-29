import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Species } from '../src/shared/api/types';

export function readLiterature(species: Species[]) {
  const path = resolve('../../fixtures/pavlodar/survival-literature.csv');
  const bases = new Map<string, number>();
  if (!existsSync(path)) return bases;
  const lines = readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = lines.shift()!.split(';');
  const [id, value, evidence] = ['speciesId', 'survivalPct', 'evidenceId'].map(k => header.indexOf(k));
  if ([id, value, evidence].includes(-1)) throw new Error('survival-literature.csv requires speciesId;survivalPct;evidenceId (percent, 0–100)');
  for (const line of lines) {
    const cells = line.split(';'), pct = Number(cells[value]);
    if (!species.some(s => s.id === cells[id]) || !cells[value]?.trim() || !Number.isFinite(pct) || pct <= 0 || pct >= 100 || !cells[evidence]?.trim() || bases.has(cells[id])) throw new Error('Invalid or duplicate survival literature row');
    bases.set(cells[id], pct);
  }
  return bases;
}
