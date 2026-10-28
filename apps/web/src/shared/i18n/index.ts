import { ru, type Dict } from './ru';
import { kk } from './kk';

export type Lang = 'ru' | 'kk';
export type Key = keyof Dict;

// Казахская версия — черновик: включается флагом VITE_ENABLE_KK=1 только после проверки носителем языка.
export const kkEnabled = import.meta.env.VITE_ENABLE_KK === '1';
let lang: Lang = 'ru';
export const setLang = (l: Lang) => (lang = l === 'kk' && kkEnabled ? 'kk' : 'ru');
export const getLang = () => lang;

/** t('key', {n: 3}) — подстановка {n}. Отсутствующий казахский ключ падает на русский. */
export function t(key: Key, params?: Record<string, string | number>): string {
  const s = (lang === 'kk' ? kk[key] : undefined) ?? ru[key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : s;
}
