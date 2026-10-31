// Capture the actual HTTP generator; no manually adjusted expectations.
import { writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createCloudApp } from '../src/cloud/app.ts';
import { PostgresDatabase } from '../src/cloud/database.ts';
import { cloudConfig } from '../src/cloud/config.ts';
const db=new PostgresDatabase({}); // The public specification route never queries a database.
const config=cloudConfig({DATABASE_URL:'postgresql://placeholder:placeholder@127.0.0.1/demo',CLOUD_LOCAL_TEST:'1',ALLOWED_HOSTS:'127.0.0.1'});
const server=createCloudApp(db,config).listen(0,'127.0.0.1');
try {
  await once(server,'listening');
  const res=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/openapi.json`);
  if(!res.ok)throw Error('Cloud OpenAPI generator failed');
  const spec=await res.json();await writeFile('openapi-cloud.json',JSON.stringify(spec,null,2)+'\n');
  console.log('Generated cloud OpenAPI:',Object.values(spec.paths).reduce((n,p)=>n+Object.keys(p).length,0),'operations');
} finally {server.closeAllConnections();await new Promise(r=>server.close(r));await db.close();}
