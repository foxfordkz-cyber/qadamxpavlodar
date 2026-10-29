import { t, type Key } from '../../../shared/i18n';
import { ru } from '../../../shared/i18n/ru';

const KEYS = ['highlight.budget', 'highlight.priority', 'highlight.problems', 'highlight.found', 'highlight.assistant', 'highlight.top10', 'highlight.roadmap'] as const satisfies readonly Key[];
export type HighlightTitleKey = typeof KEYS[number];
const legacyTitles = new Map<string, HighlightTitleKey>(KEYS.map(key => [ru[key], key]));

/** Keep a stable key in the URL; resolve it on render so changing language updates both map labels.
 * Old links with Russian titles and custom titles remain readable. */
export function highlightTitle(title: string | null, budget: string | null = null): string {
  if (!title) return t('highlight.assistant');
  const key = KEYS.find(key => key === title) ?? legacyTitles.get(title);
  if (key) return t(key, { budget: budget ?? '—' });
  const oldBudget = /^Дорожная карта · (.+) млн ₸$/.exec(title);
  return oldBudget ? t('highlight.roadmap', { budget: oldBudget[1] }) : title;
}
