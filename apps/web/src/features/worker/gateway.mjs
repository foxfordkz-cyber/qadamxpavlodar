import { ru } from './strings.mjs';

/**
 * UI port, NOT the team's domain/API contract.
 * Server status names, URLs, entities and auth are deliberately not invented.
 * Host bindings must map server objects to display models and enforce authorization server-side.
 */
export const operations = ['listTasks', 'getTask', 'startTask', 'uploadPhoto', 'submitReport', 'submitIssue', 'analyzeNote'];
export function createWorkerGateway(bindings) {
  for (const name of operations) if (typeof bindings[name] !== 'function') throw new Error(`Не подключена операция: ${name}`);
  return Object.freeze(Object.fromEntries(operations.map(name => [name, (...args) => bindings[name](...args)])));
}
export const REQUEST_TIMEOUT_MS = 30000;
export const UPLOAD_TIMEOUT_MS = 60000;
const interrupted = code => Object.assign(new Error(code === 'WORKER_REQUEST_TIMEOUT' ? ru.requestTimeout : ru.requestCancelled), { code });

export async function requestJSON(url, { method = 'GET', body, signal, headers = {}, timeoutMs } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const deadline = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : isForm ? UPLOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  if (signal?.aborted) throw interrupted('WORKER_REQUEST_ABORTED');
  const controller = new AbortController();
  let stop;
  const cancelled = new Promise((_, reject) => {
    stop = code => {
      if (controller.signal.aborted) return;
      const error = interrupted(code);
      reject(error);
      controller.abort(error);
    };
  });
  const onAbort = () => stop('WORKER_REQUEST_ABORTED');
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop('WORKER_REQUEST_TIMEOUT'), deadline);
  try {
    // Keep the deadline through body consumption. A timed-out mutation may have
    // committed: never retry here or replace the caller's body/idempotency key.
    return await Promise.race([cancelled, (async () => {
      const response = await fetch(url, { method, credentials: 'same-origin', signal: controller.signal,
        headers: { ...(!isForm && body ? { 'Content-Type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
      if (!response.ok) {
        let details;try{details=await response.json();}catch{}
        const error = new Error(details?.error?.message || (response.status === 403 ? 'Нет доступа к заданию.' : `Запрос не выполнен (HTTP ${response.status}). Обновите данные или повторите попытку.`));
        error.status = response.status;
        error.code=details?.error?.code;error.requestId=details?.error?.requestId;
        throw error;
      }
      return response.status === 204 ? null : await response.json();
    })()]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
