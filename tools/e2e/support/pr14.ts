import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Pinned reviewed feature history, not a UI-presence probe: a later regression must fail.
// With a squash/cherry-pick integration, review and update these IDs explicitly.
const root = fileURLToPath(new URL('../../../', import.meta.url));
function integrated(commit: string) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  // A fresh single-branch clone need not have the unmerged PR object.
  const object = spawnSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, windowsHide: true });
  if (object.status === 128) return false;
  throw new Error('Cannot determine PR #14 integration; fetch origin and inspect Git history');
}
export const pr14LanguageIntegrated = integrated('ad04b1c74fa43afd10765e5c800fbe10d81b7abf');
export const pr14HeaderIntegrated = integrated('afdd003f313ae0be861b8406da3afba5242d92cc');
export const pr14Pending = 'DEP-14: PR #14 is not integrated in the tested Git history; prepared scenario, not a confirmed pass. See PR14-CHECKLIST.md.';
