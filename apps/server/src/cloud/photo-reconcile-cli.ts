import { cloudConfig } from './config.js';
import { PostgresDatabase } from './database.js';
import { migrate } from './migrations.js';
import { CloudPhotos } from './photo-service.js';
import { SupabasePrivateStorage } from './private-storage.js';
import { PostgresWorkflowRepository } from './workflow-repository.js';

let db:PostgresDatabase|undefined;
try{
  const args=process.argv.slice(2);if(args.some(a=>a!=='--apply'))throw Error('Only --apply is supported; default is dry-run');
  const config=cloudConfig();if(!config.storage)throw Error('Private storage is not configured');
  db=new PostgresDatabase(config.database);await migrate(db);
  const photos=new CloudPhotos(new PostgresWorkflowRepository(db),new SupabasePrivateStorage(config.storage));
  // Intents touched within the last 24 hours are never candidates for this maintenance command.
  const result=await photos.reconcile(new Date(Date.now()-24*3600000).toISOString(),args.includes('--apply'));
  console.log(JSON.stringify(result));
}catch{console.error('Photo reconciliation failed; check private storage/database configuration (credentials redacted)');process.exitCode=1;}
finally{if(db)await db.close();}
