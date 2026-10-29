/** Reproduce quarantined failures with npm run e2e:bugs. Remove fixme after upstream fixes. */
export const runKnownBugs = process.env.E2E_RUN_KNOWN_BUGS === '1';
export const bugs = {
  locale: 'E2E-01: ?lang=kk leaves Russian UI; awaiting PR #14. See BUGS.md.',
  memo: 'E2E-02: zone report has no Word memo download; awaiting PR #14. See BUGS.md.',
  worker: 'E2E-03: worker role does not route to #/worker or mount green-worker; awaiting PR #9. See BUGS.md.',
} as const;
