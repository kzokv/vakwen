# Reauthorization implementation evidence

## Scope and baseline

Source of truth: approved fix-plan.md and 2026-10-02 implementation handoff.
Original checkout requested by user: research/kzo-244-v1-acceptance-evidence at 5d4334c77af1ca37ca80f705c17ce95c7fa1c7cb.
Remote dev verified using authenticated GitHub API: b664a9494a9cef9fe5513ba6bc1a6ef944fca13f. SSH lookup failed host-key verification; GitHub API succeeded. Relevant OAuth/persistence/consent/settings source matches pinned production baseline.
Integration branch: `fix/independent-oauth-connections`, rebased onto the dev revision above. Final delivery evidence, current CI, and review resolution are recorded in [PR #305](https://github.com/kzokv/vakwen/pull/305).

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

## Repository gates and delivery evidence

All eight exact repository gates passed on integrated revision `fb656725`, before the final Codex expiry review fix. The table records that completed baseline. The final review-fix reruns and their terminal results are recorded in [PR #305](https://github.com/kzokv/vakwen/pull/305); readiness requires all eight gates, addressed review feedback, and green CI on the delivered revision.

| Required suite | Exact repository command | Completed baseline result |
|---|---|---|
| Lint | `npx eslint .` | 0 errors, 46 warnings |
| Typecheck | `npm run typecheck` | Passed |
| Web unit | `npm run test --prefix apps/web` | 746 + 639 passed, 2 skipped across two phases |
| API unit/memory integration | `npm run test --prefix apps/api` | 2,426 passed, 572 skipped |
| Managed Postgres | `npm run test:integration:full:host` | 1,302 passed, 1 skipped |
| Standard E2E | `npm run test:e2e:bypass:mem --prefix apps/web` | 443 passed, 21 skipped, no retries |
| OAuth E2E | `npm run test:e2e:oauth:mem --prefix apps/web` | 121 passed, no retries |
| API HTTP | `npm run test:http --prefix apps/api` | 313 passed, 2 skipped; isolated API_PORT=4400 |

Use the container variant of managed Postgres only when running in Linux containers, as root policy requires. The API unit/memory suite does not replace managed Postgres. Skipped tests are not claimed as passing coverage.

The first integrated managed run exposed a missing historical calendar fixture in the research monthly-revenue parity test. Seeding the historical calendar through the normal preview/confirm services in both stores resolved it. The full rerun completed successfully (`/private/tmp/vakwen-integrated-postgres-final.log`). Migration 123 preservation, rerun safety, bearer constraints, and OAuth concurrency/rollback cases are included in the managed suite.

## Review follow-through

Standards and specification review resolved expiry/capacity parity, persisted consent bindings, profile effective-access ordering, structured OAuth URL logging, database exception classification, and direct delegated-portfolio profile identity. Durable lessons were reviewed and promoted only as two scoped MCP rules, with memory pointers.

Codex identified a further race in expiry processing: concurrent requests could duplicate terminal audit/notification effects, and stale saves could clear the completion marker. The fix finalizes expiry, credential revocation, audit, notification, and marker under one memory user lock or PostgreSQL transaction. Generic saves retain a committed marker. Event publication occurs after commit; a delivery failure cannot repeat durable effects. Finalization rechecks the current expiry policy, so an administrator's lifetime-policy change cannot be overridden by a stale inactivity decision.

The new regression reproduced duplicate-finalization exposure in both OAuth client groups before the fix. A separate stale-policy regression failed for both clients before its guard. Thirty focused memory cases now pass: concurrent expiry and stale saves; audit and notification failure rollback/retry; postcommit event failure; current-policy revalidation; persisted bearer-credential expiry without affecting an unrelated OAuth connection; and implicit expiry during save/activation, including notification-failure rollback; and hiding abandoned pending grants without active-expiry effects. The full API gate caught a bearer expiry regression introduced by the policy guard; fresh bound-credential eligibility restores the existing lifecycle, and the original bearer regression passes. A second Codex finding identified status-only expiry while freeing capacity. Both stores now reuse atomic terminal finalization during save and OAuth activation; the regression verifies completion without ever presenting the old credential. These same cases run against real PostgreSQL, including database-trigger fault injection, in the managed gate. A third review finding concerned hidden, abandoned pending consents: metadata saves now preserve their stored pending state while reads continue to show expired history. The regression failed before the fix for both clients and passes afterward. A fourth finding covered missing live notification events for implicit expiry. Both stores now deliver the committed notification IDs after the outer operation commits and releases its lock/client. Regressions verify exact SSE payloads, rollback silence, single-client PostgreSQL pool reentry, and durable success when delivery fails. Final managed results are in the PR evidence.

A fifth Codex finding identified persistence-only fields in consent replacement candidates. Consent and settings now share an explicit public connection DTO projection. The real consent-response regression failed before the fix for both OAuth clients and passes afterward; it checks the serialized key allowlist and preserves the identifying context needed for selection.

A full browser run exposed a readiness assertion that failed immediately when reload briefly produced two shell markers. The shared E2E wait now retries until each marker has exactly one match, while persistent duplicates still fail. Five repetitions each of the theme reload and mobile settings navigation cases passed with retries disabled (10 passed, 5 viewport skips).

A subsequent responsive-flow retry showed the test helper waiting only for server-rendered shell markup before clicking a client router control. Responsive navigation now uses the existing client-readiness wait while retaining its deliberate omission of breadcrumb visibility. Five repetitions of the affected mobile settings and mobile/tablet account-setup flows passed without retries (15 passed, 5 viewport skips).

The root agent owns clean commits, PR metadata, review requests after each push, detailed review replies/thread resolution, and CI monitoring. PR #305 targets dev, is assigned to @kzokv, and uses bug/documentation plus the authorized Linear waiver. Its live state is the delivery record rather than a frozen claim in this document.

## Separate rollout gate

- [ ] Dev hosted-client acceptance for ChatGPT and Claude.ai: independent creation, selected replacement, cancellation, refresh, remaining entries, and profile recognition where supported. This requires separately authorized rollout/access. Local browser and memory/Postgres results do not establish hosted-client recognition or routing behavior.

## Operational boundaries

See [cutover and recovery](rollout-and-recovery.md). Pause new authorizations with `MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false` while retaining existing access and refresh; drain old writers before independent grants activate. Legacy action-less consent/codes fail closed. Do not revive historical grants, reset lifetimes, raise capacity, delete history, or blindly restore the previous unique index. Vakwen history changes cannot remove stale entries in hosted clients.

The initial diagnosis and red/control experiments in the [approved fix plan](fix-plan.md) are historical evidence of the defect. They are not implementation acceptance. A transaction commit may precede a lost response; preserve explicit replacement history and avoid promising preservation of the old grant after every client-visible failure.

## Integrated validation notes

The task-only commit was rebased onto dev `b664a9494a9cef9fe5513ba6bc1a6ef944fca13f` in an isolated worktree. Research alternative scopes and date formatting were preserved; the AI Connections glossary moved to [glossary.md](glossary.md) because dev has no CONTEXT.md. Focused integrated API validation passed 141 tests (58 Postgres cases skipped). The research consent fixture now supplies the required explicit create action. Initial worktree checks exposed a missing nested recharts dependency and sandbox-denied SSE listeners; copying the existing installed dependency and allowing loopback access resolved those environment failures. Logs: `/private/tmp/vakwen-integrated-{lint,typecheck-final,api-unit-final,http}.log`. The completed baseline gate results are listed above; final review-fix evidence is recorded in PR #305.

Final requirement audit added a direct delegated-portfolio read followed by profile lookup in the same MCP session. The profile remains the authenticated user and differs from the owner profile; all six profile tests passed. The full API rerun passed 2,426 tests with 572 skips (`/private/tmp/vakwen-integrated-api-unit-audit.log`). Lint, typecheck, and the full managed Postgres rerun subsequently passed on the integrated baseline. The later atomic expiry fix has its own final validation record in PR #305.
