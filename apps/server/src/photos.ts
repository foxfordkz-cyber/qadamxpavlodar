import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, realpathSync, lstatSync, writeFileSync, linkSync, unlinkSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import multer from 'multer';
import { z } from 'zod';
import { Store, present, type Row } from './db.js';
import { ApiError } from './errors.js';
import { type Actor, task, checkVersion, idempotent } from './service.js';
import { experimentalTask, experimentalHistory } from './experimental-workflow.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const uploadMultipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 1, fieldSize: 32, parts: 2 }
}).single('file');
export const photoVersion = z.object({ version: z.coerce.number().int().positive() }).strict();
export function reportAccess(store: Store, actor: Actor, reportId: string, experimental = false) {
  const table = experimental ? 'experimental_reports' : 'reports';
  const report = store.get(`SELECT * FROM ${table} WHERE id=?`, reportId);
  if (!report) throw new ApiError(404, 'NOT_FOUND', 'Report not found');
  const ownerTask = experimental ? experimentalTask(store, actor, String(report.task_id)) : task(store, actor, String(report.task_id));
  return { report, task: ownerTask };
}
export function photoDto(row: Row, experimental: boolean) {
  return { id: row.id, reportId: row.report_id, mediaType: row.media_type, byteSize: row.byte_size,
    sha256: row.sha256, isDemo: row.is_demo === 1, contentUrl: `${experimental ? '/experimental' : ''}/photos/${row.id}` };
}
export function readReport(store: Store, actor: Actor, reportId: string, experimental = false) {
  const { report } = reportAccess(store, actor, reportId, experimental);
  const table = experimental ? 'experimental_photos' : 'photos';
  return { data: present(report), photos: store.all(`SELECT * FROM ${table} WHERE report_id=? ORDER BY id`, reportId)
    .map(row => photoDto(row, experimental)) };
}

export class PhotoStorage {
  readonly root: string;
  readonly temporary: string;
  private processing = 0;
  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    if (lstatSync(root).isSymbolicLink()) throw new Error('Uploads root must not be a symbolic link');
    this.root = realpathSync(root);
    this.temporary = join(this.root, '.tmp');
    mkdirSync(this.temporary, { recursive: true });
    if (lstatSync(this.temporary).isSymbolicLink()) throw new Error('Uploads temporary directory must not be a symbolic link');
  }
  private safePath(name: string, temporary = false) {
    if (!/^[0-9a-f-]{36}\.(webp|tmp)$/.test(name)) throw new ApiError(500, 'INVALID_STORAGE_NAME', 'Invalid stored photo name');
    const root = temporary ? this.temporary : this.root;
    const path = resolve(root, name);
    if (path !== join(root, name)) throw new ApiError(500, 'INVALID_STORAGE_NAME', 'Invalid stored photo path');
    return path;
  }
  private remove(name: string, temporary = false) {
    const path = this.safePath(name, temporary);
    try {
      if (lstatSync(path).isFile()) unlinkSync(path);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  async normalize(input: Buffer) {
    if (input.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'PHOTO_TOO_LARGE', 'Photo exceeds 5 MiB');
    if (this.processing >= 2) throw new ApiError(429, 'PHOTO_BUSY', 'Two images are already processing; retry later');
    this.processing++;
    try {
      const supportedSignature = input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
        input.subarray(0,3).equals(Buffer.from([255,216,255])) ||
        (input.subarray(0,4).toString('ascii') === 'RIFF' && input.subarray(8,12).toString('ascii') === 'WEBP');
      if (!supportedSignature) throw new ApiError(415, 'INVALID_PHOTO_TYPE', 'File bytes are not JPEG, PNG or WebP');
      const options = { failOn: 'warning' as const, limitInputPixels: 16_777_216 };
      const metadata = await sharp(input, options).metadata();
      if (!['jpeg','png','webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) !== 1) {
        throw new ApiError(415, 'INVALID_PHOTO_TYPE', 'Only single-frame JPEG, PNG and WebP are accepted');
      }
      if (!metadata.width || !metadata.height || metadata.width > 4096 || metadata.height > 4096) {
        throw new ApiError(413, 'PHOTO_DIMENSIONS', 'Photo dimensions must be at most 4096 x 4096');
      }
      // Decode and re-encode: remove EXIF/metadata, filenames and trailing embedded payloads.
      const output = await sharp(input, options).rotate().webp({ quality: 85 }).timeout({ seconds: 5 }).toBuffer();
      if (output.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'PHOTO_TOO_LARGE', 'Normalized image exceeds 5 MiB');
      return output;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(415, 'INVALID_PHOTO', 'Image could not be safely decoded');
    } finally { this.processing--; }
  }
  async save(store: Store, actor: Actor, reportId: string, file: Express.Multer.File | undefined,
    fields: unknown, key: string | undefined, experimental = false) {
    const { report } = reportAccess(store, actor, reportId, experimental);
    if (actor.role !== 'worker' || report.author_id !== actor.id) throw new ApiError(403, 'FORBIDDEN', 'Only the assigned report author can attach a photo');
    const version = experimental ? photoVersion.parse(fields).version : (z.object({}).strict().parse(fields), undefined);
    if (!key || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(key)) throw new ApiError(400, 'INVALID_IDEMPOTENCY_KEY', 'Supply Idempotency-Key');
    if (!file) throw new ApiError(400, 'PHOTO_REQUIRED', 'Supply exactly one file field');
    const output = await this.normalize(file.buffer);
    const requestBody = { sha256: createHash('sha256').update(file.buffer).digest('hex'), ...(version ? { version } : {}) };
    const table = experimental ? 'experimental_photos' : 'photos';
    const prefix = experimental ? '/experimental' : '';
    let tempName: string | undefined;
    let finalName: string | undefined;
    try {
      return idempotent(store, actor, 'POST', `${prefix}/reports/${reportId}/photos`, key, requestBody, 201, () => {
        const latest = reportAccess(store, actor, reportId, experimental);
        if (experimental) {
          checkVersion(latest.task, version!);
          if (latest.report.status !== 'submitted' || latest.task.status !== 'submitted') {
            throw new ApiError(409, 'REPORT_LOCKED', 'Photos can only be added before review of this submitted report');
          }
        }
        if (Number(store.get(`SELECT count(*) AS n FROM ${table} WHERE report_id=?`, reportId)!.n) >= 5) {
          throw new ApiError(409, 'PHOTO_LIMIT', 'At most five photos per report');
        }
        const photoId = randomUUID();
        tempName = `${photoId}.tmp`;
        writeFileSync(this.safePath(tempName, true), output, { flag: 'wx' });
        // Exclusive link cannot overwrite a file, even on a random name collision.
        linkSync(this.safePath(tempName, true), this.safePath(`${photoId}.webp`));
        finalName = `${photoId}.webp`;
        this.remove(tempName, true);
        tempName = undefined;
        store.run(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,1)`, photoId, reportId, finalName, 'image/webp', output.length,
          createHash('sha256').update(output).digest('hex'));
        const data = photoDto(store.get(`SELECT * FROM ${table} WHERE id=?`, photoId)!, experimental);
        if (experimental) {
          const changed = store.run('UPDATE experimental_tasks SET version=version+1,updated_at=? WHERE id=? AND version=?',
            new Date().toISOString(), latest.task.id!, version!);
          if (changed.changes !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Task changed while attaching photo');
          return { data, task: experimentalHistory(store, actor, String(latest.task.id), 'submitted', 'attach_photo') };
        }
        return { data };
      });
    } catch (error) {
      if (finalName) this.remove(finalName);
      throw error;
    } finally {
      if (tempName) this.remove(tempName, true);
    }
  }
  read(store: Store, actor: Actor, photoId: string, experimental = false) {
    const row = store.get(`SELECT * FROM ${experimental ? 'experimental_photos' : 'photos'} WHERE id=?`, photoId);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Photo not found');
    reportAccess(store, actor, String(row.report_id), experimental);
    const path = this.safePath(String(row.storage_name));
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PHOTO_BYTES) throw new Error('Invalid stored file');
      const bytes = readFileSync(path);
      if (bytes.length !== row.byte_size || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('Photo integrity failure');
      return bytes;
    } catch { throw new ApiError(503, 'PHOTO_UNAVAILABLE', 'Stored photo is unavailable or failed integrity verification'); }
  }
  cleanupOrphans(store: Store, now = Date.now()) {
    // Crash leftovers only, with a 24-hour grace period; no public deletion endpoint.
    const referenced = new Set(store.all('SELECT storage_name FROM photos UNION SELECT storage_name FROM experimental_photos').map(r => r.storage_name));
    for (const temporary of [true, false]) {
      for (const name of readdirSync(temporary ? this.temporary : this.root)) {
        if (!/^[0-9a-f-]{36}\.(webp|tmp)$/.test(name) || (!temporary && referenced.has(name))) continue;
        const stat = lstatSync(this.safePath(name, temporary));
        if (stat.isFile() && now - stat.mtimeMs > 24 * 3600000) this.remove(name, temporary);
      }
    }
  }
}
