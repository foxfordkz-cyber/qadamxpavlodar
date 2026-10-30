import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export const e2eDir = fileURLToPath(new URL('..', import.meta.url));
export const serverEnv = new URL('../../../apps/server/.env', import.meta.url);

export function apiPassword(env = process.env, read = readFileSync) {
  if (env.E2E_PASSWORD) return { value: env.E2E_PASSWORD, source: 'E2E_PASSWORD' };
  try {
    const value = parseEnv(read(serverEnv, 'utf8')).DEMO_PASSWORD;
    return { value: value || undefined, source: value ? 'apps/server/.env' : 'absent' };
  } catch (error) {
    if (error.code === 'ENOENT') return { value: undefined, source: 'absent' };
    throw new Error('Cannot read server .env (contents omitted)');
  }
}

export function baseUrl(value = 'http://localhost:5174') {
  let url;
  try { url = new URL(value); } catch { throw new Error('E2E_BASE_URL must be an HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('E2E_BASE_URL must be HTTP(S) without embedded credentials');
  }
  return url;
}

export function redact(value, secrets = []) {
  let text = String(value ?? '');
  for (const secret of secrets.filter(Boolean)) {
    for (const encoded of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)])) {
      text = text.split(encoded).join('[redacted]');
    }
  }
  return text;
}
