import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_SHA, QA_SHA, APPS_TREE, assertPinned, safeEnvironment, hash } from './guard.mjs';

// Prepared only. Execute after all browser work has finished; this is a local
// static build and does not publish, install packages, run tsc or edit app source.
assertPinned();
const ownDirectory = dirname(fileURLToPath(import.meta.url));
const git = args => execFileSync('git', args, { cwd: ownDirectory, encoding: 'utf8', windowsHide: true }).trim();
const repo = realpathSync(git(['rev-parse', '--show-toplevel']));
const web = join(repo, 'apps/web');
if (git(['rev-parse', `${APP_SHA}:apps`]) !== APPS_TREE ||
    git(['rev-parse', 'HEAD:tools/worker-demo']) !== '22569488f8e728ebb2971a1ddb3d48e58ac77f0f') throw new Error('Build inputs differ from accepted application');
const envNames = readdirSync(web).filter(name => name === '.env' || name.startsWith('.env.'));
if (envNames.some(name => name !== '.env.example')) throw new Error('Active web env file exists; values were not read');
const parent = realpathSync(ownDirectory), approvedParent = resolve(repo, 'tools/e2e/test-results/final84-public');
const output = resolve(parent, 'local-84d009e-dist');
if (parent !== approvedParent || dirname(output) !== approvedParent || !output.startsWith(repo + sep) || existsSync(output)) throw new Error('Output must be a new owned directory in the approved workspace');
mkdirSync(output);
const env = safeEnvironment();
for (const key of Object.keys(env)) if (/^VITE_/i.test(key)) delete env[key];
delete env.NODE_OPTIONS;
env.VITE_DATA_SOURCE = 'mock'; env.NODE_ENV = 'production';
const secretValues = Object.entries(process.env).filter(([key, value]) => /PASSWORD|SECRET|TOKEN|COOKIE|DATABASE_URL|SUPABASE|API_KEY|ACCESS_KEY/i.test(key) && value && value.length >= 4).map(([, value]) => value);
const sanitize = value => secretValues.reduce((text, secret) => text.split(secret).join('[redacted]'), value);
const args = [join(web, 'node_modules/vite/bin/vite.js'), 'build', '--configLoader', 'runner', '--outDir', output, '--emptyOutDir'];
const startedAt = new Date().toISOString();
// --emptyOutDir targets only the just-created, absolute, containment-checked path.
const built = spawnSync(process.execPath, args, { cwd: web, env, encoding: 'utf8', windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
writeFileSync(join(parent, 'local-84d009e-build.log'), sanitize((built.stdout ?? '') + (built.stderr ?? '')));
const files = [];
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Build output must not contain symbolic links');
    if (entry.isDirectory()) visit(path);
    else { const bytes = readFileSync(path); files.push({ path: relative(output, path).replaceAll('\\', '/'), bytes: bytes.length, sha256: hash(bytes) }); }
  }
}
visit(output); files.sort((a, b) => a.path.localeCompare(b.path));
let sourceStillClean = true;
try { assertPinned(); } catch { sourceStillClean = false; }
const manifest = {
  schema: 'green-pavlodar-independent-qa-mock-build-v1', manifestProvenance: 'independent-qa-build',
  frontendSha: APP_SHA, source: { sha: APP_SHA, qaSha: QA_SHA, appsTree: APPS_TREE,
    webTree: git(['rev-parse', 'HEAD:apps/web']), workerDemoTree: git(['rev-parse', 'HEAD:tools/worker-demo']) },
  startedAt, endedAt: new Date().toISOString(), testSHA: QA_SHA, applicationBase: APP_SHA, appsTree: APPS_TREE,
  dirty: !sourceStillClean, sourceStillClean, node: process.versions.node,
  vite: JSON.parse(readFileSync(join(web, 'node_modules/vite/package.json'), 'utf8')).version,
  envFileNamesOnly: envNames, activeWebEnvFiles: [],
  environment: { VITE_DATA_SOURCE: 'mock', NODE_ENV: 'production', inheritedViteVariablesRemoved: true, sensitiveVariablesRemoved: true, nodeOptionsRemoved: true },
  command: ['node', 'apps/web/node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner', '--outDir', relative(repo, output).replaceAll('\\', '/'), '--emptyOutDir'],
  outputDirectory: relative(repo, output).replaceAll('\\', '/'), outputWasNewAndTaskOwned: true,
  exitCode: built.status, signal: built.signal, errorName: built.error?.name ?? null,
  packageLockSha256: hash(readFileSync(join(web, 'package-lock.json'))), files,
  expectedStaticFileCount: 34, expectedStaticFileCountMatches: files.length === 34,
  scope: 'Independent QA static mock reference build from clean pinned inputs. Not a publisher manifest, publication or browser/API acceptance. No npm install, TypeScript build or app source edits.',
};
const raw = JSON.stringify(manifest, null, 2) + '\n';
writeFileSync(join(parent, 'local-84d009e-build-manifest.json'), raw);
const passed = built.status === 0 && sourceStillClean && files.length === 34;
console.log(JSON.stringify({ kind: 'independent-qa-build', frontendSha: APP_SHA, testSHA: QA_SHA,
  fileCount: files.length, passed, exitCode: built.status, manifestPath: 'local-84d009e-build-manifest.json', manifestSha256: hash(raw) }));
process.exitCode = passed ? 0 : 1;
