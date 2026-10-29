import { tFor, trFor, type Key, type Lang } from '../i18n';
import { ru } from '../i18n/ru';

// The shared analysis contract contains Russian display text. Only translate recognized
// templates; keep captured values verbatim and preserve unfamiliar/custom source text.
const templates = Object.entries(ru).filter(([key, text]) => key.startsWith('memo.input.') && /\{\w+\}/.test(text)).map(([key, text]) => {
  const names: string[] = [];
  const pattern = text.split(/(\{\w+\})/).map(part => {
    if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { key: key as Key, names, pattern: new RegExp(`^${pattern}$`) };
});

export function memoText(language: Lang, text: string): string {
  if (language === 'ru') return text;
  const translated = trFor(language, text);
  if (translated !== text) return translated;
  for (const { key, names, pattern } of templates) {
    const match = pattern.exec(text);
    if (match) return tFor(language, key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return text;
}
