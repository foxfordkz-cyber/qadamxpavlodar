import { Store } from './db.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const store = new Store(config.dbPath);
const server = createApp(store, { uploadsPath: config.uploadsPath, frontendOrigins: config.frontendOrigins }).listen(config.port, config.host, () => {
  console.log(`Green Pavlodar DEMO (draft API): http://${config.host}:${config.port}`);
  console.log(`Local SQLite: ${config.dbPath}`);
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
