import { redact } from './environment.mjs';

const matchers = new Set(['toBe', 'toEqual', 'toStrictEqual', 'toMatchObject', 'toBeVisible', 'toBeHidden', 'toBeEnabled', 'toBeDisabled',
  'toHaveText', 'toContainText', 'toHaveCount', 'toHaveURL', 'toHaveAttribute', 'toHaveClass', 'toHaveValue', 'toBeChecked',
  'toBeGreaterThan', 'toBeGreaterThanOrEqual', 'toBeLessThan', 'toBeLessThanOrEqual', 'toBeCloseTo', 'toBeTruthy', 'toBeFalsy',
  'toBeNull', 'toBeDefined', 'toBeUndefined', 'toHaveLength', 'toContain']);
const sourceFile = /^(?:tests|support)\/[a-zA-Z0-9_.\/-]+\.(?:ts|mjs)$/;
const scalar = value => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
function location(file, line, column) {
  const normalized = String(file ?? '').replaceAll('\\', '/');
  const local = normalized.includes('/tools/e2e/') ? normalized.split('/tools/e2e/').at(-1) : normalized;
  if (!sourceFile.test(local) || local.includes('..') || !Number.isInteger(line) || line <= 0 || !Number.isInteger(column) || column <= 0) return undefined;
  return { file: local, line, column };
}

export function safeDiagnostic(value = {}) {
  const result = {};
  const loc = location(value.errorLocation?.file, value.errorLocation?.line, value.errorLocation?.column);
  if (loc) result.errorLocation = loc;
  if (matchers.has(value.matcher)) result.matcher = value.matcher;
  if (scalar(value.expected)) result.expected = value.expected;
  if (scalar(value.actual)) result.actual = value.actual;
  if (['>', '>=', '<', '<=', '!='].includes(value.expectedComparator)) result.expectedComparator = value.expectedComparator;
  return result;
}

export function errorDiagnostics(errors = [], secrets = []) {
  return errors.slice(0, 8).map(error => {
    // Parse known assertion syntax in memory, then discard the original text.
    const message = redact(error.message ?? '', secrets).replace(/\u001b\[[0-9;]*m/g, '');
    const stack = redact(error.stack ?? '', secrets).replaceAll('\\', '/');
    let errorLocation = location(redact(error.location?.file ?? '', secrets), error.location?.line, error.location?.column);
    if (!errorLocation) {
      const frame = stack.match(/(?:^|\/)tools\/e2e\/((?:tests|support)\/[a-zA-Z0-9_.\/-]+\.(?:ts|mjs)):(\d+):(\d+)/);
      if (frame) errorLocation = location(frame[1], Number(frame[2]), Number(frame[3]));
    }
    const result = { errorLocation, matcher: message.match(/\b(to[A-Z][a-zA-Z]+)\s*\(/)?.[1] };
    for (const [label, field] of [['Expected', 'expected'], ['Received', 'actual']]) {
      const found = message.match(new RegExp('^' + label + ':\\s*(?:(>=|<=|!=|>|<)\\s*)?(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?|true|false)\\s*$', 'mi'));
      if (!found) continue;
      const value = found[2] === 'true' ? true : found[2] === 'false' ? false : Number(found[2]);
      if (scalar(value)) result[field] = value;
      if (field === 'expected' && found[1]) result.expectedComparator = found[1];
    }
    return safeDiagnostic(result);
  }).filter(value => Object.keys(value).length);
}

export function diagnosticLabel(value) {
  const clean = safeDiagnostic(value), loc = clean.errorLocation;
  return [loc && `${loc.file}:${loc.line}:${loc.column}`, clean.matcher,
    'expected' in clean && `expected=${clean.expectedComparator ?? ''}${clean.expected}`,
    'actual' in clean && `actual=${clean.actual}`].filter(Boolean).join(' ');
}
