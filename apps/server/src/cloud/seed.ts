import { hashPassword, password } from '../v2/auth.js';
import { now } from '../v2/core.js';
import { PostgresDatabase } from './database.js';

export async function seedCloudDemo(db: PostgresDatabase, demoPassword: string) {
  password.parse(demoPassword);
  const hash = await hashPassword(demoPassword);
  await db.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(733112622)');
    for (const role of ['admin','coordinator','foreman','worker','viewer']) {
      // No UPDATE: repeat seed must not change a password, role, version, or existing user data.
      await client.query(`INSERT INTO gp_cloud.users VALUES ($1,$2,$3,$4,1,$5,1,$6,$6) ON CONFLICT(id) DO NOTHING`,
        [`cloud-demo-${role}`,role,`Cloud DEMO ${role}`,role,hash,now()]);
    }
  });
}
