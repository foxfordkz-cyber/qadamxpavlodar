import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative, sep } from 'node:path';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { API_ROUTES, UPSTREAM_ORIGIN, BACKEND_SHA, CONTRACT_SHA, RUNTIME_COMPATIBILITY } from './pages-worker.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const require = createRequire(join(web, 'package.json'));
const { build } = require('esbuild');
const { zipSync, unzipSync } = require('fflate');
const { values } = parseArgs({ options: { 'public-origin': { type: 'string' }, out: { type: 'string' } } });
if (!values['public-origin'] || !values.out) throw Error('Usage: node cloudflare/build-api.mjs --public-origin https://<approved-api-project>.pages.dev --out <new-empty-output-directory>');
const publicUrl = new URL(values['public-origin']);
if (publicUrl.protocol !== 'https:' || publicUrl.origin !== values['public-origin'] || publicUrl.username || publicUrl.password ||
    publicUrl.origin === UPSTREAM_ORIGIN || publicUrl.hostname === 'green-pavlodar-mock.pages.dev')
  throw Error('Use the exact reviewed HTTPS API frontend origin, without a trailing slash. The independent mock is not a deployment target.');
const out = resolve(values.out);
const fromRoot = relative(root, out);
if (out === root || out === web || out.startsWith(web + sep) || fromRoot === 'cloudflare' || fromRoot.startsWith('cloudflare' + sep))
  throw Error('Output must not overwrite application/source directories.');
await mkdir(out, { recursive: true });
if ((await readdir(out)).length) throw Error('Output directory must be empty; no existing files are deleted.');
// Never load developer-specific Vite variables or accidentally bundle them.
for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  try { await lstat(join(web, name)); throw Error(`Remove or isolate apps/web/${name} before this deployment build.`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const env = { ...process.env, VITE_DATA_SOURCE: 'api' };
for (const name of Object.keys(env)) if (name.startsWith('VITE_') && name !== 'VITE_DATA_SOURCE') delete env[name];
function run(args, cwd = web) {
  const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`Build command failed (${result.status}).`);
}
const git = (...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw Error('Git source identity unavailable.');
  return result.stdout.trim();
};
const dist = join(out, 'dist');
run([require.resolve('typescript/bin/tsc'), '-b']);
run([join(dirname(require.resolve('vite/package.json')), 'bin/vite.js'), 'build', '--outDir', dist]);
await build({ stdin: {
  contents: `import {createPagesWorker} from './pages-worker.mjs'; export default createPagesWorker(${JSON.stringify(publicUrl.origin)});`,
  resolveDir: join(root, 'cloudflare'), sourcefile: 'pages-api-entry.mjs', loader: 'js',
}, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: join(dist, '_worker.js'), legalComments: 'none' });
await writeFile(join(dist, '_routes.json'), JSON.stringify(API_ROUTES, null, 2) + '\n');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(directory) {
  const result = [];
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else throw Error('Unexpected non-regular build output.');
  }
  return result;
}
const inputs = ['cloudflare/api-proxy.mjs', 'cloudflare/pages-worker.mjs', 'cloudflare/build-api.mjs', 'apps/web/package-lock.json'];
const entries = [], zipInput = {};
for (const path of await files(dist)) {
  const name = relative(dist, path).split(sep).join('/');
  const bytes = await readFile(path);
  entries.push({ path: name, bytes: bytes.length, sha256: digest(bytes) });
  zipInput[name] = [bytes, { mtime: new Date(1980, 0, 1), os: 3, attrs: 0o100644 << 16 }];
}
const zip = zipSync(zipInput, { level: 9 });
const unpacked = unzipSync(zip);
for (const entry of entries) if (digest(unpacked[entry.path]) !== entry.sha256) throw Error('ZIP roundtrip mismatch.');
const archive = 'green-pavlodar-api.zip';
await writeFile(join(out, archive), zip);
await writeFile(join(out, archive + '.sha256'), digest(zip) + '  ' + archive + '\n');
const manifest = {
  schema: 'green-pavlodar-pages-api-build-v1', frontendSourceSha: git('rev-parse', 'HEAD'),
  sourceDirty: Boolean(git('status', '--porcelain', '--untracked-files=all')),
  publicOrigin: publicUrl.origin, upstreamOrigin: UPSTREAM_ORIGIN, backendDeployedSha: BACKEND_SHA, contractSha: CONTRACT_SHA,
  node: process.version, dataSource: 'api', routes: API_ROUTES, runtimeCompatibility: RUNTIME_COMPATIBILITY,
  archive, archiveBytes: zip.length, archiveSha256: digest(zip),
  inputHashes: await Promise.all(inputs.map(async path => ({ path, sha256: digest(await readFile(join(root, path))) }))), entries,
  runtimeStatus: 'not-deployed', prerequisites: ['Exact publicOrigin must be allowlisted by backend before login.',
    'Set runtimeCompatibility date and listed flags (none when empty) in Pages Settings > Runtime; ZIP does not configure them.',
    'Set Pages Functions fail-open/closed mode to fail closed.', 'Upload only to the separate API Pages project.'],
};
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output: out, archive, files: entries.length, sha256: digest(zip), publicOrigin: publicUrl.origin, sourceDirty: manifest.sourceDirty }));
