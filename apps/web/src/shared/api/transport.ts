import type { ApiErrorBody, ApiSuccess, Me } from './types';

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

/**
 * Сервер apps/server: префикс /api/v1, cookie-сессия, конверт {data, meta} / {error}.
 * SRV-06: токен X-CSRF-Token берётся из ответов login и me и отправляется со всеми изменяющими запросами;
 * ответ {user, csrfToken} этих двух маршрутов разворачивается в Me — экраны видят ту же форму, что в тестовом источнике.
 */
export function createHttpTransport(base = '/api/v1'): Transport {
  let csrf: string | null = null;
  async function send(method: HttpMethod, path: string, opts: RequestOptions) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
    let res: Response;
    try {
      res = await fetch(base + path + buildQuery(opts.query), {
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
    const out = json as ApiSuccess<unknown>;
    if (path === '/auth/login' || path === '/auth/me') {
      const d = out.data as { user?: Me; csrfToken?: string } | null;
      if (d?.user) {
        csrf = d.csrfToken ?? null;
        out.data = { id: d.user.id, displayName: d.user.displayName, role: d.user.role, isDemoAccount: res.headers.get('X-Data-Mode') === 'DEMO' } satisfies Me;
      }
    }
    if (path === '/auth/logout') csrf = null;
    return out;
  }
  return {
    kind: 'api',
    async request<T>(method: HttpMethod, path: string, opts: RequestOptions = {}) {
      try {
        return (await send(method, path, opts)) as ApiSuccess<T>;
      } catch (e) {
        // Токен теряется при перезагрузке вкладки, cookie остаётся: обновляем токен через me и повторяем один раз.
        if (!(e instanceof ApiError) || e.code !== 'CSRF_REQUIRED' || path.startsWith('/auth/')) throw e;
        await send('GET', '/auth/me', {});
        return (await send(method, path, opts)) as ApiSuccess<T>;
      }
    },
  };
}
