import { build } from 'esbuild';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const tests = readdirSync('tests').filter(name => name.endsWith('.test.ts'));
// Use Node's React renderer and the same React instance for components and hooks.
await build({ entryPoints: tests.map(name => `tests/${name}`), bundle: true, platform: 'node', format: 'esm', external: ['react', 'react-dom'], outdir: 'dist-tests', outExtension: { '.js': '.mjs' }, define: { 'import.meta.env': '{}' }, logLevel: 'warning' });
const result = spawnSync(process.execPath, ['--test', ...tests.map(name => `dist-tests/${name.replace(/\.ts$/, '.mjs')}`)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
