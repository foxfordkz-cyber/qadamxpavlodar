import { t, type Key } from '../../../shared/i18n';
import { ApiError } from '../../../shared/api/transport';

export const IMPORT_TEXT_ACCEPT = '.geojson,.json,.kml,.csv';
export const IMPORT_API_ACCEPT = `${IMPORT_TEXT_ACCEPT},.zip`;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const errorKeys: Record<string, Key> = {
  MISSING_CRS: 'import.errorCrs', INVALID_ARCHIVE: 'import.errorArchive',
  UNSAFE_ARCHIVE: 'import.errorArchive', INVALID_IMPORT: 'import.errorRead',
};
const issueKeys: Record<string, Key> = {
  'Outside Pavlodar area; verify coordinates': 'import.issueOutside',
  'Invalid geometry, ring, intersection or coordinates; use WGS84 [lng,lat]': 'import.issueGeometry',
  'Missing name': 'import.issueName',
};
export const importIssueText = (text: string) => issueKeys[text] ? t(issueKeys[text]) : text;
export function localizedImportError(error: unknown): unknown {
  if (!(error instanceof ApiError)) return error;
  // The screen's V2 adapter normalizes otherwise unknown server codes to lowercase.
  const code = error.code.toUpperCase();
  const key = errorKeys[code];
  const message = code === 'FILE_TOO_LARGE' ? t('import.maxSize', { size: 5 }) : key ? t(key) : null;
  return message === null ? error : new ApiError(error.status, error.code, message, error.requestId, error.details);
}

/** Binary ZIP must reach the server byte-for-byte, without a text decoding step. */
export async function prepareImportFile(file: Pick<File, 'name' | 'size' | 'arrayBuffer' | 'text'>) {
  if (file.size > MAX_FILE_BYTES) throw new Error(t('import.maxSize', { size: 5 }));
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'shp') throw new Error(t('import.shpArchiveRequired'));
  if (!['geojson', 'json', 'kml', 'csv', 'zip'].includes(ext))
    throw new Error(t('dynamic.013', { p0: ext }));
  const format = ext === 'zip' ? 'shp' : ext === 'json' ? 'geojson' : ext;
  if (format !== 'shp') return { format, content: await file.text() };
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return { format, content: btoa(binary) };
}
