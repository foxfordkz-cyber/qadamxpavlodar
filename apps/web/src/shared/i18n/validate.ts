/** Compare named parameters including multiplicity, independent of word order. */
const parameters = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
export function validateTranslations(base: Record<string, string>, translated: Record<string, string | undefined>) {
  return {
    missing: Object.keys(base).filter(key => !translated[key]?.trim()),
    extra: Object.keys(translated).filter(key => !(key in base)),
    placeholders: Object.keys(base).filter(key => translated[key] !== undefined && parameters(base[key]) !== parameters(translated[key]!)),
  };
}
