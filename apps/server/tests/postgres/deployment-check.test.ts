import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDeployment } from '../../src/cloud/deployment-check.js';
import { postgresFixture } from './workflow-helpers.js';
import { privateTestStorage } from './private-test-storage.js';

test('operator preflight reads real PostgreSQL and private test HTTP storage without mutation', {timeout:180000}, async t => {
  const storage = await privateTestStorage(); t.after(() => storage.stop());
  const f = await postgresFixture(t, storage.env);
  const connectionString = f.db.pool.options.connectionString!;
  const env = {DATABASE_URL:connectionString, CLOUD_LOCAL_TEST:'1', ALLOWED_HOSTS:'127.0.0.1', ...storage.env};
  const tables = ['users','sessions','documents','planning_documents','schema_migrations','uploads'];
  const before = await f.snapshot(tables);
  const pass = await checkDeployment(env, 'ready', true);
  assert.equal(pass.environment, 'local-test');
  assert.equal(pass.privateStorage, 'PASS');
  assert.equal(pass.renderHttpsWorkflow, 'NOT RUN');
  assert.deepEqual(pass.appliedVersions, [1,2,3,4,5]);
  await assert.rejects(checkDeployment(env, 'ready'), {stage:'configuration'});
  storage.setPublic(true);
  await assert.rejects(checkDeployment(env, 'ready', true), {stage:'private-storage'});
  storage.setPublic(false);
  storage.setOffline(true);
  await assert.rejects(checkDeployment(env, 'ready', true), {stage:'private-storage'});
  storage.setOffline(false);
  const empty = await f.isolatedDatabase('qa_deploy_check'); t.after(() => empty.close());
  const emptyEnv = {...env, DATABASE_URL:empty.pool.options.connectionString!};
  assert.equal((await checkDeployment(emptyEnv, 'before-migrations', true)).migrations, 'PENDING');
  await assert.rejects(checkDeployment(emptyEnv, 'ready', true), {stage:'migration-checksums'});
  assert.equal((await empty.pool.query("SELECT to_regnamespace('gp_cloud') AS name")).rows[0].name, null);
  // Corruption belongs to a disposable test DB; never alter published migrations.
  await empty.pool.query("CREATE SCHEMA gp_cloud; CREATE TABLE gp_cloud.schema_migrations(version integer, checksum text); INSERT INTO gp_cloud.schema_migrations VALUES(1,'synthetic-mismatch')");
  await assert.rejects(checkDeployment(emptyEnv, 'before-migrations', true), {stage:'migration-checksums'});
  await f.db.pool.query('CREATE ROLE anon; GRANT USAGE ON SCHEMA gp_cloud TO anon');
  try { await assert.rejects(checkDeployment(env, 'ready', true), {stage:'schema-exposure'}); }
  finally { await f.db.pool.query('REVOKE USAGE ON SCHEMA gp_cloud FROM anon'); }
  assert.deepEqual(await f.snapshot(tables), before);
  assert.deepEqual(storage.counts, {puts:0,reads:0,deletes:0});
  const cli = await f.cli('dist/cloud/deployment-check-cli.js', ['--ready','--local-test']);
  assert.equal(cli.code, 0);
  assert.equal(JSON.parse(cli.output).renderHttpsWorkflow, 'NOT RUN');
  assert(!cli.output.includes(connectionString));
  assert(!cli.output.includes(storage.env.SUPABASE_SERVICE_ROLE_KEY));
});
