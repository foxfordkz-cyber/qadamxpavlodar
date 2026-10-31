// Reject outgoing non-loopback TCP and all UDP/DNS queries, except explicit model hosts.
// LLM_ALLOWED_HOSTS=api.example.com,other.example — exact host names only (assistant of participant 3).
// This is a Node API guard, not an OS sandbox or a production security boundary.
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import { syncBuiltinESMExports } from 'node:module';
const llmHosts = (process.env.LLM_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
// Точные имена: api.x.ai или имя сервиса в docker compose (ollama). IP-адреса и шаблоны не принимаются.
for (const h of llmHosts) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h) || /^[\d.]+$/.test(h)) throw new Error(`LLM_ALLOWED_HOSTS: use exact DNS names, got ${h}`);
const cloudHosts = (process.env.CLOUD_ALLOWED_HOSTS ?? '').split(',').map(h=>h.trim().toLowerCase()).filter(Boolean);
for (const h of cloudHosts) if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(h) || /^[\d.]+$/.test(h)) throw new Error('CLOUD_ALLOWED_HOSTS requires exact DNS names');
const allowed = new Set(['127.0.0.1','localhost','::1','[::1]',...llmHosts,...cloudHosts]);
// Адреса «все интерфейсы» (HOST=0.0.0.0 в Docker): server.listen проверяет их через dns.lookup.
// Это входящие соединения, поэтому разрешены только в lookup, не в connect.
const listenOnly = new Set(['0.0.0.0','::']);
const blocked = [];
function deny(destination) {
  blocked.push(String(destination));
  const error = new Error('LOCAL_NETWORK_ONLY: external networking is disabled in this preparation');
  error.code = 'LOCAL_NETWORK_ONLY';
  throw error;
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const first = values[0];
  const socketPath = first && typeof first === 'object' ? first.path :
    (typeof first === 'string' && !/^\d+$/.test(first) ? first : undefined);
  if (socketPath) {
    // tsx uses a local named pipe. Windows remote named pipes remain blocked.
    const localIpc = process.platform === 'win32' ?
      (socketPath.startsWith('\\\\.\\pipe\\') || socketPath.startsWith('\\\\?\\pipe\\')) : socketPath.startsWith('/');
    if (!localIpc) deny('non-local IPC');
    return originalConnect.apply(this,args);
  }
  const host = first && typeof first === 'object' ? first.host ?? first.hostname ?? 'localhost' :
    (typeof first === 'number' || /^\d+$/.test(String(first))) ? (typeof values[1] === 'string' ? values[1] : 'localhost') : null;
  if (!host || !allowed.has(host)) deny(host ?? 'non-TCP socket');
  return originalConnect.apply(this,args);
};
const originalLookup = dns.lookup;
dns.lookup = function (hostname,...args) {
  if (!allowed.has(hostname) && !listenOnly.has(hostname)) deny(hostname);
  return originalLookup.call(this,hostname,...args);
};
for (const name of Object.keys(dns)) if (name.startsWith('resolve') || name === 'reverse' || name === 'lookupService') {
  if (typeof dns[name] === 'function') dns[name] = (...args) => deny(`dns:${args[0]}`);
}
for (const name of Object.keys(dns.promises)) if (name.startsWith('resolve') || name === 'reverse' || name === 'lookupService') {
  if (typeof dns.promises[name] === 'function') dns.promises[name] = async (...args) => deny(`dns:${args[0]}`);
}
const originalPromiseLookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = async (hostname,...args) => {
  if (!allowed.has(hostname) && !listenOnly.has(hostname)) deny(hostname);
  return originalPromiseLookup(hostname,...args);
};
dgram.createSocket = () => deny('UDP');
syncBuiltinESMExports();
export function networkAudit() { return { blocked: [...blocked] }; }
