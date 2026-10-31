import { ru, type Dict } from './ru';
import { kk } from './kk';
import type { Species } from '../api/types';

export type Lang = 'ru' | 'kk';
export type Key = keyof Dict;

// Available by default; an explicit deployment flag can disable the draft translation.
export const kkEnabled = import.meta.env?.VITE_ENABLE_KK !== '0';
const STORAGE_KEY = 'gp.language';
function initialLanguage(): Lang {
  if (typeof window === 'undefined') return 'ru';
  const query = new URLSearchParams(window.location.search).get('lang');
  if (query === 'ru' || query === 'kk') {
    const selected = query === 'kk' && kkEnabled ? 'kk' : 'ru';
    try { localStorage.setItem(STORAGE_KEY, selected); } catch { /* Storage is optional. */ }
    return selected;
  }
  try { return kkEnabled && localStorage.getItem(STORAGE_KEY) === 'kk' ? 'kk' : 'ru'; } catch { return 'ru'; }
}
let lang: Lang = initialLanguage();
const listeners = new Set<() => void>();
export const subscribeLanguage = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setLang(next: Lang) {
  lang = next === 'kk' && kkEnabled ? 'kk' : 'ru';
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* Storage is optional (private/offline browsers). */ }
  if (typeof window !== 'undefined') {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) { url.searchParams.set('lang', lang); window.history.replaceState(window.history.state, '', url); }
  }
  listeners.forEach(listener => listener());
  return lang;
}
export const getLang = () => lang;

/** UI defaults to its current language; reports and replies pass their language explicitly. */
export function speciesName(species: Pick<Species, 'nameRu' | 'nameKk'> | null | undefined, fallback = '', language: Lang = getLang()): string {
  return (language === 'kk' ? species?.nameKk?.trim() : '') || species?.nameRu || fallback;
}

// Static legacy labels can also come from pure analytics dictionaries shared with the server.
// Keep those data contracts in Russian; translate only their display in the specialist UI.
const textKeys = new Map(Object.entries(ru).map(([key, value]) => [value as string, key as Key]));
export function trFor(language: Lang, text: string): string { const key = textKeys.get(text); return key ? tFor(language, key) : text; }
export function tr(text: string): string { return trFor(lang, text); }

/** t('key', {n: 3}) — подстановка {n}. Отсутствующий казахский ключ падает на русский. */
export function t(key: Key, params?: Record<string, string | number>): string {
  return tFor(lang, key, params);
}

/** A document can use a different language without changing the UI or a concurrent export. */
export function tFor(language: Lang, key: Key, params?: Record<string, string | number>): string {
  const s = (language === 'kk' ? kk[key] : undefined) ?? ru[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : s;
}
