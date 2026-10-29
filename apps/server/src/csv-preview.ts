import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { Store } from './db.js';
import { ApiError } from './errors.js';
import { id } from './validation.js';

export const csvRequest = z.object({ csv: z.string().min(1).max(20000) }).strict();
const columns = ['id','name','species','latitude','longitude','condition'];
const csvNumber = z.string().trim().min(1).pipe(z.coerce.number<string>().finite());
const plantInput = z.object({
  id, name: z.string().trim().min(1).max(200), species: z.string().trim().min(1).max(200),
  latitude: csvNumber.pipe(z.number().min(-90).max(90)),
  longitude: csvNumber.pipe(z.number().min(-180).max(180)),
  condition: z.enum(['good','needs_care','unknown'])
}).strict();
export function previewCsv(store: Store, csv: string) {
  let records: Array<{ record: string[]; info: { lines: number } }>;
  try {
    records = parse(csv, { bom: true, skip_empty_lines: true, relax_column_count: true,
      max_record_size: 20000, info: true }) as unknown as typeof records;
  } catch { throw new ApiError(400, 'INVALID_CSV', 'CSV could not be parsed; use comma delimiters and valid quoting'); }
  const header = records.shift()?.record.map(c => c.trim());
  if (!header || header.length !== columns.length || new Set(header).size !== columns.length || columns.some(c => !header.includes(c))) {
    throw new ApiError(400, 'CSV_COLUMNS', `Columns must be exactly: ${columns.join(',')}`);
  }
  if (records.length > 200) throw new ApiError(413, 'CSV_TOO_MANY_ROWS', 'Preview accepts at most 200 data rows');
  const rows = records.map(({ record, info }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (record.length !== header.length) errors.push('Wrong number of columns');
    const raw = Object.fromEntries(header.map((name, i) => [name, record[i] ?? '']));
    const parsed = plantInput.safeParse(raw);
    if (!parsed.success) errors.push(...parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`));
    const data = parsed.success ? parsed.data : null;
    if (data && store.get('SELECT id FROM plants WHERE id=?', data.id)) errors.push('ID already exists in local database');
    if (data && store.get('SELECT id FROM plants WHERE name=? COLLATE NOCASE', data.name)) warnings.push('Name already exists; no overwrite or import will occur');
    return { line: info.lines, raw, data, errors, warnings };
  });
  const ids = new Map<string, number>();
  const positions = new Map<string, number>();
  for (const row of rows) {
    const key = row.raw.id;
    if (key) ids.set(key, (ids.get(key) ?? 0) + 1);
    if (row.data) {
      const position = `${row.data.name.toLowerCase()}|${row.data.latitude}|${row.data.longitude}`;
      positions.set(position, (positions.get(position) ?? 0) + 1);
    }
  }
  for (const row of rows) {
    if (row.raw.id && (ids.get(row.raw.id) ?? 0) > 1) row.errors.push('Duplicate ID within CSV');
    if (row.data && (positions.get(`${row.data.name.toLowerCase()}|${row.data.latitude}|${row.data.longitude}`) ?? 0) > 1) {
      row.errors.push('Duplicate name and coordinates within CSV');
    }
  }
  return { mode: 'DEMO', contract: 'PROPOSED', previewOnly: true, imported: 0,
    counts: { total: rows.length, valid: rows.filter(r => !r.errors.length).length, invalid: rows.filter(r => r.errors.length).length },
    rows: rows.map(row => ({ ...row, valid: row.errors.length === 0 })) };
}
