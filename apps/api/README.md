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

## MCP OAuth connection lifecycle

ChatGPT and Claude.ai OAuth grants are independently revocable. Consent requires `connectionAction: "create" | "replace"`; replacement also requires the user's explicit `replacementConnectionId`. The server rechecks target eligibility and the configured total per-user cap during activation. New activation, refresh credential persistence, and selected replacement commit together. Labels can change without changing profile identity, permissions, credentials, or expiry.

`MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false` pauses new authorization start, consent approval, and authorization-code exchange. Restart API processes after changing this environment setting. Existing access and refresh continue subject to normal expiry, revocation, and account security checks. This is an authorization pause, not a deployment-wide MCP disable switch. Legacy codes without a bound action fail closed.

`get_profile` returns the stable authenticated user's profile, independently of delegated portfolio selection. Authentication failures enter user activity only after trusted credential-to-connection binding; request correlation uses server-generated IDs. Unknown or forged credentials must not be assigned to a guessed user's history.

See [implementation evidence](../../docs/notes/chatgpt-reauthorization/implementation-evidence.md) for verified and pending gates, and [cutover/recovery](../../docs/notes/chatgpt-reauthorization/rollout-and-recovery.md) before an approved rollout. Old broad-replacement binaries and the former unique index are unsafe rollback targets once independent grants exist.
