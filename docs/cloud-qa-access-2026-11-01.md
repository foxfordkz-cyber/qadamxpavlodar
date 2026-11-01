# QA access and release gates — 1 November 2026

This handoff is for the existing synthetic DEMO only. It does not establish that
credentials are installed on Aidana's machine or that independent QA has passed.

## Current publication and baseline

- API: https://green-pavlodar-api.pages.dev/?source=api . Owner-confirmed frontend
  `c970264919de2f7a62d0e1ea8a28cc70c95a3864`, deployment
  `a26bd214-1c78-4a83-9536-74a35c85b49f`, frozen since 00:04 UTC+5.
- Backend: https://green-pavlodar-api-demo.onrender.com . Dashboard rechecked on 1 November: deployed
  `3b14927def04b35bf97782eae6b550da276c779f`, `dep-dbj223h42hec73bqnttg`.
  No backend deploy/restart in this pass. Readiness alone cannot attest a SHA.
- [Publication record](cloud-publication-handoff-2026-11-01.md).
- [Baseline manifest](evidence/cloud-pages-20261101/release-738f96b2.json): same
  existing records/hashes, historical traces/check summaries removed. No passwords,
  sessions or keys; this is not a new test result. Original remains in operator data.
- Site `site-osm-1568405606`; crew `13a40778-776f-46a6-93f9-c7f361bc1737`;
  worker `a1d3d1e8-d046-4511-bb48-ee5be5fc3905`.
- Accepted planting report `368df690-6894-4b67-9aab-2651a9c4fad9`, inspection report
  `32bf4fed-c476-4cf6-81f2-aec7813939bb`; cohort `release-738f96b2-cohort`.
- Existing extra task `9050ea3c-369b-4864-b30b-caede24c96f2` is crew-assigned,
  1 Nov 14:00–14:30 UTC+5; worker composition pending. Do not start/change it until
  Aidana agrees to that precise scenario. A new prefix does not isolate shared sites.

## Private process handoff

Required: `CLOUD_ACCEPTANCE_DEMO`, `CLOUD_ACCEPTANCE_ORIGIN`,
`CLOUD_ACCEPTANCE_BROWSER_ORIGIN`, `CLOUD_ACCEPTANCE_PASSWORD`.
The first is `1`; for Pages QA both origins are `https://green-pavlodar-api.pages.dev`.
The password is supplied only by the owner-approved secret store/process environment.
Do not paste it in command arguments, chat, GitHub, screenshots or traces.

**BLOCKED:** no authorized destination/process path on Aidana's machine has been
identified. The operator has the variables; that is not delivery to QA. Aidana/owner
must identify the approved process secret store (name/path only). The operator can
then inject those four variables without exposing DB/Supabase keys. No account reset.

Run in the **actual QA process** from `apps/server` after secret injection:

```sh
node scripts/cloud-qa-access.mjs ../../docs/evidence/cloud-pages-20261101/release-738f96b2.json
```

The preflight checks four logins (coordinator, viewer, release-738f96b2-worker,
release-738f96b2-foreman), authenticated identity, seven unchanged baseline DTOs and
private WebP SHA-256. It only creates/revokes its own sessions; no task mutation,
seed, idempotent mutation replay, reset or restart. Output contains only result,
role/check counts and failure stage. A PASS proves access **only in that process**.

Operator-only execution with the existing ignored file:

```sh
node --env-file=.env.cloud-acceptance scripts/cloud-qa-access.mjs data/cloud-release-acceptance.json
```

Actual operator result at **08:48:57 UTC+5**: four role logins PASS, seven baseline
reads PASS, private photo hash PASS; sessions revoked. This run used direct Render,
not the new Pages browser, not Aidana's process. No previous browser result is
relabelled as acceptance of c970264.

At **09:02:32 UTC+5**, the same operator preflight also passed through production
Pages on c970264: four logins, seven baseline reads and private WebP hash; logout
completed. [Sanitized evidence](evidence/cloud-pages-20261101/operator-pages-access.json).
This is HTTP transport acceptance from the operator process, not browser E2E or Aidana QA.

The existing `cloud-https-acceptance.mjs verify` also sends POST/PATCH replay and
expected-denial checks. It is **not GET-only**. Coordinate its run separately.
The candidate runner now requires the candidate's schema version (v6); do not run it
against unchanged live v5. The scoped `cloud-qa-access.mjs` preflight above supports
the current baseline without applying migrations or requiring the new assistant.
Before/after a separately agreed restart, use the same manifest, photo hash, versions,
history/forecast and unknown/null values. Never seed/reset/recreate the baseline.

## Jury gate

Do not give organizers the acceptance password: the existing acceptance runner uses
it for admin as well as limited roles. Naming the viewer login does not restrict a
password also usable with admin. Existing team passwords must remain unchanged.

Jury access remains BLOCKED until captain identifies a private delivery destination
and evaluation period. Provision separate non-admin demo identities/credentials via
the existing admin API and approved secret store; verify their roles, login/logout
and duration before handing them over. No credentials are included in this document.
Jury instructions: open API production, sign in with assigned limited account,
view the synthetic accepted report/private photo and Outcomes; unknown is not zero,
forecast is not observed evidence; sign out. Mock is an independent training reserve.

## Assistant scope and provider gate

The deployed cloud `/assistant` and `/assistant/history` remain unsupported (503).
No LLM key was present in the inspected local cloud configuration. This says nothing
about validity of a provider key elsewhere. Real Gemini/Groq calls: NOT RUN.
No exposed key value was found in the visible user messages in this pass; historical
or external disclosures cannot be ruled out. If an actual key was pasted elsewhere,
its owner must revoke/replace that key privately; no credential rotation was performed.

The owner confirmed Damir's instruction to implement assistant in #39 during this run.
The candidate now has the PostgreSQL data boundary, shared provider chain/rules and
per-user v6 history. See [candidate acceptance](cloud-assistant-acceptance-2026-11-01.md)
and [transport/DTO contract](cloud-api-contract.md). It is not deployed or independently
accepted. Live Render still runs v5 on 3b14927; no environment/deploy changes were made.
The Render environment was inspected by variable name only: no LLM_API_KEY,
LLM2_API_KEY, LLM3_API_KEY or CLOUD_LLM_ENABLED; no linked environment group.
Do not create paid provider accounts or send test prompts without approved credentials.

Development approval does not authorize deployment. Captain approval and an explicit
QA window are still required; do not restart the shared DEMO during active QA.
