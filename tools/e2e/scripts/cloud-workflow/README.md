# One agreed cloud browser workflow

This runner is scoped to PR #39 comment 6554168897: task `9050ea3c-369b-4864-b30b-caede24c96f2`, initial assigned/version 3, one approved worker and one synthetic inspect report. It is not a general cloud seed or replay command.

`Start-Cloud-Workflow.cmd` prompts privately and passes four CLOUD_ACCEPTANCE variables only to the Node child. No credential file, browser storage state, trace, HAR or raw error context is saved. The launcher uses the existing local Node24 runtime. The checkout must be clean; the runner records exact Git SHA and helper hashes.

Worker start/photo/report and coordinator acceptance use browser controls. Viewer reads the new report/photo and baseline Outcomes in RU/KK at375/1280. Scoped GET checks are marked separately. The guard rejects all other business writes; native same-key CSRF retry is bounded. All sessions are logged out, with an explicitly labelled API cleanup fallback on failure.

Run only after owner agreement and with deployed frontend/backend frozen. The one-run lock under `test-results/cloud-workflow-2026-11-01` prevents accidental recreation. If a run fails after a mutation, inspect saved IDs/versions and continue only the unfinished phase; never rerun create blindly. The task's scheduled slot is not modified.

Linked inspection creation, explicit403/idempotency segments and same-SHA restart/redeploy require separate agreement. This phase reads existing Outcomes and must not claim a new linked inspection or restart persistence. Preserve original failures and review screenshots before publication.

Offline guard checks: `node --test scripts/cloud-workflow/network-guard.offline-test.mjs` from tools/e2e. These tests never call the cloud.

## Exact continuation after the first attempt

Run636664e created report `6fabe731-ea10-410e-82e3-99f3ee1a911a` and photo `bcc645e2-ffef-40af-b05b-8abebf6600b5`, then stopped on an incorrect QA expectation that the empty navigation container disappears after logout. The application returned logout200 and auth/me401; the failed result is preserved. The corrected check matches the established signed-out contract: no identity, role, navigation links/buttons, cabinet or logout control, and an available login form.

`Start-Cloud-Review.cmd` invokes `--resume-review`: it pins that failed source record, validates the exact existing pending/version1 report and submitted/version5 task through GET, then performs coordinator acceptance and viewer checks. It never repeats worker start/upload/create. A separate lock prevents duplicate review attempts. Worker login/logout is checked again only as a read-only session regression.
