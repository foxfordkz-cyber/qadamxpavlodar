// Время: хранение UTC, показ явно в UTC+5 (контракт, раздел 2).
const OFFSET_MS = 5 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

function shifted(iso: string) {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t + OFFSET_MS);
}

export function fmtDate(iso?: string | null): string {
  const d = iso ? shifted(iso) : null;
  return d ? `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}` : '—';
}
export function fmtTime(iso?: string | null): string {
  const d = iso ? shifted(iso) : null;
  return d ? `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '—';
}
export function fmtDateTime(iso?: string | null): string {
  return iso && shifted(iso) ? `${fmtDate(iso)} ${fmtTime(iso)} (UTC+5)` : '—';
}
/** YYYY-MM-DDTHH:mm в UTC+5 → ISO UTC. */
export function localInputToIso(v: string): string | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - OFFSET_MS).toISOString();
}
export function isoToLocalInput(iso?: string | null): string {
  const d = iso ? shifted(iso) : null;
  return d ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : '';
}
export const fmtArea = (m2?: number | null) => (m2 == null ? 'неизвестна' : m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} га` : `${m2.toLocaleString('ru-RU')} м²`);
export const fmtCoord = (lat: number, lng: number) => `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
