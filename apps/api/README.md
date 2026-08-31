# API (`@vakwen/api`)

Fastify API for Vakwen multi-market portfolio tracking: accounts, fee profiles, portfolio transactions, corporate actions, settings, and health. Port is set by `API_PORT` (default `4000`).

## Run

From repo root:

- `npm run dev -w apps/api` — start API in watch mode (or use `npm run dev` to run API + web).

From this directory:

- `npm run dev` — start API in watch mode.
- `npm run build` && `npm run start` — production build and run.

## Testing (Vitest)

All commands below are from **repo root** or from **`apps/api`** (when in `apps/api`, drop the `-w apps/api` part).

| Script | Description |
|--------|-------------|
| `npm run test -w apps/api` | Run all API tests (terminal output only). |
| `npm run test:integration -w apps/api` | Run only integration tests under `test/integration/`. |

### API test report scripts

These run the API test suite and write results to files. Use them for CI artifacts or local inspection.

| Script (from root) | Script (from `apps/api`) | Output | Use |
|-------------------|--------------------------|--------|-----|
| `npm run test:api:html` | `npm run test:html` | `apps/api/vitest-report/` | HTML report. View in browser: from `apps/api` run `npx vite preview --outDir vitest-report` and open the URL shown. |
| `npm run test:api:json` | `npm run test:json` | `apps/api/test-results/vitest-results.json` | JSON results for tooling or CI. |
| `npm run test:api:junit` | `npm run test:junit` | `apps/api/test-results/junit.xml` | JUnit XML for CI (e.g. Jenkins, GitLab, Azure Pipelines). |

Each reporter run also prints the usual Vitest summary to the terminal.

## Additive Taiwan research

The additive Taiwan research rollout remains default-off behind `MCP_RESEARCH_ACQUISITION_ENABLED`, `MCP_RESEARCH_MCP_ENABLED`, and `MCP_RESEARCH_SKILL_ENABLED`.

When enabled, the API adds read-only canonical-store MCP tools under `research:read`:

- `get_research_manifest`
- `get_research_identity`
- `get_price_series`
- `get_monthly_revenue`

`get_monthly_revenue` returns authoritative MOPS monthly-revenue source facts, derived trend metrics with explicit lineage, freshness gating, and cursor pagination for one immutable listing and fixed temporal context. Reads are store-only: they do not fetch providers, enqueue work, populate caches, mutate freshness, or change portfolio state.
