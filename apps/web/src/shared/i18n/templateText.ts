import { getLang, speciesName, tFor, trFor, type Key, type Lang } from './index';
import { ru } from './ru';
import type { Species } from '../api/types';

// Analysis data stays in Russian. Translate known display templates only;
// preserve unknown source text and the original formatting of captured numbers.
const templates = Object.entries(ru).filter(([key, text]) => /^(memo|rules)\.input\./.test(key) && /\{\w+\}/.test(text)).map(([key, text]) => {
  const names: string[] = [];
  const pattern = text.split(/(\{\w+\})/).map(part => {
    if (/^\{\w+\}$/.test(part)) { names.push(part.slice(1, -1)); return '(.+?)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return { key: key as Key, names, pattern: new RegExp(`^${pattern}$`) };
});

export function templateText(language: Lang, text: string, valueLabel = (value: string) => trFor(language, value)): string {
  if (language === 'ru') return text;
  const translated = trFor(language, text);
  if (translated !== text) return translated;
  for (const { key, names, pattern } of templates) {
    const match = pattern.exec(text);
    if (match) return tFor(language, key, Object.fromEntries(names.map((name, i) => [name, valueLabel(match[i + 1])])));
  }
  return text;
}

/** Known analysis templates may contain species names, e.g. a replacement recommendation. */
export function analysisText(text: string, catalog: Species[], language: Lang = getLang()): string {
  return templateText(language, text, part => {
    const sp = catalog.find(s => s.nameRu === part);
    return sp ? speciesName(sp, '', language) : trFor(language, part);
  });
}
