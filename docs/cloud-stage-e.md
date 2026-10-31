# Stage E — isolated follow-up to Draft #39

Branch `codex/bekzat-cloud-api-stage-e` starts at `a72131df86272804f95d8331d0f627e62272b3ea`.
The dependency PR #39 is still Draft. A future follow-up should target its branch, not
coordinator, so review contains only Stage E changes. No Stage E PR was opened: the user
redirected work to release acceptance of #39. This implementation is preserved separately
and is excluded from the release candidate. Quality CI supports the prospective stacked target.
The fetched coordinator was `fdc6e756be99dc5ba3a7a48ca1df17c4bfbef5ef`: its changes since
the common base are QA evidence and onboarding translations, not these server routes.
No open competing backend PR or review instruction was found (open PRs: #35 and #39).
This records the audit, not a claim that the captain approved release.

## E1: geocode

`GET /api/v1/geocode?q=...` now uses the same attributed, checked-in OSM snapshot and
RU/KK search implementation as SQLite. Current zone names/centroids come from PostgreSQL,
not a request-time mock. No external API, invented coordinates or new migration.

- Existing `{data: GeoHit[], meta: {source, coverage}}` envelope. Each hit contains
  `kind`, `label`, `lng`, `lat`, optionally `bbox`/`zoneId`; no internal search keys.
- Session roles admin/coordinator/viewer; worker/foreman denied. GET needs no CSRF.
- Strict trimmed `q` length 1–100; at most 8 hits; deterministic ID source order and
  shared rank/label ordering. Empty match is `data: []`, not an invented place.
- Query text never enters SQL. Only public fields are selected. More than 10,000 zones
  returns explicit `503 GEOCODE_INDEX_LIMIT`; no silent truncation of zone coverage.
- Per process: 60 requests/account/minute and 600 total/minute, bounded in-memory state;
  `429 GEOCODE_RATE_LIMIT` with `Retry-After`. Multiple replicas need ingress limiting.
- Coverage remains the prototype district in central Pavlodar; this is not live geocoding.

Run from `apps/server` (no provider configuration is loaded):

```sh
npm run typecheck
npm run build
npm run openapi:cloud
node --import ./scripts/local-network-guard.mjs --import tsx --test tests/postgres/geocode.test.ts
npm test
npm run test:postgres
```

The native PostgreSQL HTTP test starts an isolated cluster with random credentials and a
separate SQLite server. It compares exact RU/KK/address/street/place/zone results, tests
query rejection and injection payloads, role boundaries, HTTP throttling, and persistence
after restarting both backend/database and repeating seed. No production credentials are used.

## Release boundary and remaining work

The live Render service remains on `3b14927def04b35bf97782eae6b550da276c779f`.
Stage E is **NOT provider-tested or deployed**. Existing B/C/D provider evidence remains
in [deployment readiness](cloud-deployment-readiness.md); local results are not cloud acceptance.
No provider migration, password change, service restart or redeploy is part of this branch.

Drawing, GIS import and care calendar are subsequent stages. Assistant/history/interpretation
need the captain/LLM owner's ownership agreement before persistence integration. Existing
LLM/RAG/weather/image work is not duplicated and no paid model calls are authorized.
Eight moderate dependency advisories remain the prior baseline, not a fresh security result.

Captain: review the dependency order (#39 first), decide merge/release and rollback before
changing the live service. Тәңірберді: retain error states/mock reserve and test the existing
API adapter against the accepted Stage E SHA. Айдана: independently repeat API acceptance.

## Preservation verification, 31 October 2026

Server typecheck/build PASS; generated OpenAPI 88 operations. E1 native PostgreSQL/SQLite
HTTP suite **6/6 PASS** (final run 128.3 s); linked Outcomes/native persistence suite
**12/12 PASS** (191.8 s); full backend/SQLite **105/105 PASS** (369.4 s), zero skips or
cancellations. The full PostgreSQL suite and new branch CI were NOT RUN before the release
priority changed. These results do not make geocode part of the live release.
