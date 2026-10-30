import { Store } from '../db.js';
import { loadConfig } from '../config.js';
import { seedOutcomes } from './seed.js';
const s=new Store(loadConfig().dbPath);
try{console.log(JSON.stringify(seedOutcomes(s)));}finally{s.close();}
