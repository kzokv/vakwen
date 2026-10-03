# OAuth-only main port: implementation evidence

## Goal and pinned revisions

Preserve all independent OAuth behavior while excluding KZO-234 research implementations.

- Base: `origin/main` at `28fa1b7380545ee340e7282dee4213609b3c5f4c`, verified through GitHub on 2026-10-03.
- Source: `fix/independent-oauth-connections` at `4a79b832a0ec894d98eafd5043aebc1b69d0f849`.
- Source feature boundary: `b664a9494a9cef9fe5513ba6bc1a6ef944fca13f` (the source branch's dev ancestor).
- Destination: `fix/independent-oauth-main`, isolated worktree `/private/tmp/vakwen-independent-oauth-port`.
- Existing branches and uncommitted work are preserved. This is a selective patch port, not whole-file copying or a merge of dev.

## Change mapping

| Source commit | Disposition |
| --- | --- |
| `67cc646d` | Port independent grants, selected replacement, profile, diagnostics, UI, tests and operational guidance; omit the research consent fixture edit. |
| `fb656725` | Exclude: research persistence/calendar fixture only. |
| `81946d44` | Port atomic connector expiry. |
| `33524f4a` | Port implicit expiry terminal effects. |
| `e086ca7c` | Port abandoned pending grant preservation. |
| `02d80537` | Port committed implicit expiry event publication. |
| `f4e1738b` | Port public consent-candidate DTO projection. |
| `18e68c60`, `51cdbe8a` | Port deterministic shell readiness fixes used by E2E journeys. |
| `4a79b832` | Port scope-free profiles for restricted bearer tokens. |
| `c04c66a1`, `b7696b0f`, `0c7f00a1`, `b664a949` | Exclude dev's research authorization, identity, price series and monthly revenue implementations. |

## Main compatibility resolutions

Nine files required manual resolution:

- `apps/api/README.md`: retain only OAuth lifecycle documentation.
- `apps/api/src/mcp/openAiAppsAdapter.ts`: add scope-free profile metadata while retaining main's single-scope security schemes.
- `apps/api/src/mcp/policy.ts`: add authenticated profile exception; preserve main's existing data-tool authorization.
- `apps/api/src/mcp/registerMcpRoutes.ts`: use main's direct tool scope for data-tool challenges; profile challenges omit scope. Add only OAuth/profile imports.
- `apps/api/src/mcp/tools.ts`: add strict profile schema without research tool output-schema branches; extend the declared output-schema union to include the strict profile schema.
- `apps/api/src/routes/registerRoutes.ts`: adapt profile availability to main's single-group catalog; preserve scopes on label-only updates without research grant rules.
- `apps/api/test/integration/mcp-oauth.integration.test.ts`: retain required mock and rate-limit reset imports without research-specific baseline tests.
- `apps/api/test/integration/mcp.integration.test.ts`: expect profile's empty scope list while retaining single-scope assertions for other tools.
- `apps/web/components/settings/AiConnectorsSettingsClient.tsx`: retain main's date formatting and add replacement history/localized reasons.

No research tools, service modules, scopes, environment settings, workers, or migrations are part of the port. Test connection labels containing the word “research” are arbitrary user labels, not research capabilities.

## Migration and recovery

Retain `123_independent_oauth_connections.sql` unchanged rather than renumbering it to 115, which is already allocated on dev. Main's latest numbered migration is 114. The migration runner discovers existing filenames, sorts them, and records each filename; it does not require contiguous numbers. The OAuth migration uses tables and columns already present on main and does not require research migrations 115–122.

Verified database evidence: fresh migration, upgrade from main, rerun safety, preservation of existing grants/labels/scopes/credentials/expiry/revocation, OAuth multiplicity, bearer uniqueness, capacity/concurrency, and transaction failure behavior. The migration-specific preservation test applies migration 123 twice and checks active, revoked, and historical expired records.

Recovery requires compatible application code or forward repair. Do not restore broad replacement behavior or the old uniqueness index after independent grants exist. See [cutover and recovery](rollout-and-recovery.md).

## Validation record

Baseline and port results must be recorded separately. Historical results from the source branch/PR #305 do not establish this port's correctness.

All eight required port gates passed on 2026-10-03. No automated regressions were observed after the two baseline fixture repairs. Live hosted-client acceptance remains pending. The tested candidate was captured before commit; the base SHA alone does not identify its built content. Use the PR head revision for deployment and record its build identifier. PR creation and the Linear naming waiver were subsequently authorized by the user; manual deployment and live acceptance remain user-owned.

Logs and command/result records: `/private/tmp/vakwen-oauth-validation/`. The final candidate patch, per-file hashes, and patch SHA-256 are recorded there in `oauth-main.patch` and `final-manifest.json`.

| Suite | Main baseline | Port |
| --- | --- | --- |
| `npx eslint .` | Passed | Passed |
| `npm run typecheck` | Passed | Passed |
| `npm run test --prefix apps/web` | Passed: 1,371 tests | Passed: 1,380 tests |
| `npm run test --prefix apps/api` | Failed: existing fixture clock issue (2,202 passed) | Passed: 2,308 tests |
| `npm run test:integration:full:host` | Passed: 1,154 tests | Passed: 1,340 tests |
| `npm run test:e2e:bypass:mem --prefix apps/web` | Failed: existing past-payment fixture (427 passed, 21 skipped) | Passed: 443 tests, 21 skipped |
| `npm run test:e2e:oauth:mem --prefix apps/web` | Passed: 121 tests | Passed: 121 tests |
| `npm run test:http --prefix apps/api` | Passed: 312 tests | Passed: 312 tests, 2 skipped |

Lint finished with zero errors and 46 existing warnings, matching baseline; it was repeated after the browser fixture change. Both full browser commands rebuilt the web app and completed its TypeScript check. Configured skips remain: web unit 2, API package 599 (including database-only cases covered separately), managed Postgres 1, standard E2E 21, HTTP 2. No assertions were removed and no test timeout was increased.

Focused candidate checks passed: 169 API tests (88 Postgres cases reserved for the managed gate), 43 connector UI tests, 73 configuration tests, and 22 ticker-detail tests. A control run restoring the original label-only scope filtering failed both client rename tests; restoring the port behavior passed. Scope audit found no research runtime symbols and confirmed migration 123 is byte-identical to the source. The final scope contains 57 files: 54 from the source feature delta plus the three exceptions documented below. Two research-only source test files were excluded. Main remained at the pinned revision when rechecked after the integration run.

Targeted regression coverage includes create B preserving A, replace A preserving B, cancelled/expired consent, stale/foreign targets, grant caps, simultaneous exchanges, refresh rotation, revocation, expiry, immutable lifetime, scope-preserving rename, stable profiles, delegated-context isolation, bearer restrictions, and public DTO boundaries.

Test-only baseline exception: `apps/api/test/unit/tickerDetails.test.ts` uses August/September 2026 upcoming-dividend fixtures but previously read the real clock. The untouched main baseline fails on 2026-10-03. Pinning its existing `now` input to 2026-06-18 restores its intended 50-row pagination coverage without changing product code or assertions.

Browser baseline exception: `apps/web/tests/e2e/specs/dividends-ui-ux-aaa.spec.ts` expected an Upcoming dashboard row with a July 31, 2026 payment date. Both baseline attempts fail on October 3 because the payment is past. Use a valid pending-payment (`null`) fixture while keeping all journey assertions intact; no dividend product code changes. Ten repetitions with retries disabled passed (50 matching desktop/mobile/tablet checks).

Additional requested documentation: `manual-live-acceptance.md` is outside the original touched-file list and supplies the user-requested deployment/live acceptance instructions.

## Live acceptance and authorization

Live ChatGPT and Claude acceptance is pending and user-owned: the user will deploy manually and execute the [manual acceptance checklist](manual-live-acceptance.md). Automated mocks and local browser tests do not establish external client routing/profile recognition. For each client, verify independent creation, selected replacement, reconnect/profile identity, and existing grant usability on an existing isolated test deployment.

The user authorized local implementation, validation, and PR creation using the Linear naming waiver. New infrastructure, shared deployment changes, merging, and production deployment require separate approval. Historical approval language in the source fix plan does not expand this task's authorization.
