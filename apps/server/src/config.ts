import { resolve, relative, isAbsolute } from 'node:path';

export function loadConfig(env = process.env) {
  if (env.NODE_ENV && !['development', 'test'].includes(env.NODE_ENV)) {
    throw new Error('This preparation server only runs in development/test mode.');
  }
  const port = Number(env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  const dbPath = resolve(env.DB_PATH ?? './data/green-pavlodar-demo.sqlite');
  const localPath = relative(resolve('data'), dbPath);
  if (!localPath || localPath.startsWith('..') || isAbsolute(localPath)) {
    throw new Error('DB_PATH must point to a local file inside this project\'s data/ directory.');
  }
  const uploadsPath = resolve(env.UPLOADS_PATH ?? './uploads');
  const uploadsRelative = relative(resolve('uploads'), uploadsPath);
  if (uploadsRelative.startsWith('..') || isAbsolute(uploadsRelative)) throw new Error('UPLOADS_PATH must be the local uploads/ directory or a child');
  const frontendOrigins = (env.FRONTEND_ORIGINS ?? '').split(',').filter(Boolean).map(origin => {
    const url = new URL(origin.trim());
    if (url.protocol !== 'http:' || !['localhost','127.0.0.1'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('FRONTEND_ORIGINS permits explicit local HTTP origins only');
    }
    return url.origin;
  });
  return { host: env.LOCAL_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1', port, dbPath, uploadsPath, frontendOrigins };
}
