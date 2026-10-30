# Safe correction of historical OSM zone names

This is opt-in offline maintenance, not a startup migration. Do not run against another person's database or the real gp-data volume without its owner's approval and a reviewed backup/restore plan.

## Provenance and scope

The name-only diff of fixtures/osm/sites.json at cf07b97 and b53c180 contains 114 known OSM IDs. The frozen manifest records every exact old/new pair. All non-name fields in those fixture versions are identical. Example: site-osm-1569993037, "Газон у улица Толстого" → "Газон, улица Толстого".

seed:tz uses ON CONFLICT DO NOTHING. Updating the fixture and repeating seed leaves old persisted names unchanged; this is reproduced in the migration tests. Canonical V2 site documents override the older municipal seed snapshot when APIs read zones. This command only changes canonical site names, not immutable seed snapshots, historical reports or design revisions.

A known ID AND the exact old name must match. Already corrected names, unknown IDs, and user renames are untouched. The command uses the existing sitePatch / patchData path: version +1, updatedAt, full before/after history attributed to an active admin/coordinator. It does not change IDs, geometry, checks, analytical inputs or references. Existing design snapshots intentionally keep their original siteVersion; normal workflow stale-version validation still applies.

## Operator procedure (after approval)

Use the same approved release source/image as the database. Schema 5 is supported here; schema 6 requires the release containing PR #23's Store implementation. No schema downgrade or reset is performed.

1. Stop the server and other database writers. Keep them stopped until verification finishes. Select the exact existing SQLite path. Do not use the developer's private test paths.
2. From apps/server, review the read-only plan:

   node --import tsx src/maintenance/zone-names-cli.ts --db /approved/path/app.sqlite

   It outputs only proposed names/IDs/versions and a plan hash. It never reads or prints passwords/sessions. Zero changes means no correction is needed.
3. Obtain an existing active admin/coordinator user ID through the normal administrator workflow. Choose a NEW backup file in a private existing directory. Apply only the reviewed plan:

   node --import tsx src/maintenance/zone-names-cli.ts --db /approved/path/app.sqlite --apply --actor USER_ID --plan-hash REVIEWED_HASH --backup /private/backups/before-zone-names.sqlite

   The CLI requires an existing database and a fresh backup path. SQLite's backup API includes committed WAL data. The backup is verified with integrity_check, foreign_key_check and the reviewed plan before any source update. Existing backup files/symlinks are refused. A failed backup may leave a partial backup file; keep it for diagnosis and choose a new path after resolving the failure.
4. Updates run in one BEGIN IMMEDIATE transaction. Any error or changed plan rolls the transaction back. Review the updated count/IDs; rerun dry-run: it should show zero changes. Restart the application and inspect the same sites through GET /api/v1/sites/:id.
5. Retain the backup privately. Restore only under the approved stopped-server procedure; never overwrite a live database or delete a volume. Uploads are untouched by this name-only operation.

The backup/plan check is not a substitute for stopping writers: unrelated changes made between backup and apply would not be represented in that backup.

## Verification

14 targeted tests pass: old-seed reproduction, exact old value, already-correct/user/unrelated preservation, IDs and all analytical fields, versions/history, repeat apply/seed, project/task/report snapshots, integrity/FKs, stale plan, permissions, transaction rollback, CLI dry-run/backup/reopen/idempotency. Fixtures are isolated temporary databases. No real gp-data or user databases were changed.

Run from apps/server:

    node --import ./scripts/local-network-guard.mjs --import ./tests/setup-env.mjs --import tsx --test tests/zone-names.test.ts


Fresh acceptance, 2026-10-30: targeted **14 passed / 0 failed / 0 skipped**;
full `npm test` in apps/server **79 passed / 0 failed / 0 skipped**; typecheck/build PASS.
The added CLI regression starts with all 114 old names and forces two backup failures
(existing destination and missing parent directory). The source database remains byte-identical;
site versions, the full history and the reviewed plan are unchanged; integrity/FKs remain valid.
No authentication or application routes were changed. GitHub #29 had no review comments at the check.
Ready means ready for code review, not permission to migrate user data. Captain must integrate
this PR and the latest #22 before repeating final integrated acceptance; this branch alone still
has the coordinator's schema-5 baseline. Re-run against the final schema-6 integrated release.
