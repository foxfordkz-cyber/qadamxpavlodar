import { ru, dictionary } from './strings.mjs';

export const normalizeWorkerLocale = locale => locale === 'kk' || locale === 'kk-draft' ? 'kk' : 'ru';
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? ''));

// Only call this on application-owned labels, never on notes, names or descriptions.
// Legacy gateways keep their original data and payloads; only their display changes.
export function displayText(value, t) {
  if (typeof value !== 'string') return value ?? '';
  for (const source of [ru, dictionary('kk')]) {
    for (const [key, label] of Object.entries(source)) {
      if (typeof label === 'string' && label === value) return t[key];
      if (label && typeof label === 'object' && !Array.isArray(label)) {
        for (const [name, entry] of Object.entries(label)) if (entry === value && t[key]?.[name]) return t[key][name];
      }
    }
  }
  return value;
}

export function localizedError(error, t) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'WORKER_REQUEST_TIMEOUT') return t.requestTimeout;
  if (code === 'WORKER_REQUEST_ABORTED' || error?.name === 'AbortError') return t.requestCancelled;
  const message = error?.message || String(error);
  if (Object.hasOwn(t.errorMessages, message)) return t.errorMessages[message];
  const known = displayText(message, t);
  if (known !== message || Object.values(t).includes(message)) return known;
  const photoLimit = /^Фотография больше (\d+) МБ\./.exec(message);
  if (photoLimit) return fill(t.errorPhotoTooLarge, { mb: photoLimit[1] });
  const photoCount = /^Можно отправить не больше (\d+) фотографий\./.exec(message);
  if (photoCount) return fill(t.errorPhotoCount, { maximum: photoCount[1] });
  if (/CSRF/.test(code)) return t.errorCSRF;
  if (['AUTH_REQUIRED', 'SESSION_REVOKED', 'UNAUTHENTICATED'].includes(code) || error?.status === 401) return t.errorUnauthorized;
  if (['CONTEXT_STALE', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(code) || error?.status === 409) return t.errorConflict;
  if (error?.status === 403) return t.errorForbidden;
  if (error?.status === 404) return t.errorNotFound;
  if ([400, 413, 415, 422].includes(error?.status)) return t.errorValidation;
  if (error?.status >= 500 || /UNAVAILABLE/.test(code)) return t.errorUnavailable;
  if (error?.name === 'QuotaExceededError' || error?.name === 'InvalidStateError') return t.errorStorage;
  if (error instanceof TypeError || /NETWORK|FETCH/.test(code) || /Failed to fetch|NetworkError|Load failed|Ответ потерян/.test(message)) return t.errorNetwork;
  // An opaque server error can contain arbitrary text. Keep the UI actionable in
  // the selected language without attempting to translate or expose that text.
  return t.errorGeneric;
}

export function clockLabel(value, t) {
  if (!value || !Number.isFinite(Date.parse(value))) return t.missingTime;
  return new Date(Date.parse(value) + 5 * 3600000).toISOString().slice(11, 16);
}

export function formatDateTime(value, t) {
  if (!value || !Number.isFinite(Date.parse(value))) return t.noData;
  const date = new Date(Date.parse(value) + 5 * 3600000);
  if (t === ru || t.monthNames[0] === ru.monthNames[0]) {
    return new Intl.DateTimeFormat('ru-KZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qyzylorda' }).format(new Date(value));
  }
  return `${date.getUTCDate()} ${t.monthNames[date.getUTCMonth()]}, ${clockLabel(value, t)}`;
}

export function taskLabels(task, t) {
  const correction = task.status === 'assigned' && (task.revisionOf || task.statusLabel === ru.statusNames.changes_requested);
  return {
    action: t.actionNames[task.actionCode] || displayText(task.action, t),
    status: t.statusNames[correction ? 'changes_requested' : task.status] || displayText(task.statusLabel, t),
    priority: t.priorityNames[task.priority] || displayText(task.priority, t),
    due: task.dueAt ? fill(t.taskDue, { time: clockLabel(task.dueAt, t) }) : displayText(task.due || t.missingTime, t),
    duration: Number.isFinite(task.estimatedMinutes) ? `${task.estimatedMinutes} ${t.minuteUnit}` : displayText(task.duration, t),
    object: task.objectType === 'plant' ? t.plantObject : task.objectType === 'site' ? t.siteObject : displayText(task.objectLabel, t),
    norm: Number.isFinite(task.requiredWaterLiters) ? fill(t.waterNorm, { liters: task.requiredWaterLiters }) : task.norm,
    normSource: displayText(task.normSource, t),
    address: task.address === ru.demoAddress ? t.demoAddress : task.address,
  };
}
