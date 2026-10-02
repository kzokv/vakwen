# Reauthorization implementation evidence

## Scope and baseline

Source of truth: approved fix-plan.md and 2026-10-02 implementation handoff.
Current checkout requested by user: research/kzo-244-v1-acceptance-evidence at 5d4334c77af1ca37ca80f705c17ce95c7fa1c7cb.
Remote dev verified using authenticated GitHub API: b664a9494a9cef9fe5513ba6bc1a6ef944fca13f. SSH lookup failed host-key verification; GitHub API succeeded. Relevant OAuth/persistence/consent/settings source matches pinned production baseline.
No live orphan dev/test processes or child-agent sessions found during preflight. Existing unrelated edits preserved. Previous team state archived locally. No mockup path supplied; existing UI patterns apply.

## Authorized post-team work

User extended the goal: main agent inspects team output and resolves remaining gaps; runs /si-review and /si-promote for durable lessons only; rebases onto latest dev; runs and passes all eight required repo gates before PR readiness; creates clean commits; opens PR to dev assigned @kzokv with appropriate labels/body and Linear waiver if no ticket; posts @codex review after each push; monitors Codex review feedback and CI jobs; fixes review feedback and CI failures, replies with details, and resolves addressed threads in parallel with CI monitoring; waits for green CI and fixes failures. Team agents remain prohibited from committing/pushing/opening PRs/deploying. Deployment remains unauthorized.

## Verified focused evidence

These checks include the team implementation and focused integrated validation, not final release readiness. Local logs below are machine-local evidence; copy sanitized summaries into final PR evidence after the final gates.

- [x] Memory OAuth/MCP lifecycle matrix for both ChatGPT and Claude.ai: independent A/B creation and refresh, selected replacement, scope/client isolation, cap/concurrency, stale/foreign targets, cancellation/expired code, precommit failure, postcommit retry safety, label/profile stability and authorization pause. Named tests: `apps/api/test/integration/mcp-oauth.integration.test.ts`, `independent OAuth regression` groups. Latest inspected focused result: **58 passed, 40 skipped**, `/private/tmp/vakwen-oauth-matrix5.log`. Skipped tests are not verified by this run; Postgres remains separate below.
- [x] Strict authenticated profile discovery/identity, trusted authentication-failure diagnostics, and request redaction: latest root focused run **17 passed across 3 files**, `/private/tmp/vakwen-root-final-focused.log` (3.20s). Invalid signatures/audience/client bindings do not write guessed user history; client-supplied correlation text is rejected in favor of server request IDs. This supersedes the earlier overlapping 11-test profile/diagnostics evidence without implying completion of every logging review.
- [x] OAuth request URL redaction helper: **5 passed**, `/private/tmp/vakwen-redaction-green.log`; structured OAuth metadata requires final review too. This helper result alone is not proof every log field is sanitized.
- [x] Frontend consent, capacity, explicit target selection, selected-only rename, mounted refresh state, diagnostic visibility and EN/zh-TW human-readable reasons. Component regressions in `apps/web/test/components/connectors/ChatGptConnectorAuthorizeClient.test.tsx` and `.../settings/AiConnectorsSettingsClient.test.tsx`; latest settings run **28 passed** after localization change. Earlier combined component/service run **44 passed**, documented in `.worklog/team/reauthorization-frontend.md`; do not sum overlapping runs.
- [x] Shared-library rebuild and direct web TypeScript check passed; `/private/tmp/vakwen-libs-build.log`, `/private/tmp/vakwen-frontend-typecheck.log`. Changed frontend lint passed. Config tests: **170 passed**, `/private/tmp/vakwen-config-tests.log`.
- [x] Current-source rebuild and focused local browser run: **15 passed with retries disabled** (53.7s), `/private/tmp/vakwen-reauthorization-e2e-complete.log`. Command: `npm run test:e2e:bypass:mem --prefix apps/web -- --grep 'consent:|independent settings:|settings refresh:|local real OAuth:' --retries=0 --reporter=list`. Fourteen cases cover desktop/mobile/tablet consent and settings with controlled API responses: both client labels/actions, explicit replacement, capacity, stale target recovery, cancellation, selected rename/revoke, keyboard operation, zh-TW, and refresh preserving the mounted editor and history filter.
- [x] The fifteenth browser case uses actual local browser consent and real API authorization/token/MCP/history endpoints, with a real ephemeral loopback callback receiver. It verifies ChatGPT A+B creation, A's existing-session access after B, cancelled replacement preserving A, independent refresh, selected A→C replacement, B/C access, A refresh rejection, C refresh, and exactly one replacement history link. It passed in **2.7s** within the combined run. This is local browser/API integration evidence; it does not establish hosted ChatGPT or Claude.ai acceptance.
- [x] Settled mobile/tablet detail-panel visual follow-up: **2 passed with retries disabled** (32.5s), `/private/tmp/vakwen-reauthorization-sheet-visual.log`. Added deterministic progress-bar disappearance and dialog viewport-bound checks; screenshot capture disables animation. Desktop consent, mobile zh-TW consent/rename, and settled tablet details were visually inspected. No tooltip controls exist on the changed surfaces; visible help, keyboard radio selection, rename focus, and Escape dismissal were checked.
- [x] Browser failure/fix ledger closed for the focused scope: `.worklog/team/reauthorization-qa-issues.md`. The final retry-free runs supersede the earlier 13-pass/1-flaky run affected by a concurrent API watcher restart. Durable local evidence is retained in `.worklog/team/evidence/reauthorization/`: 11 screenshots, `focused-15-pass.log`, and `settled-sheet-2-pass.log`. Real OAuth traces may contain ephemeral local credentials and are not included in that shareable screenshot/log set.

## Remaining verification and delivery gates

- [x] Final Standards and Spec review resolved memory/Postgres expiry and capacity parity, persisted consent bindings, profile effective-access ordering, structured OAuth URL logging, database exception classification, and retryable expiry completion. Focused integrated API tests passed; broad managed Postgres remains separately pending below.
- [ ] Final managed Postgres gate: integrated run passed 1,300 tests with 1 skip and one unrelated research-calendar fixture failure. OAuth, capacity/concurrency, rollback, and migration 123 preservation tests passed. The missing historical calendar was seeded in both stores; its parity test passed in the active full rerun, `/private/tmp/vakwen-integrated-postgres-final.log`. Final suite completion remains pending.
- [x] Renumbered the append-only migration to `123_independent_oauth_connections.sql` after latest dev migration 122 and updated its preservation regression. Final managed validation remains pending.
- [x] Focused clean browser rerun, settled screenshots, issue closure, and real local browser/API OAuth coverage completed as detailed above. The complete standard/OAuth E2E and API HTTP suites also passed as recorded below.
- [ ] Final root eight-suite gate on the final integrated revision, using the exact commands below. Existing in-progress/partial runs do not establish full pass.
- [ ] Dev hosted-client acceptance for ChatGPT and Claude.ai: independent creation, selected replacement, cancellation, refresh, remaining entries and profile recognition where supported. Requires separately authorized dev rollout/access; local browser mocks and memory/Postgres results cannot substitute.
- [ ] Root-only post-team integration, review/CI and PR workflow authorized by the later user instruction. Deployment remains unauthorized.

| Required suite | Exact repository command | Final status |
|---|---|---|
| Lint | `npx eslint .` | Passed: 0 errors, 46 warnings |
| Typecheck | `npm run typecheck` | Passed on rebased implementation |
| Web unit | `npm run test --prefix apps/web` | Passed: 746 + 639 passed, 2 skipped across two phases |
| API unit/memory integration | `npm run test --prefix apps/api` | Passed: 2,426 passed, 572 skipped |
| Managed Postgres | `npm run test:integration:full:host` | Pending |
| Standard E2E | `npm run test:e2e:bypass:mem --prefix apps/web` | Passed: 443 passed, 21 skipped, no retries |
| OAuth E2E | `npm run test:e2e:oauth:mem --prefix apps/web` | Passed: 121 passed, no retries |
| API HTTP | `npm run test:http --prefix apps/api` | Passed: 313 passed, 2 skipped; isolated API_PORT=4400 |

Use the container variant of managed Postgres only when running in Linux containers, as root policy requires. The API unit/memory suite does not replace managed Postgres.

## Operational boundaries

See [cutover and recovery](rollout-and-recovery.md). Pause new authorizations with `MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false` while retaining existing access and refresh; drain old writers before independent grants activate. Legacy action-less consent/codes fail closed. Do not revive historical grants, reset lifetimes, raise capacity, delete history, or blindly restore the previous unique index. Vakwen history changes cannot remove stale entries in hosted clients.

The initial diagnosis and red/control experiments in the [approved fix plan](fix-plan.md) are historical evidence of the defect. They are not implementation acceptance. A transaction commit may precede a lost response; preserve explicit replacement history and avoid promising preservation of the old grant after every client-visible failure.

## Integrated validation notes

The task-only commit was rebased onto dev `b664a9494a9cef9fe5513ba6bc1a6ef944fca13f` in an isolated worktree. Research alternative scopes and date formatting were preserved; the AI Connections glossary moved to [glossary.md](glossary.md) because dev has no CONTEXT.md. Focused integrated API validation passed 141 tests (58 Postgres cases skipped). The research consent fixture now supplies the required explicit create action. Initial worktree checks exposed a missing nested recharts dependency and sandbox-denied SSE listeners; copying the existing installed dependency and allowing loopback access resolved those environment failures. Logs: `/private/tmp/vakwen-integrated-{lint,typecheck-final,api-unit-final,http}.log`. Full remaining gates are pending.

Final requirement audit added a direct delegated-portfolio read followed by profile lookup in the same MCP session. The profile remains the authenticated user and differs from the owner profile; all six profile tests passed. The full API rerun passed 2,426 tests with 572 skips (`/private/tmp/vakwen-integrated-api-unit-audit.log`). Lint was rechecked; typecheck and the full managed Postgres rerun remain in progress before draft PR readiness.
