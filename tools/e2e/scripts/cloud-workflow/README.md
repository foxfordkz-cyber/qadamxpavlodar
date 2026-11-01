# One agreed cloud browser workflow

This runner is scoped to PR #39 comment 6554168897: task `9050ea3c-369b-4864-b30b-caede24c96f2`, initial assigned/version 3, one approved worker and one synthetic inspect report. It is not a general cloud seed or replay command.

`Start-Cloud-Workflow.cmd` prompts privately and passes four CLOUD_ACCEPTANCE variables only to the Node child. No credential file, browser storage state, trace, HAR or raw error context is saved. The launcher uses the existing local Node24 runtime. The checkout must be clean; the runner records exact Git SHA and helper hashes.

Worker start/photo/report and coordinator acceptance use browser controls. Viewer reads the new report/photo and baseline Outcomes in RU/KK at375/1280. Scoped GET checks are marked separately. The guard rejects all other business writes; native same-key CSRF retry is bounded. All sessions are logged out, with an explicitly labelled API cleanup fallback on failure.

Run only after owner agreement and with deployed frontend/backend frozen. The one-run lock under `test-results/cloud-workflow-2026-11-01` prevents accidental recreation. If a run fails after a mutation, inspect saved IDs/versions and continue only the unfinished phase; never rerun create blindly. The task's scheduled slot is not modified.

Linked inspection creation, explicit403/idempotency segments and same-SHA restart/redeploy require separate agreement. This phase reads existing Outcomes and must not claim a new linked inspection or restart persistence. Preserve original failures and review screenshots before publication.

Offline guard checks: `node --test scripts/cloud-workflow/network-guard.offline-test.mjs` from tools/e2e. These tests never call the cloud.
