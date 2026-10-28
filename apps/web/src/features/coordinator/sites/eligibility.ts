import type { CandidateSite, CheckKey } from '../../../shared/api/types';

export const CHECK_KEYS: CheckKey[] = ['landPermission', 'utilities', 'access', 'siteSuitability'];

/** Состояние проверок по контракту: blocked запрещает посадку, unknown требует проверки. Не зависит от балла. */
export function eligibilityOf(s: CandidateSite): 'survey_needed' | 'blocked' | 'planting_candidate' {
  const st = CHECK_KEYS.map((k) => s.checks[k].state);
  if (st.includes('blocked')) return 'blocked';
  return st.every((x) => x === 'cleared') ? 'planting_candidate' : 'survey_needed';
}

export function lastCheckAt(s: CandidateSite): string | null {
  const ts = CHECK_KEYS.map((k) => s.checks[k].checkedAt).filter(Boolean) as string[];
  return ts.length ? ts.sort().at(-1)! : null;
}
