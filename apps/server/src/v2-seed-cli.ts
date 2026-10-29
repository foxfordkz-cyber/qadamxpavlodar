import { seedMunicipal } from './municipal/data.js';
import { Store } from './db.js';
import { loadConfig } from './config.js';
import { seed } from './seed.js';
import { seedV2,seedV2Scenario } from './v2/seed.js';
const store=new Store(loadConfig().dbPath);
try{seed(store);console.log(JSON.stringify(await seedV2(store),null,2));seedV2Scenario(store);console.log(JSON.stringify(await seedMunicipal(store)));console.log('V2 DEMO fixtures created if absent. Existing records and passwords preserved.');}finally{store.close();}
