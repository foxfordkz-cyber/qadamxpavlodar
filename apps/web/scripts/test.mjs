import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = readdirSync('tests').filter(name => name.endsWith('.test.ts'));
await build({ entryPoints: tests.map(name => `tests/${name}`), bundle: true, platform: 'node', format: 'esm', outdir: 'dist-tests', outExtension: { '.js': '.mjs' }, define: { 'import.meta.env': '{}' }, logLevel: 'warning' });
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => `dist-tests/${name.replace(/\.ts$/, '.mjs')}`)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
