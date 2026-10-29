import { ApiError } from './errors.js';

// PROPOSED: date filters mean created_at on a calendar day in UTC+5 (Pavlodar).
export function localDayRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new ApiError(400, 'INVALID_DATE', 'Use YYYY-MM-DD in UTC+5');
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const utc = Date.UTC(year, month - 1, date);
  if (year < 2000 || year > 2100 || new Date(utc).toISOString().slice(0, 10) !== day) {
    throw new ApiError(400, 'INVALID_DATE', 'Invalid calendar date (supported years: 2000–2100)');
  }
  return { start: new Date(utc - 5 * 3600000).toISOString(), end: new Date(utc + 19 * 3600000).toISOString() };
}
