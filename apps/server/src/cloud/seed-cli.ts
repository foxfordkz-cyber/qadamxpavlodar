import { seedCloudPlanning } from './planning-seed.js';
import { cloudConfig } from './config.js';
import { PostgresDatabase } from './database.js';
import { migrate } from './migrations.js';
import { seedCloudDemo } from './seed.js';

let db:PostgresDatabase|undefined;
try {
  if(process.env.CLOUD_DEMO_SEED!=='1')throw Error('Explicit cloud-demo seed opt-in is required');
  db=new PostgresDatabase(cloudConfig().database);await migrate(db);
  await seedCloudDemo(db,process.env.DEMO_PASSWORD??'');
  await seedCloudPlanning(db);
  console.log('Cloud DEMO seed complete; existing accounts preserved');
} catch { console.error('Cloud DEMO seed failed; check configuration (credentials redacted)');process.exitCode=1; }
finally { if(db)await db.close(); }
