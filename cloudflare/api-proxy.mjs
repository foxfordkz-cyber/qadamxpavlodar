// Transport core only. There is deliberately no Pages Function or deployment
// binding until Bekzat supplies the reviewed origin/header/cookie contract.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'];
const UNTRUSTED_FORWARDING = ['forwarded', 'x-forwarded-for', 'x-forwarded-host',
  'x-forwarded-proto', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'];
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const isApi = pathname => pathname === '/api' || pathname.startsWith('/api/');

function originOnly(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new TypeError('Proxy configuration requires a fixed HTTPS origin.');
  return url;
}

function copyHeaders(source) {
  const headers = new Headers(source);
  // Preserve individual cookies, including Expires commas, in Workers and Node.
  const cookies = typeof source.getSetCookie === 'function' ? source.getSetCookie()
    : typeof source.getAll === 'function' ? source.getAll('Set-Cookie') : null;
  if (cookies) {
    headers.delete('set-cookie');
    for (const cookie of cookies) headers.append('set-cookie', cookie);
  }
  // Connection is untrusted input: malformed options are not valid header names.
  // Drop the Connection header itself and remove only valid nominated headers.
  const connection = (source.get('connection') || '').split(',').map(x => x.trim())
    .filter(name => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name));
  for (const name of [...HOP_BY_HOP, ...connection]) headers.delete(name);
  return headers;
}

function noStore(headers) {
  headers.set('Cache-Control', 'no-store, private');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Cloudflare-CDN-Cache-Control', 'no-store');
  headers.set('Pragma', 'no-cache');
  headers.delete('Expires');
  headers.delete('Age');
  return headers;
}

function failure(status, code) {
  // Never include upstream URL, request body, cookies, or the caught exception.
  return new Response(JSON.stringify({ error: { code } }), {
    status, headers: noStore(new Headers({ 'Content-Type': 'application/json' })),
  });
}

/**
 * Parameters must come from reviewed deployment configuration, never a request.
 * Retains the client's Origin; the API must explicitly allow the public origin.
 * Host is derived from the fixed upstream URL. Forwarded headers are removed,
 * not trusted or synthesised before the backend contract is agreed.
 * Cookies are preserved without rewriting Domain/Secure/SameSite/Path.
 */
export function createApiProxy({ upstreamOrigin, publicOrigin, timeoutMs = 65000 }, fetcher = fetch) {
  const upstream = originOnly(upstreamOrigin), publicSite = originOnly(publicOrigin);
  if (upstream.origin === publicSite.origin) throw new TypeError('Proxy origin loop.');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000)
    throw new TypeError('Proxy timeout must be between 1 and 120000 milliseconds.');
  return async function proxy(request) {
    const incoming = new URL(request.url);
    if (!isApi(incoming.pathname)) return null; // Future adapter delegates static assets to Pages.
    if (incoming.origin !== publicSite.origin) return failure(421, 'PROXY_ORIGIN_MISMATCH');
    if (request.signal.aborted) return failure(502, 'PROXY_UNAVAILABLE');
    const target = new URL(upstream.origin);
    target.pathname = incoming.pathname;
    target.search = incoming.search;
    const headers = copyHeaders(request.headers);
    for (const name of ['host', ...UNTRUSTED_FORWARDING]) headers.delete(name);
    for (const name of [...headers.keys()]) if (name.startsWith('x-forwarded-')) headers.delete(name);
    headers.set('Cache-Control', 'no-store');
    const controller = new AbortController();
    let timedOut = false;
    const cancel = () => controller.abort(request.signal.reason);
    if (request.signal.aborted) cancel();
    else request.signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      const body = ['GET', 'HEAD'].includes(request.method) ? undefined : request.body;
      const outbound = new Request(target, { method: request.method, headers, body,
        redirect: 'manual', signal: controller.signal, ...(body ? { duplex: 'half' } : {}) });
      const response = await fetcher(outbound, { cache: 'no-store', cf: { cacheTtlByStatus: { '100-599': -1 }, cacheEverything: false } });
      const resultHeaders = noStore(copyHeaders(response.headers));
      if (REDIRECTS.has(response.status) && resultHeaders.has('location')) {
        let destination;
        try { destination = new URL(resultHeaders.get('location'), target); }
        catch { await response.body?.cancel(); return failure(502, 'PROXY_REDIRECT_REJECTED'); }
        if (destination.origin !== upstream.origin || destination.username || destination.password || !isApi(destination.pathname)) {
          await response.body?.cancel();
          return failure(502, 'PROXY_REDIRECT_REJECTED');
        }
        resultHeaders.set('location', publicSite.origin + destination.pathname + destination.search + destination.hash);
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers: resultHeaders });
    } catch {
      return failure(timedOut ? 504 : 502, timedOut ? 'PROXY_TIMEOUT' : 'PROXY_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
    }
  };
}
