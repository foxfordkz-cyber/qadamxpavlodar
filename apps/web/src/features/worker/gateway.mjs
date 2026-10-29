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
export async function requestJSON(url, { method = 'GET', body, signal, headers = {} } = {}) {
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const response = await fetch(url, { method, credentials: 'same-origin', signal,
    headers: { ...(!isForm && body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  if (!response.ok) {
    let details;try{details=await response.json();}catch{}
    const error = new Error(details?.error?.message || (response.status === 403 ? 'Нет доступа к заданию.' : `Запрос не выполнен (HTTP ${response.status}). Обновите данные или повторите попытку.`));
    error.status = response.status;
    error.code=details?.error?.code;error.requestId=details?.error?.requestId;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}
