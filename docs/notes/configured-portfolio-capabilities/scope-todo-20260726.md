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

## Open Items

- [ ] Follow-up note: fee-profile create/update/delete and ticker-binding mutations still use full-store persistence and should receive a separate bounded-persistence optimization after this scope.

## References

- Audit basis: current `dev` code at commit `d7cb467e`
- Scope debate note: none; all decisions were resolved during interrogation
- Linear tickets: none supplied
