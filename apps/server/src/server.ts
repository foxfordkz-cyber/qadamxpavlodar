import { Store } from './db.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLlmAssistant, llmProviders } from './tz/llm.js';

const config = loadConfig();
const store = new Store(config.dbPath);
// Ассистент на модели — только если в .env заданы LLM_API_KEY и LLM_MODEL (резерв — LLM2_*); иначе ответы по правилам.
const providers = llmProviders();
const assistant = providers.length ? createLlmAssistant(store, providers) : undefined;
const app = createApp(store, { uploadsPath: config.uploadsPath, frontendOrigins: config.frontendOrigins, allowedHosts: config.allowedHosts, trustProxy: config.trustProxy, tz: { assistant } });
const allowed = ['127.0.0.1', 'localhost', '[::1]', ...(process.env.LLM_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase())];
for (const [i, p] of providers.entries()) {
  const host = new URL(p.baseUrl).hostname;
  console.log(`Assistant ${i ? `reserve ${i}` : 'model'}: ${p.model} at ${host}`);
  if (!allowed.includes(host)) console.warn(`LLM host ${host} is not in LLM_ALLOWED_HOSTS: the network guard will block it.`);
}
if (!providers.length) console.log('Assistant: rules only (set LLM_API_KEY and LLM_MODEL in .env for the model)');
const server = app.listen(config.port, config.host, () => {
  console.log(`Green Pavlodar DEMO (${config.mode}): http://${config.host}:${config.port}`);
  console.log(`SQLite: ${config.dbPath}; allowed hosts: ${config.allowedHosts.join(', ')}`);
});
server.on('error', error => { console.error(error.message); store.close(); process.exitCode = 1; });
let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  server.close(() => { store.close(); });
  const timer = setTimeout(() => { server.closeAllConnections(); }, 3000);
  timer.unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
