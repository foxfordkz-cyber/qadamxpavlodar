import { loadConfig } from './config.js';
import { Store } from './db.js';
import { seed } from './seed.js';

const config = loadConfig();
const store = new Store(config.dbPath);
try { console.log(JSON.stringify({ database: config.dbPath, ...seed(store) }, null, 2)); }
finally { store.close(); }
