import type { CandidateSite, Task } from '../../../shared/api/types';
import { eligibilityOf } from './eligibility';
import type { SiteRankItem } from '../../../shared/api/types';
type Elig = SiteRankItem['eligibility'];

export interface SiteFilters {
  q: string;
  elig: 'all' | Elig;
  area: 'any' | 'small' | 'medium' | 'large';
  task: 'any' | 'open' | 'none';
  hints: boolean;
}
export const emptyFilters: SiteFilters = { q: '', elig: 'all', area: 'any', task: 'any', hints: false };
export const isFiltered = (f: SiteFilters) => JSON.stringify(f) !== JSON.stringify(emptyFilters);

const OPEN = new Set(['draft', 'assigned', 'in_progress', 'submitted']);

export function applyFilters(sites: CandidateSite[], tasks: Task[], f: SiteFilters) {
  const q = f.q.trim().toLowerCase();
  const openBySite = new Set(tasks.filter((t) => OPEN.has(t.status)).map((t) => t.objectId));
  return sites.filter((s) => {
    if (q && !`${s.name} ${s.id} ${s.osmId ?? ''}`.toLowerCase().includes(q)) return false;
    if (f.elig !== 'all' && eligibilityOf(s) !== f.elig) return false;
    const a = s.areaM2 ?? null;
    if (f.area === 'small' && !(a !== null && a < 500)) return false;
    if (f.area === 'medium' && !(a !== null && a >= 500 && a <= 3000)) return false;
    if (f.area === 'large' && !(a !== null && a > 3000)) return false;
    if (f.task === 'open' && !openBySite.has(s.id)) return false;
    if (f.task === 'none' && openBySite.has(s.id)) return false;
    if (f.hints && !s.context?.hints?.length) return false;
    return true;
  });
}

export function sitesToCsv(sites: CandidateSite[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['id', 'name', 'osm_id', 'lat', 'lng', 'area_m2', 'eligibility', 'landPermission', 'utilities', 'access', 'siteSuitability', 'greeneryGap', 'publicUsePriority', 'waterAvailability', 'maintenanceFeasibility', 'version'];
  const rows = sites.map((s) => [
    s.id, s.name, s.osmId, s.centroid?.lat, s.centroid?.lng, s.areaM2, eligibilityOf(s),
    s.checks.landPermission.state, s.checks.utilities.state, s.checks.access.state, s.checks.siteSuitability.state,
    s.factors.greeneryGap.value, s.factors.publicUsePriority.value, s.factors.waterAvailability.value, s.factors.maintenanceFeasibility.value, s.version,
  ]);
  return '﻿' + [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

export function download(name: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
