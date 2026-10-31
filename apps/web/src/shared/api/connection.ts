/** Read-only reachability checks. This controller never retries application mutations. */
export type ConnectionPhase = 'idle' | 'connecting' | 'ready' | 'unavailable' | 'cancelled';
export interface ConnectionState { phase: ConnectionPhase; attempt: number; maxAttempts: number }

export const isUnavailableStatus = (status: number) => [0, 502, 503, 504].includes(status);
export function isConnectionFailure(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'status' in error &&
    typeof error.status === 'number' && isUnavailableStatus(error.status);
}

type Fetch = typeof fetch;
const abortError = () => new DOMException('Connection check cancelled', 'AbortError');
const roles = new Set(['coordinator', 'specialist', 'admin', 'viewer', 'foreman', 'worker']);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';

function validIdentity(body: unknown): boolean {
  if (!record(body) || !record(body.data) || !record(body.data.user)) return false;
  const user = body.data.user;
  return typeof user.id === 'string' && user.id.length > 0 &&
    typeof user.displayName === 'string' && user.displayName.length > 0 &&
    typeof user.role === 'string' && roles.has(user.role);
}

async function probe(fetchImpl: Fetch, signal: AbortSignal, timeoutMs: number): Promise<boolean> {
  const request = new AbortController();
  const stop = () => request.abort();
  if (signal.aborted) throw abortError();
  signal.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, timeoutMs);
  let abort: (() => void) | undefined;
  try {
    const result = (async () => {
      const response = await fetchImpl('/api/v1/auth/me', {
        method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { Accept: 'application/json' }, signal: request.signal,
      });
      if (!response.headers.get('Content-Type')?.toLowerCase().includes('application/json')) return false;
      const body: unknown = await response.json();
      if (response.status === 200) return validIdentity(body);
      return response.status === 401 && record(body) && record(body.error) && body.error.code === 'AUTH_REQUIRED';
    })();
    // Includes body consumption and enforces the bound even if a fetch implementation ignores abort.
    return await Promise.race([result, new Promise<never>((_, reject) => {
      abort = () => reject(abortError());
      request.signal.addEventListener('abort', abort, { once: true });
      if (request.signal.aborted) abort();
    })]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
    if (abort) request.signal.removeEventListener('abort', abort);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); reject(abortError()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', stop); resolve(); }, ms);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
  });
}

/** Six attempts, ten seconds per attempt and 38 seconds of delays: at most 98 seconds per run. */
export function createApiConnection({ fetchImpl = fetch, timeoutMs = 10_000, retryDelaysMs = [2_000, 4_000, 8_000, 12_000, 12_000] }:
  { fetchImpl?: Fetch; timeoutMs?: number; retryDelaysMs?: readonly number[] } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000 || retryDelaysMs.length > 9 ||
    retryDelaysMs.some(ms => !Number.isFinite(ms) || ms < 0 || ms > 30_000)) throw new Error('Invalid connection retry bounds');
  const delays = [...retryDelaysMs];
  let state: ConnectionState = { phase: 'idle', attempt: 0, maxAttempts: delays.length + 1 };
  const listeners = new Set<() => void>();
  let current: AbortController | null = null;
  const publish = (phase: ConnectionPhase, attempt = state.attempt) => {
    state = { phase, attempt, maxAttempts: delays.length + 1 };
    listeners.forEach(listener => listener());
  };
  const cancel = () => {
    const previous = current;
    current = null;
    previous?.abort();
    if (state.phase === 'connecting') publish('cancelled');
  };
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel,
    async start(): Promise<boolean> {
      cancel();
      const run = new AbortController();
      current = run;
      publish('connecting', 0);
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        if (current !== run || run.signal.aborted) return false;
        publish('connecting', attempt + 1);
        let reachable = false;
        try { reachable = await probe(fetchImpl, run.signal, timeoutMs); } catch { /* Retry only this read-only probe. */ }
        if (current !== run || run.signal.aborted) return false;
        if (reachable) { current = null; publish('ready'); return true; }
        if (attempt < delays.length) {
          try { await wait(delays[attempt], run.signal); } catch { return false; }
        }
      }
      if (current === run) { current = null; publish('unavailable'); }
      return false;
    },
  };
}
