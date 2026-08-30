# Memory Index

## User
- [user_profile.md](user_profile.md) — Senior engineer, TWSE portfolio tracker, worktrees + scope-grill + /team + code-review-then-fix workflow, expects terse responses

## E2E / testing
- [project_e2e_aaa.md](project_e2e_aaa.md) — Durable AAA conventions — fixture roles, declarative spec shape, Vitest split criteria

## Auth / session
- [project_oauth_e2e_automation.md](project_oauth_e2e_automation.md) — OAuth e2e uses refresh token (local) or hardcoded sub (CI), no manual login; `npm run auth:refresh-token` to renew

## Project context
- [project_architecture.md](project_architecture.md) — Monorepo layout, tech stack, workspace structure, and core patterns
- [project_env_setup_cli.md](project_env_setup_cli.md) — env-setup CLI: file layout, 4 targets, CLI flags, integration points
- [project_libs_config_structure.md](project_libs_config_structure.md) — @vakwen/config exports, side-effect constraint, loadDotEnv behavior
- [project_infrastructure.md](project_infrastructure.md) — QNAP deployment via Cloudflare WARP+SSH, 3 Docker compose environments, CI Docker validation, AUTH_MODE constraint

## Frontend / product surface
- [project_web_app.md](project_web_app.md) — Next.js App Router pages, frontend feature modules, component organization, and service-layer patterns

## Database / API reference
- [project_db_schema.md](project_db_schema.md) — Pointer: read `docs/001-architecture/backend-db-api.md` + migrations; schema moves faster than memory snapshots
- [project_api_surface.md](project_api_surface.md) — Pointer: read `docs/001-architecture/backend-db-api.md` + `registerRoutes.ts`; route sets are authoritative

## Market data platform
- [project_market_data_progress.md](project_market_data_progress.md) — Pointer: Linear is authoritative for ticket state; this entry tracks only durable known-gaps (backup/restore, notification i18n sweep, legacy test drift)
- [project_market_data_architecture.md](project_market_data_architecture.md) — market_data schema, FinMind (TW/US) + Yahoo Finance AU, InstrumentCatalogProvider interface, search route, upsert strategy
- [project_instrument_type_nullability.md](project_instrument_type_nullability.md) — InstrumentType | null widening: each consumer needs its own guard; MemoryInstrument is separate type

## Frontend / dialog & palette patterns
- [project_dialog_submit_pattern.md](project_dialog_submit_pattern.md) — Dialog auto-close-on-success: submit hook must return `Promise<boolean>`; closing unconditionally hides state-reported validation errors
- [project_command_palette_initial_query.md](project_command_palette_initial_query.md) — ⌘K global open must clear `initialQuery` or a stale carried query from `openWithQuery()` leaks across opens

## Promoted to .claude/rules/ (ui-reshape-shadcn Phase 4, 2026-05-17)
- `shadcn-breadcrumb-sibling-structure.md` — BreadcrumbItem + BreadcrumbSeparator are siblings inside BreadcrumbList; nesting causes `<li> in <li>` hydration error. From admin-page hydration error during Phase 4 verification.
- `shadcn-sidebar-collapsed-brand-sizing.md` — Brand badges in SidebarHeader must mirror SidebarMenuButton's `!size-8 !p-2` collapsed pattern or clip the 48px rail. From cut-off V/A badge in collapsed AppSidebar.
- `single-dom-table-sticky-first-column.md` — `sticky left-0` must be on the visually leftmost column, not just "the important one". Codex caught DividendReview sticking col 2 over col 1 during horizontal scroll.
- `vitest-config-patterns.md` (addendum) — jsdom matchMedia stub in `test/setup/react-global.ts` required for components using `useIsMobile` / `useIsSmallScreen` / any matchMedia-backed hook. Tests exercise the wide branch only (matches: false default).

## Promoted to .claude/rules/ (ui-reshape-shadcn Phase 3 sweep, 2026-05-17)
- `account-shape-extension-checklist.md` — 4-file touch-point list (`shared-types/AccountDto`, `services/store.ts:67`, `persistence/postgres.ts` × 3 subsites, `types/store.ts`) + deterministic cash-entry-ID pattern. Promoted from `project_account_shape.md`.
- `team-wave2-transition-and-runbook-patterns.md` — `## Process notes` section + new-market-data-provider runbook section as mandatory Wave 2 deliverables. Promoted from `project_team_doc_patterns.md`.
- `playwright-page-object-testid-drift.md` (addendum) — 3 recurring trigger classes (surface relocation, shadcn-migration / primitive rename, profile-rewrite-delete); audit recipe via `git diff` of removed testids; pre-PR CR checklist additions. 2nd data point: post-3d UI sweep stale locators on `SettingsDrawerPage.ts:401-434`.

## Promoted to .claude/rules/ (KZO-198)
- `fastify-app-config-bootstrap.md` — onReady hook + eager pre-warm + resolver gates for TTL caches consumed during buildApp()
- `app-config-cache-coherency.md` — generation counter + PATCH-response bypass for TTL caches that back PATCH endpoints
- `env-setup-autogen-required-secrets.md` — register new required Env entries in autoGenerateKeys + shell-quote env values containing spaces
- `fastify-eviction-lifecycle-pattern.md` (addendum) — sweep parameter is admin-tunable; cadence stays env-default
- `vitest-config-patterns.md` (addendum) — Env-Proxy pattern for per-test mutation of frozen Env fields
- `cash-ledger-act-warnings-cosmetic.md` — pre-existing CashLedgerClient act() stderr is known-noisy; skip in PR review

## Promoted to .claude/rules/ (KZO-195)
- `capability-flag-polarity.md` — prefer positive capability flags over negation when gating provider/market behavior; two booleans, not tri-valued enums
- `test-placement-persistence-backend.md` (addendum) — MemoryPersistence dual-store mirror must be unconditional; admin-row stores are catalog-global by design
- `exit-check-non-regression-checklist.md` (addendum) — empirical validation: 5-point checklist held under cumulative pressure (4 distinct flakes); ≥2 data points is non-waivable except infrastructure-class
- `pr-bound-docs-review-compliance.md` (addendum) — structural-compliance brief to Technical Writer is mandatory regardless of CR plan; CR is defense-in-depth not the gate

## Promoted to .claude/rules/ (KZO-196)
- `i18n-flat-record-dict-settings.md` — `dict.settings` stays flat `Record<string, string>`; nested objects break indexed-access JSX narrowing
- `code-review-before-pr.md` (addendum) — type-augmentation `.d.ts` files must be explicitly included alongside new test files (`fastify.d.ts` 414-error cascade)
- `agent-team-workflow.md` (addendum) — lock testid strings in `architect-design.md` at Phase 0; original-agent-revival-during-respawn — park, don't kill; Architect ratification quotes rule strict-scope verbatim; Dispatcher state-rollback prevention on context expiry
- `team-respawn-verify-not-regenerate.md` (addendum) — park, don't kill SOP; KZO-196 validated convergence between revived original + respawn VERIFY pass
- `full-test-suite.md` (addendum) — stale `dist/` drift first-triage step before assuming a typecheck regression
- `shared-types-barrel-turbopack.md` (companion section, by Wave 2) — relative runtime-submodule re-export resolution failure under direct-source path alias
- `e2e-shared-memory-bars-ticker-hygiene.md` (addendum, by Wave 2) — `AUGICS*` ticker prefix reservation

## Promoted to .claude/rules/ (KZO-199)
- `playwright-navigation-patterns.md` (addendum) — Next.js `router.replace` is fire-and-forget; pair with `window.history.replaceState` for synchronous URL state in E2E `page.url()` assertions
- `fastify-eviction-lifecycle-pattern.md` (addendum) — client-facing values derived from live-tunable knobs (Retry-After header, error-envelope retryAfterMs) must use the live resolver, not Env.* — extends "schedule static, parameter live" to client-visible surface
- `validator-activation-gate.md` (occurrence 4 + new failure class) — Architect-side envelope drop: gate held correctly but upstream `[ARCHITECT:GO]` was never sent; mitigation = per-recipient SendMessage + Dispatcher gate-status surfacing

## Promoted to .claude/rules/ (ChatGPT MCP connector incident, 2026-05-27)
- `chatgpt-mcp-cloudflare-edge.md` — If approval succeeds but ChatGPT makes no `POST /oauth/token` or no `POST /mcp`, inspect Cloudflare edge/bot controls before changing OAuth token parsing. Plain Bot Fight Mode cannot be bypassed by WAF skip rules and must be off for ChatGPT MCP calls.

## Promoted to .claude/rules/ (ui-gap-refactor, 2026-05-30)
- `appshell-navigation-feedback-remount.md` — Shell-owned navigation feedback must survive page-level `AppShell` remounts; mirror pending destination outside the shell tree, restore briefly on the destination route, and cap pending state so failed navigations cannot leave stale dimming.

## Promoted to .claude/rules/ (MCP account tools scope, 2026-05-31)
- `mcp-tool-scope-extension-checklist.md` — New MCP tool families/scopes require shared DTO/scope types, OAuth/MCP metadata, lifecycle policy mapping, service auth, connector consent UI, ChatGPT Apps resources, and API/web/E2E tests in the same PR.
- 2026-08-28 addendum — Additive gated scopes require one rollout matrix across OAuth metadata/defaults, MCP discovery/challenges, consent, persisted grants, and reconnect/recreate behavior; partial-on gates and stored-grant rollback are mandatory test cases.

## Promoted to .claude/rules/ (MCP name-first delegation, 2026-06-16)
- `mcp-name-first-delegation-wrappers.md` — Model-facing delegated MCP write tools must use human selectors, keep internal IDs out of visible payloads, preserve low-level widget handlers as app-visible only, and require confirmation digests before commits.

## Promoted to .claude/rules/ (performance-smooth-pages, 2026-06-01)
- `smooth-page-performance-boundaries.md` — Authenticated page loads keep `AppShell` lightweight, route primary reads page-owned, enrichment deferred, hot reads instrumented, and portfolio-context reads based on `contextUserId`. Promoted from the deployed shared-portfolio performance incident.
- 2026-06-02 addendum — route-primary payloads may seed AppShell account/fee-profile config to avoid duplicate first-paint fetches, but seeded shell/route data and command/search indexes must refresh or clear on shared-owner context switches.

## Promoted to .claude/rules/ (dashboard-reporting-ui, 2026-06-08)
- `reporting-server-authoritative-dtos.md` — Formal report pages and MCP report tools must use server report DTOs as the accounting/currency boundary; client code formats and refreshes DTOs but does not reconstruct report accounting or chart series from raw transactions.
- 2026-06-08 addendum — dashboard/report summaries must not fall back to native amounts while labeling the value as the selected reporting currency; show limited/missing state until a reporting DTO field proves conversion.
- 2026-06-09 addendum — `route-dto-cache-user-context.md` — Authenticated route DTO cache keys must include both signed-in session user and selected portfolio context owner; clear caches on sign-out/session changes and bump schema version when key dimensions change.
- 2026-06-09 addendum — `user-preferences-key-extension.md` — New `user_preferences.preferences` keys require shared schema/DTO when cross-app, strict `userPreferencePatchSchema` extension, no migration for ordinary JSONB keys, full-object PATCH unless nested merge is implemented, and API/web preference tests.
- 2026-07-20 addendum — `user-preferences-key-extension.md` — Partial nested preference patches must deep-merge atomically in Memory and Postgres, preserve unmentioned/opaque siblings, define stale-key deletion for resets, and prove parity in both persistence backends.
- 2026-06-09 addendum — `market-data-composite-keys.md` — Report/dashboard market-data lookups must preserve `(ticker, marketCode)` identity for bars, quotes, freshness, and synthetic performance; bare-ticker collectors can mix cross-listed symbols.
- 2026-06-10 addendum — `route-enrichment-mutation-refresh.md` — Route enrichment endpoints are valid for mount/return hydration, but mutation refreshes that can change position/accounting summaries must use the authoritative full DTO or mutation-aware primary endpoint.
- 2026-06-12 addendum — `route-dto-cache-user-context.md` — Chart-capable App Router pages must pass server-parsed query params into client initial state so the first hydration request matches deep-linked range/custom date server HTML; `useSearchParams()` synchronizes later client-side navigation.
- 2026-06-10 addendum — `reporting-server-authoritative-dtos.md` — Dashboard/report trend and return charts are strict snapshot-only surfaces; missing/stale/partial snapshots must show truthful diagnostics and empty/gapped series, and scoped snapshot contributors must be market-qualified `(accountId, ticker, marketCode)`.
- 2026-06-11 addendum — `reporting-server-authoritative-dtos.md` — Formal trend DTOs with valid persisted snapshot aggregates must not null chart points only because replay-only dated finance FX is incomplete; use the snapshot aggregate and surface a diagnostic for the replay basis gap.
- 2026-06-11 addendum — `reporting-server-authoritative-dtos.md` — All-market formal trend DTOs must filter snapshot dates missing active `(accountId, marketCode, ticker)` contributors and surface missing/stale snapshot diagnostics instead of plotting partial all-market totals as complete.
- 2026-06-11 addendum — `reporting-server-authoritative-dtos.md` — Formal trend DTOs must expose server-resolved inclusive range bounds, and chart x-axes must render those bounds instead of inferring timelines from the first available snapshot point.
- 2026-06-12 addendum — `reporting-server-authoritative-dtos.md` — Reporting-currency FX for formal summaries/snapshot aggregates must resolve same/direct/inverse/TWD-pivot rates and batch snapshot-series FX by distinct `(snapshotDate, currency)` instead of requiring direct stored pairs or per-row lookups.
- 2026-06-14 addendum — `reporting-server-authoritative-dtos.md` — Valuation-health diagnostics must stay on overview/enrichment/report wrapper DTOs and use the UI's explained range/window; do not bloat formal performance routes with current quotes, dashboard summary rebuilds, or current-valuation payloads.
- 2026-06-11 addendum — `react-persisted-ui-settings-stability.md` — Persisted React UI settings hooks must use stable default arrays/objects and skip value-equivalent state writes; fresh defaults in dependencies can create render loops and slow client rendering.
- 2026-06-11 addendum — `e2e-aaa-guardrails.md` — Focused browser tests for configurable reporting/dashboard surfaces should assert stable controls, selected state, URL state, and honest empty/unavailable UI, not fixture-dependent populated charts/rows or user-preference-controlled optional columns.
- 2026-06-13 addendum — `mobile-holdings-column-settings.md` — Mobile Dashboard/Portfolio/Reports holdings cards must use holdings column settings as the source of truth for summary and Details; hidden configurable columns cannot leak through legacy hardcoded metric blocks or duplicate rows.

## Promoted to .claude/rules/ (KZO-197 review closure, 2026-06-03)
- `provider-registry-ui-coverage.md` — Provider registry/admin-provider changes must audit provider-keyed UI dictionaries and assert real content, not only trigger presence. Promoted from the KR resolver empty-popover review finding.

## Promoted to .claude/rules/ (KZO-197 final validation, 2026-06-05)
- `managed-postgres-integration-harness.md` — Host-mode `test:integration:full:host` connection failures must be triaged as managed harness/network-timeout issues before changing product behavior. Promoted from the KZO-197 Postgres/Redis integration stabilization.

## Promoted to .claude/rules/ (ui-enhancement, 2026-05-14)
- `agent-team-workflow.md` (addendum) — Architect (and Dispatcher) first-action-on-wake = re-poll inbox+TaskList+state.json, always; 5-stall canonical anti-pattern from ui-enhancement original architect; respawn with pre-baked triage is the canonical recovery
- `agent-team-workflow.md` (addendum) — Holistic audit pattern at 3rd-strike same-class findings; iter-5 audit caught 7 defensive sites including critical `listUserAccountIds` data-loss path that spot-fix-only would have missed

## KZO-192 — FX rollback test timestamps (one durable bullet)

- **Timestamp sensitivity for FX rollback tests (rule candidate — needs 2nd data point):** `latestSettledTradingDayPure` tests that expect rollback must trace `resolveFxSettlementCandidate(input)` first. Post-publish (`T18:00Z`) input → candidate = same day; rollback fires only if the CANDIDATE itself is an ECB holiday (AC #1 Good Friday is correct). Pre-cluster tests → use `T15:00Z` so candidate = prior Sunday → rolls back through the cluster. QA caught this in KZO-192 when scope-todo listed `T18:00Z` inputs for Christmas and NYD but the expected values required pre-publish timestamps.

(Other KZO-192 notes — FX calendar helper layout, branch split rationale, v1 limitation — moved to the transition note at `docs/004-notes/kzo-192/` and recoverable from there if needed.)

## Feedback & preferences
- [feedback_team_response_time_slas.md](feedback_team_response_time_slas.md) — `/team` Architect [TRIAGE] 5-min SLA + Validator [HEARTBEAT] during long suites — process refinements from KZO-185

## Promoted to .claude/rules/ (viewer-scoped owner portfolio settings, 2026-06-22)
- `playwright-dnd-kit-drag-readiness.md` — dnd-kit Playwright drag commands need a DOM-order or PATCH readiness signal before persisted-state assertions; use bounded retries for real pointer drags. Promoted after the transactions and portfolio card reorder specs hit the same missed-drop class.

## Promoted to .claude/rules/ (unrealized-pnl-ux, 2026-07-01)
- `additive-dto-mappers.md` — Client/service mappers for additive DTO fields must tolerate omitted fields unless the API contract makes them required, so one new optional payload field cannot throw a whole route into a stale fallback path.

## Promoted to .claude/rules/ (Dividends Review performance, 2026-07-13)
- `smooth-page-performance-boundaries.md` — Context-switch no-remount exceptions must be route-scoped to clients that consume the context refresh signal; unrelated server-seeded routes retain the global refresh fallback.
- `playwright-web-bundle-rebuild.md` — Concurrent agents in one worktree must serialize `.next` writers and production-bundle consumers; separate ports do not isolate shared build artifacts.

## Promoted to .claude/rules/ (Dividend page fixes, 2026-07-21)
- `route-dto-cache-user-context.md` — Context-specific metadata must disappear immediately during owner transitions and only return from an exact-current committed response.
- `playwright-navigation-patterns.md` — Exact response completion does not prove client commit; match the authoritative endpoint and request identity, then poll the committed URL/DOM outcome.

## Promoted to .claude/rules/ (configured portfolio capabilities, 2026-07-26)
- `account-capability-authority.md` — Active viewed-owner accounts are the capability authority; initiating mutation responses apply immediately, while buffered lifecycle events invalidate and refetch rather than replaying possibly stale payload state.
- `bounded-account-mutations.md` — Account create/update remain narrow atomic persistence operations, protected by structural tests and representative PostgreSQL benchmark artifacts rather than CI wall-clock assertions.
