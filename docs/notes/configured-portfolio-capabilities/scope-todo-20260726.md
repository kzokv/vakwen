---
slug: configured-portfolio-capabilities
source: scope-grill
created: 2026-07-26
tickets: []
required_reading: []
superseded_by: null
---

# Todo: Configured Portfolio Capabilities and Account Settings

> **For agents starting a fresh session:** read all files listed in `required_reading` above before starting implementation.

## Locked Scope

1. Operational controls use configured markets and currencies; summary cards use markets containing relevant portfolio data.
2. Active accounts are the sole source of configured capabilities. Soft-deleted accounts and their history return to normal portfolio views only after restoration.
3. The server derives deduplicated `configuredMarkets` and `configuredCurrencies` in canonical `TW`, `US`, `AU`, `KR`, `JP` order for the portfolio owner being viewed.
4. Capability data is embedded in existing shell and route-primary DTOs rather than fetched from a separate endpoint.
5. Account creation continues to show every supported market and permits multiple accounts in the same market.
6. Account type remains descriptive. Every active broker, bank, or wallet account enables its mapped market and currency.
7. Single-option controls render static market/currency context. Zero-option portfolio pages render contextual account-setup gates.
8. Dashboard and dividend cards remain data-driven. A configured but empty market is available in operational controls without producing empty summary cards.
9. Missing or unavailable valuation does not make a held market unpopulated; show an unavailable value or diagnostic instead of hiding the market.
10. Stale market/currency URLs and saved selections normalize to `all` or the first configured capability, replace the URL, and display a dismissible explanation.
11. Deleting the final account for the selected reporting currency falls back to the first remaining configured currency. Zero accounts enter onboarding. Restoration does not automatically restore the old preference.
12. Shared views use the portfolio owner's capabilities. A viewer's stored reporting preference is preserved and receives a non-destructive effective fallback for that context.
13. FX requires at least two distinct configured currencies; otherwise it displays an enablement state linking to account creation.
14. Zero-account users receive a focused market-first onboarding flow. Existing users see the account list first and launch the same flow from a collapsed Add account action.
15. Account name, type, and default fee profile are persistently editable. Market/currency is fixed after creation in the standard UI.
16. Lifecycle mutations update the initiating client from authoritative response data. Existing lifecycle events invalidate narrow capability state in other tabs and authorized shared views.
17. Account create/update persistence is bounded and does not load or save unrelated portfolio history, market data, or configuration.
18. Account creation atomically creates the account and seeded default profile. Related preference fallback and audit writes remain consistent with their mutation.

## Implementation Steps

- [x] Add a shared `PortfolioCapabilitiesDto` containing canonical, deduplicated configured markets and currencies.
- [x] Add a single domain helper that derives capabilities from active accounts and cover ordering, deduplication, multiple-account, and zero-account cases.
- [x] Include portfolio-owner capabilities in shell configuration and relevant transaction, report, analysis, dividend, cash-ledger/FX, and settings primary DTOs.
- [x] Ensure shared-portfolio responses derive capabilities from the viewed owner rather than the session user's accounts.
- [x] Add route-state normalization that returns the effective selection and adjustment reason, replaces stale URLs, and exposes a dismissible notice.
- [x] Filter transaction-entry markets and transaction-history market filters to configured capabilities.
- [x] Filter report scopes and analysis market/reporting-currency controls to configured capabilities.
- [x] Filter dashboard quick-action and Display Settings reporting-currency choices to configured currencies.
- [x] Render static market/currency context when only one capability exists.
- [x] Preserve data-driven Dashboard and Dividend cards while ensuring holdings with missing valuation are not hidden as unpopulated.
- [x] Add a reusable zero-account setup gate to Dashboard, Transactions, Reports, Analysis, Dividends, and Cash Ledger/FX while preserving the intended return route.
- [x] Gate FX on two distinct configured currencies and link the enablement state to market-first account creation.
- [x] Build the adaptive account flow: focused zero-account onboarding plus a reusable responsive dialog/sheet for established users.
- [x] Make the account flow market-first, explain enabled capabilities and currency immutability, preserve entered values on error, and show a server-confirmed success transition.
- [x] Keep all supported markets available during account creation and label already-configured markets without preventing additional accounts.
- [x] Update account search to match account name, market, currency, type, and profile.
- [x] Persist account name, type, and default-profile edits; keep market/currency read-only after creation.
- [x] Introduce narrow persistence operations for `POST /accounts` and `PATCH /accounts/:id`, including atomic seeded-profile creation, integrity checks, and audit behavior.
- [x] Return authoritative account, profile/configuration delta, capabilities, and effective reporting currency from account lifecycle mutations.
- [x] Patch initiating shell/page caches from mutation responses and use existing lifecycle events for narrow invalidation elsewhere.
- [x] Apply reporting-currency fallback when the final matching active account is deleted without overwriting a shared viewer's stored personal preference.
- [x] Add API and PostgreSQL integration coverage for uniqueness, profile ownership, active/deleted/restored capability changes, reporting fallback, audit integrity, and shared-context ownership.
- [x] Add frontend unit tests for capability filtering, static single-option states, stale-state normalization, zero-account gates, account onboarding, mutation errors, and cache updates.
- [x] Benchmark account create/update before and after using a representative large PostgreSQL portfolio; record evidence of at least 5x improvement and controlled P95 below 500 ms.
- [x] Add stable CI assertions that account create/update avoid full-store persistence and remain independent of portfolio-history size; do not use wall-clock timing as a blocking CI assertion.
- [x] Add/update AAA-style E2E coverage for account onboarding, lifecycle, capability filtering, reporting fallback, stale links, shared views, and FX enablement. (`/aaa` was not available in this session; equivalent repository-native Playwright AAA coverage was added directly.)
- [x] Run the smallest relevant test scopes first, followed by all eight repository-required regression suites.
- [x] Revisit this todo after implementation and mark only delivered items complete.

## Acceptance Criteria

- A user with only a TWD account never sees US, AU, KR, or JP in operational portfolio controls.
- A user with active TWD and USD accounts sees TW/US and TWD/USD once each, regardless of how many matching accounts exist.
- A configured but empty US account enables US operational controls without producing empty Dashboard or Dividend summary cards.
- Removing the final account for a capability removes it immediately from the initiating UI and eventually from other active sessions through lifecycle invalidation.
- Soft-deleted account data is absent from normal portfolio pages and becomes visible again after restoration.
- A stale unavailable scope or currency resolves deterministically with an explanatory notice rather than an error or unsupported empty selection.
- Zero-account pages explain the missing setup, offer account creation when authorized, and preserve the intended return destination.
- Shared viewers see the owner's configured capabilities without having their stored reporting preference overwritten.
- Account creation and update do not invoke full-store persistence or scale with transaction/holding history.
- The controlled PostgreSQL benchmark demonstrates at least 5x improvement with P95 below 500 ms.

## Implementation Evidence

- PostgreSQL benchmark, 2,000 unrelated history rows, 24 measured samples after warmup:
  - create: bounded mean 11.17 ms, P95 16.85 ms, 585.42x faster than the legacy full-store path;
  - update: bounded mean 7.00 ms, P95 10.68 ms, 936.50x faster than the legacy full-store path.
- Raw and summarized results are retained under `benchmark-artifacts/`; the host runner is `scripts/run-account-mutation-benchmark-host.sh`.
- Focused Chromium coverage passes for TWD-only controls/stale report normalization/FX enablement, final-currency deletion fallback, zero-account onboarding, and market-first account creation.
- Responsive onboarding coverage passes at the pinned 375×667 mobile and 768×1024 tablet viewports with no horizontal overflow.
- Repository regression gate completed:
  - `npx eslint .`: 0 errors (46 pre-existing warnings);
  - `npm run typecheck`: passed;
  - web unit tests: 1,356 passed, 2 skipped across the split run;
  - API unit and memory-backed integration tests: 2,196 passed, 503 skipped;
  - managed PostgreSQL integration tests: 1,145 passed, 1 skipped;
  - standard `dev_bypass` E2E: 426 passed, 21 skipped;
  - OAuth E2E: 121 passed;
  - OAuth API HTTP tests: 312 passed, 2 skipped.
- The final account-helper locator cleanup was revalidated with the account-creation and account-market-binding Chromium specs: 4 passed.
- The lazy-capability loading skeleton was revalidated with the desktop dashboard fit and quick-actions Chromium regression: 1 passed.
- Final review regressions cover first-call memory-store initialization without crossing the full-store boundary, concurrent final-account deletion with owner-serialized reporting fallback, out-of-order shell refreshes, constrained global transaction markets, safe post-create return navigation, best-effort post-commit account event fanout, serialized account-type selection, and lazy capability loading before currency actions.
- Current-head review follow-up preserves the dividend-settings audit when a history-free account changes market and normalizes an unset (implicitly TWD) reporting preference when deletion or active purge leaves only non-TWD currencies. Focused memory tests passed 6/6; targeted lint and API typecheck passed; the managed PostgreSQL suite passed 1,148 tests with 1 skipped across 107 files.
- Account currency updates apply the same reporting-preference normalization as lifecycle removal, and failed optimistic account-type saves restore the authoritative selector value. Focused validation passed: memory account mutations 7/7, managed PostgreSQL account mutations 11/11, account settings UI 10/10, targeted lint, and both app typechecks.
- Authoritative account and lifecycle mutation responses invalidate older in-flight shell configuration reads so stale snapshots cannot overwrite the mutation result. The focused shell-config hook suite passed 7/7 with targeted lint and web typecheck clean.
- Account restoration now persists the effective fallback when a sole non-TWD account becomes active again, while an implicit TWD preference remains unstored. Failed initial transaction-primary loads preserve unknown capabilities so they cannot masquerade as a zero-account portfolio, and failed optimistic default-profile saves restore the authoritative selection. Focused validation passed: memory lifecycle 22/22, bounded PostgreSQL account mutations 12/12, transaction-primary/account-settings UI 17/17, and targeted lint.
- Memory account updates validate a projected account before committing any field changes, matching PostgreSQL rollback behavior for invalid multi-field updates. Cash Ledger subscribes to account mutation/lifecycle events and refreshes account metadata alongside ledger data so FX controls cannot expose stale accounts.
- PostgreSQL records when the one-time default portfolio bootstrap has completed. Subsequent reads therefore preserve an intentionally empty portfolio after the final account is permanently purged instead of recreating the deterministic Main account. The bounded account mutation suite passed 13/13 against the full numbered migration chain, and the fresh-baseline versus upgrade-path schema parity check passed.
- Server-seeded daily-review reports omit `range` when the route does, preserving the configured API default; explicit report ranges remain authoritative.
- Migration 114 normalizes existing reporting-currency preferences against active-account capabilities, and mixed-version shell responses derive missing optional capabilities from their returned active accounts instead of assuming an empty portfolio. Focused validation passed: migration backfill plus schema parity 2/2 and shell service/hook 9/9.
- Explicit account creation marks the portfolio initialized in the same transaction, preventing later default seeding after recovery from an interrupted initial bootstrap.
- Account and user hard-purge flows remove account-scoped `position_action_migration_audit` rows before deleting accounts, including migration-102 historical audit records with non-cascading foreign keys. The bounded managed-PostgreSQL account-mutation suite passed 15/15.
- Durable implementation rules were promoted to `.claude/rules/account-capability-authority.md` and `.claude/rules/bounded-account-mutations.md`.

## Out of Scope

- Restricting account creation, instrument discovery, administration, market-data maintenance, reference data, or public-share output to configured markets
- Changing the global supported-market or currency lists
- Adding per-account capability flags or behavioral semantics for account type
- Allowing account market/currency changes through the standard UI
- Adding an archived-account lifecycle state
- Building a new real-time synchronization subsystem
- Persisting derived capabilities in new database columns
- General fee-profile CRUD and ticker-binding persistence optimization

## Post-deployment Fix Todo: Capability Bootstrap and Accounts Loading

### Confirmed Root Causes

1. Dashboard and Portfolio pass a non-null but capability-less `initialPortfolioConfig` into `AppShell`. `useShellPortfolioConfig` treats every non-null initial config as fully loaded, so `ensureLoaded()` does not fetch the missing capability state. The floating Quick Actions sheet therefore keeps rendering its reporting-currency loading placeholder and never exposes the configured-currency selector.
2. `/settings/accounts` starts with eager portfolio-config loading and temporary empty account arrays. `AccountsSettingsClient` evaluates `accounts.length === 0` before its loading branch, so an unresolved account configuration is rendered as confirmed zero-account onboarding. A successful request produces a flash; a failed request can leave the false onboarding visible.

### Contract and Bootstrap Fix

- [x] Make normalized shell portfolio configuration require `capabilities`; keep any legacy/optional wire response separate from the normalized internal type.
- [x] Add `capabilities` to `/portfolio/primary`, derived from the viewed owner's active accounts with the existing domain authority.
- [x] Add `capabilities` to the web `PortfolioPageData` contract and preserve it when `PortfolioPage` constructs `initialPortfolioConfig`.
- [x] Preserve `initialPrimaryData.capabilities` when `DashboardPage` constructs `initialPortfolioConfig`.
- [x] Centralize legacy capability fallback from returned active accounts so `/settings/fee-config`, Dashboard server seeding, and Portfolio server seeding cannot diverge.
- [x] Change `useShellPortfolioConfig` completeness detection so a non-null config without capabilities is incomplete. In eager mode it must load immediately; in lazy mode `ensureLoaded()` must load it.
- [x] Preserve request ordering guards: an older capability bootstrap must not overwrite authoritative account mutation/lifecycle state.
- [x] Keep complete server-seeded paths request-efficient: opening Quick Actions must not issue another `/settings/fee-config` request when capabilities were already supplied.
- [x] Keep shared-context authority unchanged: configured capabilities must belong to the portfolio owner being viewed, while the session user's stored reporting preference remains non-destructive.

### Accounts Loading-State Fix

- [x] Expose an explicit portfolio-config state to account settings that distinguishes `loading`, `ready`, and `error`; do not infer readiness from empty arrays.
- [x] While account configuration is unresolved, render only the Accounts loading/skeleton state. Do not mount the first-account form or account list.
- [x] Render first-account onboarding only after a successful authoritative load confirms zero active accounts.
- [x] Render a recoverable configuration error when the account-config request fails; do not present failure as a zero-account portfolio.
- [x] After successful loading with existing accounts, render the account list directly and keep Add account collapsed in its existing drawer flow.
- [x] Preserve genuine zero-account behavior, validated return routes, shared read-only behavior, and authoritative create/lifecycle response patching.

### Regression Coverage

- [x] Add `useShellPortfolioConfig` coverage for a non-null partial initial config without capabilities; verify eager load, lazy `ensureLoaded()`, deduplication, and stale-response rejection.
- [x] Add Dashboard page coverage asserting that server-seeded shell configuration includes the primary DTO's capabilities.
- [x] Extend Portfolio primary API and page tests to assert canonical capabilities are returned and server-seeded.
- [x] Add an AppShell/Quick Actions integration test proving a successful multi-currency primary seed renders the configured-currency selector instead of the loading placeholder.
- [x] Add Accounts settings tests for `loading + empty arrays`, `error + empty arrays`, `ready + zero accounts`, and `ready + existing accounts`.
- [x] Add E2E coverage for Dashboard and Portfolio: open the floating `+` action and change among configured reporting currencies.
- [x] Add E2E coverage that delays the Accounts configuration response and asserts first-account onboarding never appears before readiness.
- [x] Add E2E coverage that a confirmed zero-account user still receives the market-first onboarding flow.

### Fix Acceptance Criteria

- [x] A multi-currency user can open the floating `+` action on Dashboard and Portfolio and select every configured currency exactly once.
- [x] Quick Actions never remains in capability loading after a successful primary or shell-config response.
- [x] A complete server-seeded shell config does not trigger a redundant configuration request when Quick Actions opens.
- [x] A capability-less partial initial config self-heals deterministically instead of being treated as complete.
- [x] Existing-account users never see first-account onboarding during initial loading, slow loading, or load failure.
- [x] Confirmed zero-account users still see the existing focused account onboarding.
- [x] Configuration failures show an actionable error and retry path without fabricating portfolio capabilities.
- [x] Focused unit/API/E2E tests pass, followed by all eight repository-required regression suites before the fix is declared complete.

### Investigation Evidence

- Deployed multi-currency account: Dashboard and Portfolio Quick Actions rendered `floating-action-reporting-currency-loading` with no selector; the placeholder remained after a 30-second wait.
- Deployed existing-account user: `/settings/accounts` initially rendered first-account onboarding together with `Loading settings...`, then replaced it with seven account cards after configuration completed.
- Focused existing tests passed 20/20 but do not cover partial non-null shell configuration or `isPortfolioConfigLoading: true` account settings, confirming the regression gap.
- Fix validation at implementation head:
  - lint passed with 0 errors and 46 pre-existing warnings; typecheck passed;
  - web unit tests passed in the repository's split run: 1,369 passed and 2 skipped;
  - API unit and memory-backed integration tests: 2,200 passed and 512 skipped;
  - managed PostgreSQL integration: 1,154 passed and 1 skipped across 107 files;
  - standard `dev_bypass` E2E: 429 passed and 20 skipped;
  - OAuth E2E: 121 passed;
  - OAuth API HTTP: 312 passed and 2 skipped.
- Focused fix coverage additionally passed for API capability read paths, Dashboard/Portfolio server seeding, partial/complete shell bootstrap and request ordering, Accounts loading/error/ready states, multi-currency Quick Actions, and delayed Accounts configuration.
- Codex review follow-up keeps FX creation unavailable while configured currencies are unknown, renders a distinct loading state, and exposes a retryable error without fabricating currency capabilities. Focused Cash Ledger and i18n validation passed 22/22 with targeted lint and web typecheck clean.
- Codex security follow-up scopes account-update fee-profile lookup through an account owned by the current user, making foreign and nonexistent profile identifiers indistinguishable while preserving same-owner account validation. The affected bounded mutation suite passed 15/15 and the full managed PostgreSQL gate passed 1,154 tests with 1 skipped across 107 files; targeted API lint and typecheck were clean.

## Open Items

- [x] Implement and validate the post-deployment capability-bootstrap and Accounts loading-state fix above.
- [ ] Follow-up note: fee-profile create/update/delete and ticker-binding mutations still use full-store persistence and should receive a separate bounded-persistence optimization after this scope.

## References

- Audit basis: current `dev` code at commit `d7cb467e`
- Scope debate note: none; all decisions were resolved during interrogation
- Linear tickets: none supplied
