import { cloudConfig } from './config.js';
import { PostgresDatabase } from './database.js';
import { migrate } from './migrations.js';
import { createCloudApp } from './app.js';

let db:PostgresDatabase|undefined;
try {
  const config=cloudConfig();db=new PostgresDatabase(config.database);
  await migrate(db);
  const server=createCloudApp(db,config).listen(config.port,config.host,()=>console.log('Cloud API listening; PostgreSQL slice only'));
  let stopping=false;
  const stop=()=>{
    if(stopping)return;stopping=true;
    const timer=setTimeout(()=>process.exit(1),15000);timer.unref();
    server.close(()=>{void db!.close().then(()=>{clearTimeout(timer);process.exit(0);});});
    server.closeIdleConnections();
  };
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
} catch {
  console.error('Cloud startup failed; check required configuration, PostgreSQL connectivity and migration status (credentials redacted)');
  if(db)await db.close();process.exitCode=1;
}
