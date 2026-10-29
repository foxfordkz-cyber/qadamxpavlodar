import { resolve, relative, isAbsolute, join } from 'node:path';

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];
const list = (value: string | undefined) => (value ?? '').split(',').map(x => x.trim()).filter(Boolean);
function inside(root: string, path: string) {
  const rel = relative(root, path);
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Локально всё как раньше: loopback, база в ./data, фото в ./uploads.
 * В контейнере (SRV-03): HOST=0.0.0.0, NODE_ENV=production, STORAGE_ROOT=/data (volume),
 * ALLOWED_HOSTS и FRONTEND_ORIGINS — явные списки, без шаблонов.
 */
export function loadConfig(env = process.env) {
  const mode = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('NODE_ENV must be development, test or production');
  const port = Number(env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const host = env.HOST ?? '127.0.0.1';
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)) throw new Error('HOST must be 127.0.0.1, ::1 or (in a container) 0.0.0.0');

  const storageRoot = env.STORAGE_ROOT ? resolve(env.STORAGE_ROOT) : null;
  const dbPath = resolve(env.DB_PATH ?? (storageRoot ? join(storageRoot, 'db/green-pavlodar.sqlite') : './data/green-pavlodar-demo.sqlite'));
  if (!inside(storageRoot ?? resolve('data'), dbPath)) {
    throw new Error(storageRoot ? 'DB_PATH must be a file inside STORAGE_ROOT' : 'DB_PATH must point to a local file inside this project\'s data/ directory.');
  }
  const uploadsPath = resolve(env.UPLOADS_PATH ?? (storageRoot ? join(storageRoot, 'uploads') : './uploads'));
  const uploadsRoot = storageRoot ?? resolve('uploads');
  if (uploadsPath !== uploadsRoot && !inside(uploadsRoot, uploadsPath)) {
    throw new Error(storageRoot ? 'UPLOADS_PATH must be inside STORAGE_ROOT' : 'UPLOADS_PATH must be the local uploads/ directory or a child');
  }

  // Имена без порта, как их видит req.hostname. По умолчанию — только loopback.
  const allowedHosts = [...new Set([...LOOPBACK_HOSTS, ...list(env.ALLOWED_HOSTS).map(h => h.toLowerCase())])];
  for (const h of allowedHosts) if (!/^(\[[0-9a-f:]+\]|[a-z0-9.-]+)$/.test(h)) throw new Error(`ALLOWED_HOSTS: invalid host ${h}`);
  const frontendOrigins = list(env.FRONTEND_ORIGINS).map(origin => {
    const url = new URL(origin);
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    const listed = ['http:', 'https:'].includes(url.protocol) && allowedHosts.includes(url.hostname);
    if (!(local || listed) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('FRONTEND_ORIGINS permits explicit origins on loopback or ALLOWED_HOSTS only');
    }
    return url.origin;
  });
  // За nginx в compose адрес клиента (для лимита попыток входа) берём из X-Forwarded-For только от прокси в частной сети.
  const trustProxy: false | 'loopback' | 'uniquelocal' = env.TRUST_PROXY === 'uniquelocal' || env.TRUST_PROXY === 'loopback' ? env.TRUST_PROXY : false;
  return { mode, host, port, dbPath, uploadsPath, allowedHosts, frontendOrigins, trustProxy };
}
