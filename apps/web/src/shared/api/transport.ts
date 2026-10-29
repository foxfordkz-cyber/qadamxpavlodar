import type { ApiErrorBody, ApiSuccess } from './types';

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

/** Единый слой доступа: тестовый источник и реальный сервер реализуют один интерфейс. */
export interface Transport {
  kind: 'mock' | 'api';
  request<T>(method: HttpMethod, path: string, opts?: RequestOptions): Promise<ApiSuccess<T>>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    public details?: unknown,
  ) {
    super(message);
  }
  get isNetwork() {
    return this.status === 0 || this.status === 503;
  }
  get isConflict() {
    return this.status === 409;
  }
}

export function buildQuery(query?: RequestOptions['query']): string {
  if (!query) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Реальный сервер участника 3: префикс /api/v1, cookie-сессия, конверт {data, meta} / {error}. */
export function createHttpTransport(base = '/api/v1'): Transport {
  let csrf = '';
  return {
    kind: 'api',
    async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}) {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if(method!=='GET'&&path!=='/auth/login'){headers['X-CSRF-Token']=csrf; headers['Idempotency-Key']=opts.idempotencyKey??newIdempotencyKey();}
      if(method!=='GET'&&opts.body===undefined)opts={...opts,body:{}};
      const requestPath = path==='/sites'||/^\/sites\/[^/]+(?:\/context)?$/.test(path) ? '/municipal'+path : path==='/evidence'||path==='/dashboard'?'/municipal'+path:path;
      if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
      if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
      let res: Response;
      try {
        res = await fetch(base + requestPath + buildQuery(opts.query), {
          method,
          headers,
          credentials: 'include',
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: opts.signal ?? AbortSignal.timeout(20000),
        });
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        throw new ApiError(0, 'network_error', 'Сервер недоступен или нет сети.');
      }
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* пустой или не-JSON ответ */
      }
      if (!res.ok) {
        const err = (json as ApiErrorBody | null)?.error;
        throw new ApiError(res.status, err?.code ?? `http_${res.status}`, err?.message ?? `Ошибка сервера (${res.status}).`, err?.requestId, err?.details);
      }
      if (!json || typeof json !== 'object' || !('data' in json)) {
        throw new ApiError(res.status, 'bad_envelope', 'Ответ сервера не соответствует контракту {data, meta}.');
      }
      const payload=json as any;
      if(path==='/auth/me'||path==='/auth/login'){csrf=payload.data.csrfToken;payload.data={...payload.data.user,role:payload.data.user.role==='specialist'?'coordinator':payload.data.user.role,isDemoAccount:payload.data.user.displayName.startsWith('DEMO')};}
      if(path==='/auth/logout')csrf='';
      return payload as ApiSuccess<T>;
    },
  };
}
