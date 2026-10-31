import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createApi, type Api } from './api';
import { ApiError, createHttpTransport, type Transport } from './transport';
import { createV2CompatTransport } from './v2compat';
import { isUnavailableStatus } from './connection';

// Тестовый источник (с данными OSM) грузится отдельным чанком только в режиме mock.
function createLazyMockTransport(): Transport {
  let real: Promise<Transport> | null = null;
  return {
    kind: 'mock',
    async request(method, path, opts) {
      real ??= import('./mock/server').then((m) => m.createMockTransport());
      return (await real).request(method, path, opts);
    },
  };
}

export type SvcState = 'ok' | 'down' | 'unknown';
export interface ServiceStatus {
  api: SvcState;
  ai: SvcState;
  map: SvcState;
}

interface Ctx {
  api: Api;
  mode: 'mock' | 'api';
  services: ServiceStatus;
  reportService: (svc: keyof ServiceStatus, state: SvcState) => void;
  /** Растёт при каждом успешном изменении — экраны перезагружают данные с сервера. */
  revision: number;
  bump: () => void;
}

const DataCtx = createContext<Ctx | null>(null);

function pickMode(): 'mock' | 'api' {
  const q = new URLSearchParams(location.search).get('source');
  if (q === 'mock' || q === 'api') return q;
  return import.meta.env.VITE_DATA_SOURCE === 'api' ? 'api' : 'mock';
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [mode] = useState(pickMode);
  const [services, setServices] = useState<ServiceStatus>({ api: 'unknown', ai: 'unknown', map: 'unknown' });
  const [revision, setRevision] = useState(0);

  const reportService = useCallback((svc: keyof ServiceStatus, state: SvcState) => {
    setServices((s) => (s[svc] === state ? s : { ...s, [svc]: state }));
  }, []);

  const api = useMemo(() => {
    // Режим api: сервер apps/server (контракт V2) через слой соответствий v2compat.ts.
    const base: Transport = mode === 'mock' ? createLazyMockTransport() : createV2CompatTransport(createHttpTransport());
    // Обёртка отмечает доступность сервера по фактическим ответам.
    const observed: Transport = {
      kind: base.kind,
      async request(method, path, opts) {
        try {
          const r = await base.request(method, path, opts);
          reportService('api', 'ok');
          return r as never;
        } catch (e) {
          if (e instanceof ApiError) {
            reportService('api', isUnavailableStatus(e.status) ? 'down' : 'ok');
            if (path.includes('plant-selection') || path === '/assistant') reportService('ai', e.status === 503 ? 'down' : 'ok');
          }
          throw e;
        }
      },
    };
    return createApi(observed);
  }, [mode, reportService]);

  const bump = useCallback(() => setRevision((r) => r + 1), []);
  const value = useMemo(() => ({ api, mode, services, reportService, revision, bump }), [api, mode, services, reportService, revision, bump]);
  return <DataCtx.Provider value={value}>{children}</DataCtx.Provider>;
}

export function useData() {
  const c = useContext(DataCtx);
  if (!c) throw new Error('useData вне DataProvider');
  return c;
}

/** Загрузка с состояниями, временем последнего обновления и опциональным опросом. */
export function useResource<T>(load: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const { revision } = useData();
  const [state, setState] = useState<{ data: T | null; error: ApiError | Error | null; loading: boolean; updatedAt: string | null }>({ data: null, error: null, loading: true, updatedAt: null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => alive && setState({ data, error: null, loading: false, updatedAt: new Date().toISOString() }),
      // При ошибке прежние данные сохраняются и помечаются устаревшими по updatedAt.
      (error) => alive && setState((s) => ({ ...s, error, loading: false })),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision, tick]);

  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => document.visibilityState === 'visible' && setTick((x) => x + 1), pollMs);
    return () => clearInterval(id);
  }, [pollMs]);

  return { ...state, reload: () => setTick((x) => x + 1) };
}
