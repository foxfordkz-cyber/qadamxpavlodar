import { useEffect, useSyncExternalStore } from 'react';
import { getLang, subscribeLanguage } from './index';
export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLang, () => 'ru' as const);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return language;
}
