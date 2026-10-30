import { build } from 'esbuild';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const coverage = process.argv.includes('--coverage');
const tests = readdirSync('tests').filter(name => name.endsWith('.test.ts')).sort();
// Use Node's React renderer and the same React instance for components and hooks.
// Coverage shares one module graph. Independent bundles/processes can overwrite
// source-map line counters when Node merges repeated copies of the same source.
await build({ entryPoints: tests.map(name => `tests/${name}`), bundle: true, splitting: coverage, platform: 'node', format: 'esm', external: ['react', 'react-dom'], packages: coverage ? 'external' : undefined, outdir: 'dist-tests', outExtension: { '.js': '.mjs' }, define: { 'import.meta.env': '{}' }, sourcemap: true, sourcesContent: true, logLevel: 'warning' });
const coverageDir = 'dist-tests/coverage';
if (coverage) {
  mkdirSync(coverageDir, { recursive: true });
  for (const name of ['lcov.info', 'summary.json']) rmSync(`${coverageDir}/${name}`, { force: true });
}
const flags = coverage ? ['--experimental-test-coverage', '--test-isolation=none', '--test-concurrency=1',
  // Include bundles for Node's first mapping pass, then only application TS/TSX sources.
  '--test-coverage-include=dist-tests/*.mjs', '--test-coverage-include=src/**/*.ts', '--test-coverage-include=src/**/*.tsx',
  '--test-coverage-exclude=tests/**', '--test-coverage-exclude=**/node_modules/**', '--test-coverage-exclude=**/fixtures/**',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  '--test-reporter=lcov', `--test-reporter-destination=${coverageDir}/lcov.info`,
] : [];
const result = spawnSync(process.execPath, ['--enable-source-maps', '--test', ...flags, ...tests.map(name => `dist-tests/${name.replace(/\.ts$/, '.mjs')}`)], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
if (coverage && result.status === 0) {
  const files = readFileSync(`${coverageDir}/lcov.info`, 'utf8').split('end_of_record').filter(record => /^SF:/m.test(record)).map(record => {
    const source = record.match(/^SF:(.*)$/m)[1].trim();
    const path = relative(resolve('src'), resolve(source));
    if (isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`) || !/\.tsx?$/.test(path))
      throw new Error(`Coverage was not mapped exclusively to application sources: ${source}`);
    const count = key => Number(record.match(new RegExp(`^${key}:(\\d+)$`, 'm'))?.[1] ?? 0);
    return { path: `src/${path.split(sep).join('/')}`, lines: [count('LH'), count('LF')],
      branches: [count('BRH'), count('BRF')], functions: [count('FNH'), count('FNF')] };
  });
  if (!files.length || new Set(files.map(f => f.path)).size !== files.length)
    throw new Error('Coverage source list is empty or contains duplicate files');
  const totals = Object.fromEntries(['lines', 'branches', 'functions'].map(key => {
    const covered = files.reduce((n, file) => n + file[key][0], 0), total = files.reduce((n, file) => n + file[key][1], 0);
    return [key, { covered, total, percent: total ? Number((100 * covered / total).toFixed(2)) : null }];
  }));
  const git = (...args) => spawnSync('git', args, { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const report = { measuredAt: new Date().toISOString(), node: process.version, commit: git('rev-parse', 'HEAD'),
    dirty: !!git('status', '--porcelain'), scope: 'Application TS/TSX sources reached by this Node test suite; not whole-project or browser coverage.',
    execution: 'Shared esbuild chunks, linked source maps, one sequential Node coverage process. Ordinary npm test keeps process isolation.',
    exclusions: ['tests', 'node_modules', 'fixtures', 'JSON assets', 'unloaded source files', 'ranges Node cannot map to a source'], totals, files };
  writeFileSync(`${coverageDir}/summary.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`Coverage: ${files.length} application files; lines ${totals.lines.percent}%, branches ${totals.branches.percent}%, functions ${totals.functions.percent}%. See ${coverageDir}/summary.json (no threshold).`);
}
