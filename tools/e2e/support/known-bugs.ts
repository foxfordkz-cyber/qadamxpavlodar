/** Reproduce quarantined failures with npm run e2e:bugs. Remove fixme after upstream fixes. */
export const runKnownBugs = process.env.E2E_RUN_KNOWN_BUGS === '1';
export const bugs = {
  locale: 'E2E-01: ?lang=kk leaves Russian UI on a1aee4e; awaiting PR #14. See BUGS.md.',
  memo: 'E2E-02: zone report has no Word memo download on a1aee4e; awaiting PR #14. See BUGS.md.',
  worker: 'E2E-03: worker role does not route to #/worker or mount green-worker; PR #9/#3 pending. See BUGS.md.',
  nearest: 'E2E-04: after initial map load, “подбери растения здесь” says the place was not found; map center is not initialized. See BUGS.md.',
  importWidth: 'E2E-05: after PR #13, /import is 811px wide on a 375px viewport (dc6d56d). See BUGS.md.',
} as const;
