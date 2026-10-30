import { Store } from '../db.js';
import { loadConfig } from '../config.js';
import { seedOutcomes } from './seed.js';
import { parseArgs } from 'node:util';
const {values}=parseArgs({options:{'site-id':{type:'string'},'plant-ids':{type:'string'}}});
if(Boolean(values['site-id'])!==Boolean(values['plant-ids']))throw new Error('Use --site-id and --plant-ids together');
const existing=values['site-id']?{siteId:values['site-id'],plantIds:values['plant-ids']!.split(',').map(x=>x.trim())}:undefined;
const s=new Store(loadConfig().dbPath);
try{console.log(JSON.stringify(seedOutcomes(s,existing)));}finally{s.close();}
