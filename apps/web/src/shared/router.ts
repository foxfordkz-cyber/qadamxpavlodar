import { useEffect, useState } from 'react';

// Хеш-маршрутизация: ссылка на карточку (#/map?site=ID) работает без настройки сервера.
export interface Route {
  path: string;
  params: URLSearchParams;
}
const parse = (): Route => {
  const h = location.hash.replace(/^#/, '') || '/map';
  const [path, q] = h.split('?');
  return { path, params: new URLSearchParams(q ?? '') };
};

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(path: string, params?: Record<string, string | null | undefined>, replace = false) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v) p.set(k, v);
  const s = p.toString();
  const hash = `#${path}${s ? `?${s}` : ''}`;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) dispatchEvent(new HashChangeEvent('hashchange'));
}

export const hrefFor = (path: string, params?: Record<string, string>) => `#${path}${params ? `?${new URLSearchParams(params)}` : ''}`;
