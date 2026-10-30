export const profiles = ['mock', 'api', 'smoke', 'screens', 'bugs'];
export const smokeFilter = 'opens without JavaScript errors|zone list, six tabs|assistant: budget answer|time machine: canopy grows|priorities: top ten';

export function selectRun(command = 'mock', args = []) {
  if (!['mock', 'api', 'smoke', 'screens'].includes(command)) throw new Error('Expected mock, api, smoke or screens');
  const knownBugs = args.includes('--known-bugs');
  if (knownBugs && !['mock', 'api'].includes(command)) throw new Error('--known-bugs applies to mock or api');
  const userArgs = args.filter(arg => arg !== '--known-bugs');
  const profile = command === 'mock' && knownBugs ? 'bugs' : command;
  const mode = command === 'api' ? 'api' : 'mock';
  // Keep API capture/report protections from playwright.config.ts in effect.
  if (mode === 'api' && userArgs.some(arg => /^(?:--trace|--reporter|--config|--output|--ui)(?:=|$)|^-c(?:=|$)/.test(arg))) {
    throw new Error('API capture/report overrides are disabled to protect credentials');
  }
  const preset = [];
  if (command === 'smoke' || command === 'screens') {
    if (userArgs.some(arg => /^(?:--grep|--grep-invert|-g)(?:=|$)/.test(arg))) throw new Error('Use mock for a custom grep selection');
    preset.push('--grep', command === 'smoke' ? smokeFilter : 'presentation screenshot');
    if (command === 'smoke' && !userArgs.some(arg => /^--project(?:=|$)/.test(arg))) preset.push('--project', 'desktop');
  }
  return { profile, mode, knownBugs, args: [...preset, ...userArgs],
    selection: userArgs.length || ['smoke', 'screens'].includes(command) ? 'subset' : 'full',
    executesTests: !userArgs.some(arg => ['--list', '--help', '-h'].includes(arg)) };
}
