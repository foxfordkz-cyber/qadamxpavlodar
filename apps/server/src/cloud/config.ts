import { readFileSync } from 'node:fs';
import type { PoolConfig } from 'pg';

export type CloudConfig = { database: PoolConfig; allowedHosts: string[]; frontendOrigins: string[];
  port: number; host: string; secureCookies: boolean; proxyHops: 0 | 1; localTest: boolean };
export function cloudConfig(env: NodeJS.ProcessEnv = process.env): CloudConfig {
  const localTest = env.CLOUD_LOCAL_TEST === '1';
  if (!env.DATABASE_URL) throw Error('DATABASE_URL is required');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw Error('DATABASE_URL is invalid'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || !url.pathname.slice(1) || url.search || url.hash)
    throw Error('Use a PostgreSQL URL without query parameters; TLS is configured separately');
  if (localTest && !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw Error('CLOUD_LOCAL_TEST permits loopback PostgreSQL only');
  const allowedHosts = (env.ALLOWED_HOSTS ?? (localTest?'localhost,127.0.0.1':'')).split(',').map(x=>x.trim()).filter(Boolean);
  if (!allowedHosts.length || allowedHosts.some(x=>!/^([a-z0-9-]+\.)*[a-z0-9-]+$/.test(x))) throw Error('ALLOWED_HOSTS requires exact host names');
  const frontendOrigins = (env.FRONTEND_ORIGINS ?? '').split(',').map(x=>x.trim()).filter(Boolean);
  for (const origin of frontendOrigins) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.username || parsed.password || (parsed.protocol !== 'https:' && !localTest)) throw Error('FRONTEND_ORIGINS requires exact HTTPS origins');
  }
  if (!localTest) {
    const allowed = new Set((env.CLOUD_ALLOWED_HOSTS ?? '').split(',').map(x=>x.trim()));
    if (!allowed.has(url.hostname)) throw Error('PostgreSQL host must be in CLOUD_ALLOWED_HOSTS');
    if (!frontendOrigins.length) throw Error('FRONTEND_ORIGINS is required in cloud mode');
  }
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT is invalid');
  if (env.CLOUD_TRUST_PROXY_HOPS && !['0','1'].includes(env.CLOUD_TRUST_PROXY_HOPS)) throw Error('CLOUD_TRUST_PROXY_HOPS must be 0 or 1');
  return { database: { connectionString: env.DATABASE_URL, ssl: localTest ? false : {
    rejectUnauthorized: true, ...(env.PG_CA_FILE ? { ca: readFileSync(env.PG_CA_FILE,'utf8') } : {}) } },
    allowedHosts, frontendOrigins, port, host: localTest?'127.0.0.1':'0.0.0.0', secureCookies: !localTest,
    proxyHops: env.CLOUD_TRUST_PROXY_HOPS === '1' ? 1 : 0, localTest };
}
