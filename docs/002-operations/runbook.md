# Runbook

Operational guide for deploying and operating the **vakwen** stack: local development, production on the QNAP home lab, and related procedures.

For system design details, see:
- [System Architecture](../001-architecture/architecture.md) — monorepo layout, request lifecycle, deployment topology, build model
- [Environment Variables](./environment-variables.md) — all env vars, schemas, validation, generation
- [Auth and Session](../001-architecture/auth-and-session.md) — OAuth flow, demo mode, cookies, identity resolution
- [CI/CD](./ci-cd.md) — GitHub Actions, deploy workflows, PR gate

---

## 1. Prerequisites

- **Docker** and **Docker Compose** on the deployment host
- **Git** (for production: repo cloned on the deploy host)
- **Production**: Configured env file at `infra/docker/.env.prod` (see First-time setup)
- **Production**: Clean git working tree for deploy (or use `--force`; see Deploy script options)

---

## 2. Local Development

### Start services

- `npm run dev` prints a help listing of available dev modes.
- Choose one local mode:
- `npm run dev:local:bypass:mem` — Fastest iteration, no auth, in-memory storage.
- `npm run dev:local:bypass:pg` — Bypass auth, real Postgres. Start Postgres first: `docker compose -f infra/docker/docker-compose.yml up -d`.
- `npm run dev:local:oauth:mem` — Google OAuth, in-memory storage.
- `npm run dev:local:oauth:pg` — Google OAuth, Postgres (closest to prod). Start Postgres first.
- `npm run dev:docker` — Full Docker Compose local stack (oauth + postgres). Use `npm run dev:docker -- --migrate` to run DB migrations.
- `infra/docker/docker-compose.yml` is local fallback Postgres/Redis and is not required for memory mode or external URL mode.

Tip: When `next dev` can't bind to `WEB_PORT` (default `3000` from `.env.example`), a previous instance likely still owns the port. Identify the orphaned process with `ps -ef | grep -i "next dev"` and stop it via `kill <pid>` or `pkill -f "next dev -p"`, then rerun `npm run dev -w apps/web`.
`scripts/kill-next.sh` clears the web and API ports from `.env.local`. Run `./scripts/kill-next.sh` to target both, `./scripts/kill-next.sh web`/`api` for a specific service, or supply any port number directly.


### Build model

- Workspace libraries (`@vakwen/domain`, `@vakwen/shared-types`) are **not** built during `npm install` / `npm ci`. `npm run onboard` now builds them before handing you the lockfile results, but you still need to run `npm run build -w libs/domain -w libs/shared-types` if you skip onboarding or if you edit those packages after the initial setup.
- Local: `npm run dev:local:bypass:mem` (or any `dev:local:*` variant) from repo root starts the API and web dev servers. Onboarding already builds the workspace libs and the dev scripts will rebuild them when the outputs are missing, but rerun `npm run build -w libs/domain -w libs/shared-types` after editing those packages or if you skipped onboarding.
- CI: `npm ci` then explicit `npm run build -w ...` steps for domain/shared-types/api (and web typecheck).
- Production: Dockerfiles run `npm ci` then explicit `npm run build -w ...` in the same order; deploy builds images from the checked-out ref.

### Required env (quick reference)

For full variable documentation, see [Environment Variables](./environment-variables.md). For auth details, see [Auth and Session](../001-architecture/auth-and-session.md).

- `WEB_PORT`, `API_PORT`, `DB_PORT`, `REDIS_PORT` — service ports
- `AUTH_MODE` — `dev_bypass` (local dev) or `oauth` (production-like)
- `PERSISTENCE_BACKEND` — `memory` (fast dev/test) or `postgres` (real storage)
- `DB_URL`, `REDIS_URL` — required when `PERSISTENCE_BACKEND=postgres`
- `ALLOWED_ORIGINS` — comma-separated CORS allowlist
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_MUTATIONS` — mutation rate limiting
- When `AUTH_MODE=oauth`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` required
- When `DEMO_MODE_ENABLED=true`: enables demo sign-in and demo user creation
- Optional EODHD quote fallback: set `EODHD_API_KEY` in env or rotate it from Admin -> Settings -> Provider Keys; `EODHD_DAILY_CALL_LIMIT` defaults to 20.

### Notes

- Use `AUTH_MODE=dev_bypass` for local development only.
- For production-like runs use `AUTH_MODE=oauth`.
- `AUTH_USER_ID` / `NEXT_PUBLIC_AUTH_USER_ID` have been **removed**. If `AUTH_USER_ID` is set in the env file with `AUTH_MODE=oauth`, `deploy.sh` will error. Remove it from any existing env files.
- Recompute history is explicit and audited via preview/confirm APIs (fee profile recompute) or via cascade recompute triggered by transaction delete/edit (KZO-114). Cascade recompute runs asynchronously and publishes results over the SSE stream.
- For local tests without DB/Redis, set `PERSISTENCE_BACKEND=memory`.
- For external Postgres/Redis mode, keep `PERSISTENCE_BACKEND=postgres` and set external `DB_URL`/`REDIS_URL`; do not start local compose DB/Redis unless needed for fallback.

### JP market-data operations

JP support uses a split-provider runtime:

- `yahoo-finance-jp` owns JP daily bars, basic cash dividends, metadata/search fallback, close refresh, and intraday overlays.
- `twelve-data-jp` owns JP catalog sync only.
- Default official JP calendar source is `official-jp`, which points to `https://www.jpx.co.jp/english/corporate/about-jpx/calendar/`.

Restart-required env toggles:

- `JP_PROVIDER_MOCK=true` forces the JP Yahoo provider onto its mock implementation.
- `JP_CATALOG_PROVIDER_MOCK=true` forces the JP Twelve Data catalog provider onto its mock implementation.
- `TWELVE_DATA_API_KEY` remains required for real JP catalog sync because JP catalog enumeration uses the same Twelve Data bootstrap key as AU/KR.

Runtime-tunable JP knobs live in Admin -> Settings -> App Config:

- `yahooJpProviderRateLimitPerMinute`
- `yahooJpProviderMinRequestIntervalMs`
- `jpCatalogAllowedStockTypes`
- `jpCatalogIncludeDepositaryReceipts`
- `jpCatalogIncludeAtSymbols`

Operator notes:

- JP tickers stay canonical as bare JPX/TSE symbols such as `7203`; Yahoo `.T` suffixing is provider-internal only.
- JP catalog sync is strict by default: `JPY`, `JPX`, `XJPX`, supported stock types, and plain alphanumeric symbols only.
- JP v1 does not support provider mapping repair and does not model the Tokyo lunch break precisely. Expect settlement/freshness at `15:30` `Asia/Tokyo`, with intraday open-state treated as a single coarse session.
- JP fee/tax automation is limited to existing configurable fee profiles. There are no built-in JP sell-tax defaults yet.

### Local Docker Stack Validation

Use the local Docker stack to validate that Docker images build and the full containerized stack works before pushing to CI. This catches Dockerfile dependency drift that host-level builds don't detect.

#### Setup (one time)

```bash
# Generate the local Docker env file interactively
npm run env:setup -- --target docker:local

# Or non-interactively with defaults (requires manual password editing)
npx tsx scripts/env-setup.ts --target docker:local --non-interactive
```

This creates `infra/docker/.env.local` with the required variables. Edit passwords and Google OAuth credentials as needed.

#### Validate the full stack

```bash
# Build, migrate, start, and health-check — leaves stack running
npm run dev:docker:validate

# Same, but tear down after validation
npm run dev:docker:validate:teardown
```

**What `dev:docker:validate` does** (phases in order):

1. **Preflight** — checks docker, compose file, and env file exist
2. **Build** — `docker compose --profile migrate build` (api, web, migrate images)
3. **Start infra** — postgres and redis, waits for healthy (up to 60s)
4. **Migrate** — runs the migration container against local postgres
5. **Start apps** — api and web containers
6. **Health check** — API at `/health/live` (30s), web at `/` (20s)
7. **Summary** — reports pass/fail and shows `docker compose ps`

If any phase fails, the script collects container logs and exits with code 1.

#### Access the local stack

After validation passes (stack left running):

```bash
# Web app
open http://localhost:3300

# API health
curl http://localhost:4300/health/live

# Connect to local postgres
docker exec -it vakwen-local-postgres psql -U vakwen vakwen

# View logs
docker compose -p vakwen-local -f infra/docker/docker-compose.local.yml logs -f vakwen-local-api
```

#### Port mappings (host:container, +300 offset)

| Service  | Host port | Container port |
|----------|-----------|----------------|
| Web      | 3300      | 3000           |
| API      | 4300      | 4000           |
| Postgres | 5732      | 5432           |
| Redis    | 6679      | 6379           |

These ports avoid collision with host-level dev servers (`npm run dev:local:*` uses 3000/3333 + 4000).

#### Tear down manually

```bash
# Stop and remove containers (keep volumes)
docker compose -p vakwen-local -f infra/docker/docker-compose.local.yml down

# Stop, remove containers AND volumes (fresh start)
docker compose -p vakwen-local -f infra/docker/docker-compose.local.yml down -v
```

#### OAuth in local Docker stack

The local stack defaults to `AUTH_MODE=oauth` (not `dev_bypass`) because:
- The API enforces `dev_bypass` is only allowed when `NODE_ENV=development`
- The Docker stack runs `NODE_ENV=test` by default (configurable via `NODE_ENV` env var), which blocks `dev_bypass`
- `GOOGLE_REDIRECT_URI` is hardcoded to `http://localhost:4300/auth/google/callback` in the compose file (uses host port 4300, not container port 4000)
- `SESSION_COOKIE_NAME` uses `g_auth_session` (no `__Host-` prefix) because local Docker runs on HTTP

To use the local stack with OAuth, ensure your `infra/docker/.env.local` has valid `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` values.

### MCP server and AI connectors

The Vakwen MCP server is part of the Fastify API process. There is one shared all-in-one MCP endpoint at `/mcp`; there is no separate MCP daemon to start or restart and no per-client MCP server.

#### Bring up MCP locally

Start any local mode that runs the API. The fastest smoke-test mode is:

```bash
npm run dev:local:bypass:mem
```

Then verify the MCP routes from another shell:

```bash
curl http://localhost:4000/mcp/health
curl http://localhost:4000/.well-known/oauth-protected-resource
```

Expected local endpoint:

```text
http://localhost:4000/mcp
```

That bypass mode is only a local MCP route smoke test. It does not prove the ChatGPT OAuth path because ChatGPT requires public HTTPS and OAuth discovery.

For an OAuth-capable local validation path, use the local Docker stack or another mode that runs the API with `AUTH_MODE=oauth`, then verify both MCP and OAuth discovery:

```bash
curl http://localhost:4300/mcp/health
curl http://localhost:4300/.well-known/oauth-protected-resource
curl http://localhost:4300/.well-known/oauth-authorization-server
curl http://localhost:4300/.well-known/oauth-authorization-server/mcp
```

For end-to-end local OAuth consent validation, sign in through the local web app, then start authorization against the local API with a test/local redirect URI. Localhost redirect URIs are allowed only for tests and local development; production ChatGPT connections must use the ChatGPT callback allowlist below.

For local Docker validation, the host-published API port is `4300`, so use:

```bash
curl http://localhost:4300/mcp/health
curl http://localhost:4300/.well-known/oauth-protected-resource
```

#### Public endpoint requirement

ChatGPT cannot connect to `localhost`. A ChatGPT-facing Vakwen MCP server must be reachable over public HTTPS, for example:

```text
https://<public-api-host>/mcp
```

Use the deployed API hostname or put an HTTPS tunnel in front of the API. Production ChatGPT OAuth should use the configured public API issuer/origin; request-header inference is only a local/dev fallback because reverse proxies and internal hostnames can otherwise produce the wrong issuer, token audience, or resource URL.

#### Current AI connector status

The MCP implementation supports Streamable HTTP at `/mcp`, OAuth protected-resource and authorization-server metadata, authorization-code + PKCE consent, refresh-token rotation, connector policy enforcement, connector access logs, and local dev-token bearer authentication for controlled smoke tests. ChatGPT / OpenAI Apps use the shipped OAuth connector path. Claude Code, Codex CLI/IDE, Gemini CLI, VS Code / Copilot MCP, and generic MCP clients use user-generated bearer fallback connector instances when admin policy allows it. Dev tokens are only for local diagnostics and must not be exposed as an end-user credential flow.

Additive research authorization is a separate rollout from the legacy read surface. It uses a dedicated `research` tool group plus `research:read`, while `portfolio:mcp_read` remains the legacy read scope. `get_research_manifest` and `get_research_identity` are research-only and read the canonical store without upstream side effects. `search_instruments` remains the shared discovery tool: with `portfolio:mcp_read` it keeps the multi-market legacy behavior, and with `research:read` it narrows to Taiwan research search.

`Claude.ai` is not a separate shipped client kind in this worktree yet. Do not reuse the Claude Code bearer setup as a substitute for Claude.ai OAuth. The repair scope tracks a future dedicated `claude_ai_connector` client with callback `https://claude.ai/api/mcp/auth_callback`.

Client support tiers:

| Tier | Client | Client kind | Auth path | Notes |
|---|---|---|---|---|
| 1 | ChatGPT / OpenAI Apps | `chatgpt_app` | OAuth | Supports OpenAI Apps widget metadata and transaction draft component rendering. |
| 1 | Claude.ai | Not yet implemented | Not yet implemented | Separate OAuth client remains a pending repair item in the locked revision; callback target is expected to be `https://claude.ai/api/mcp/auth_callback`. |
| 1 | Claude Code | `claude_code` | Bearer fallback | Uses the shared `/mcp` endpoint and authenticated Vakwen web fallback links for interactive review/posting. |
| 1 | Codex CLI/IDE | `codex_cli` | Bearer fallback | Same MCP server and fallback-link behavior as Claude Code. |
| 2 | Gemini CLI | `gemini_cli` | Bearer fallback | Documented client path only; Google Gemini app / Gemini Enterprise connector is out of scope. |
| 2 | VS Code / Copilot MCP | `copilot_mcp` | Bearer fallback | Documented client path only. |
| 2 | Generic MCP | `generic_mcp` | Bearer fallback | Use only the minimum scopes needed. |

Bearer fallback rules:

- Users create bearer connector instances from Settings -> AI Connectors -> Connect after an admin enables bearer fallback in Admin -> Settings -> MCP.
- Bearer tokens are displayed once, stored only as hashes, scoped, expiring, revocable, and audited.
- Bearer fallback is secondary to OAuth for hosted production clients; do not use admins as token brokers for normal user-owned connector setup.
- OAuth token secret rotation revokes OAuth connector credentials. Bearer fallback connector credentials have a separate blast radius and are not silently revoked by OAuth secret rotation.

#### Non-widget client setup snippets

Replace `<public-api-host>` with the public API host and `<one-time-vakwen-token>` with the token shown once after creating a bearer connector.

Claude.ai:

```text
Not available in this worktree yet. Wait for the dedicated Claude.ai OAuth connector repair work instead of using the Claude Code bearer flow.
```

Claude Code:

```bash
claude mcp add --transport http vakwen https://<public-api-host>/mcp --header "Authorization: Bearer <one-time-vakwen-token>"
```

Codex CLI/IDE:

```toml
[mcp_servers.vakwen]
url = "https://<public-api-host>/mcp"

[mcp_servers.vakwen.headers]
Authorization = "Bearer <one-time-vakwen-token>"
```

Gemini CLI:

```json
{
  "mcpServers": {
    "vakwen": {
      "httpUrl": "https://<public-api-host>/mcp",
      "headers": {
        "Authorization": "Bearer <one-time-vakwen-token>"
      }
    }
  }
}
```

VS Code / Copilot MCP:

```json
{
  "servers": {
    "vakwen": {
      "type": "http",
      "url": "https://<public-api-host>/mcp",
      "headers": {
        "Authorization": "Bearer ${input:vakwen-mcp-token}"
      }
    }
  },
  "inputs": [
    {
      "id": "vakwen-mcp-token",
      "type": "promptString",
      "description": "Vakwen MCP bearer token",
      "password": true
    }
  ]
}
```

Generic MCP client:

```json
{
  "mcpServers": {
    "vakwen": {
      "url": "https://<public-api-host>/mcp",
      "headers": {
        "Authorization": "Bearer <one-time-vakwen-token>"
      }
    }
  }
}
```

For transaction draft review and posting, ChatGPT receives the OpenAI Apps widget bridge. Non-widget clients receive structured MCP responses with `webFallback.url`; the URL requires the normal authenticated Vakwen web session and server-side authorization before any mutation.

#### ChatGPT OAuth connector configuration

Before configuring ChatGPT, an admin must configure the Vakwen MCP OAuth settings:

1. Set the public API issuer/origin to the externally reachable HTTPS API origin, for example `https://vakwen-dev-api.kzokvdevs.dpdns.org`. Production OAuth rejects header-derived issuers; local development can fall back to localhost request headers.
2. Confirm the app has a stable `SESSION_SECRET` before OAuth testing. The ChatGPT authorize flow uses the normal Vakwen login session before consent.
3. Set the encrypted admin-level MCP OAuth token secret in Admin -> Settings -> MCP. The secret signs MCP access tokens and hashes authorization codes and refresh tokens. Use the Generate action in the rotate dialog, or paste a 64-hex value from `openssl rand -hex 32`.
4. Set the maximum connector lifetime. Users can choose a shorter lifetime during consent, but not a longer one.
5. Confirm MCP deployment is enabled and ChatGPT is allowed under Admin -> Settings -> MCP.
6. Confirm the desired tool groups are enabled. Write tools should stay disabled unless intentionally rolled out. The additive research rollout is separate: the `research` tool group plus the acquisition and MCP env gates must be enabled intentionally before users can acquire and use `research:read`. The independent Skill gate is reserved for a future Skills-facing surface.
7. Leave the additional redirect URI allowlist empty unless ChatGPT or another approved MCP client sends a callback that is not covered by the built-in ChatGPT defaults. Custom entries are exact HTTPS redirect URIs, one per line.

Three auth knobs are related but have different blast radii:

| Knob | Configure in | Rotation/reset behavior |
|---|---|---|
| `SESSION_SECRET` | Environment | Signs normal Vakwen web sessions. Rotation signs users out and can interrupt an in-progress ChatGPT consent flow, but does not revoke already issued ChatGPT connector tokens. |
| MCP OAuth token secret | Admin -> Settings -> MCP | Signs MCP access tokens and hashes authorization codes/refresh tokens. Rotation or clearing revokes pending and active ChatGPT connectors; users must reconnect ChatGPT. |
| User session-version reset | Account security/admin reset path | Revokes ChatGPT connectors on refresh or access-token validation for that user, because tokens carry the session version from consent time. |

ChatGPT rollout scopes:

| Scope | Capability | Default state | User-deselectable |
|---|---|---|---|
| `portfolio:mcp_read` | Read portfolio, holdings, transaction context, and connector-safe summaries | Enabled when global MCP read tools are enabled | No for the first rollout; ChatGPT needs read context to be useful |
| `research:read` | Canonical Taiwan identity manifest/history, price series, monthly revenue, and additive Taiwan search, including `get_research_manifest`, `get_research_identity`, `get_price_series`, `get_monthly_revenue`, `includeInactive`, and per-item `researchIdentity.availability` metadata | Disabled until research acquisition and MCP exposure are intentionally enabled | Yes |
| `transaction_draft:create` | Create draft transaction candidates for user review | Disabled unless admins enable write/draft tools | Yes |
| `transaction_draft:edit` | Update draft transaction candidates before user review | Disabled unless admins enable write/draft tools | Yes |
| `transaction_draft:archive` | Archive AI transaction draft batches | Disabled unless admins enable write/draft tools | Yes |
| `transaction_draft:delete` | Delete AI transaction draft batches | Disabled unless admins enable write/draft tools | Yes |
| `account:manage` | Create, edit, soft-delete, and restore portfolio accounts through MCP account tools | Disabled unless admins enable write tools | Yes |
| `transaction:write` | Create posted transactions directly and post ready AI draft rows | Disabled unless admins enable write tools | Yes |

Advanced write scopes are opt-in. Leave `account:manage` and `transaction:write` disabled unless the user intentionally delegates portfolio management and the admin write policy group is enabled. Owner share approval does not auto-upgrade a delegate's ChatGPT connector; delegates must also reconnect or re-consent with the matching connector scopes before MCP write tools can use them.

Research rollout behavior:

- `MCP_RESEARCH_ACQUISITION_ENABLED=false` prevents the scheduled official Taiwan research workers from being registered, so canonical identity, price-series, and monthly-revenue acquisition do not run and new OAuth consent and bearer creation do not offer or persist `research:read`. Existing OAuth and bearer rows keep their stored scopes unchanged; there is no implicit grant.
- `MCP_RESEARCH_MCP_ENABLED=false` means MCP discovery and tool metadata do not expose `get_research_manifest`, `get_research_identity`, `get_price_series`, `get_monthly_revenue`, or the additive research search path. Legacy clients continue to see the pre-rollout catalog.
- `MCP_RESEARCH_SKILL_ENABLED=false` makes `get_research_manifest` report Skill orchestration as disabled. The public `taiwan-stock-research` Skill must stop before identity, price-series, or monthly-revenue orchestration; MCP tools remain controlled independently by the acquisition and MCP gates.
- A connector that already has `portfolio:mcp_read` and later gains `research:read` must reconnect or be recreated. Existing rows are preserved for rollback, but they are not auto-upgraded.
- When the additive research path is active, `search_instruments.includeInactive=true` widens results without changing legacy error shapes, and each result may add `researchIdentity.availability` as `available`, `unavailable`, or `not_applicable`.
- Research-only search supports Taiwan (`marketCode=TW`) only. Portfolio read continues to support the legacy multi-market search path. A combined connector may still use the legacy read path and receive additive `researchIdentity` metadata when the rollout is on.
- The official identity worker runs at `15 18 * * 0-4` UTC (02:15 Monday-Friday in Taiwan). Monthly revenue runs separately at `15 16 * * *` UTC (00:15 daily in Taiwan), after the preceding local filing day has closed. The daily cadence covers authoritative calendar-declared weekend-open filing days as well as ordinary weekdays, while the freshness resolver determines which issuer month is due. Worker startup enqueues one ordered identity-then-revenue bootstrap. The workers ingest official company, ETF, ETN, company-delisting, ETN-retirement, and MOPS monthly-revenue sources for both TWSE and TPEx into append-only canonical history. Identity lifecycle inputs remain fail-closed for empty or incomplete snapshots. Revenue acquisition preserves raw ROC month/date values, publication context, source comparisons, basis and qualifier signals, and immutable provenance per retrieval.
- The official price worker runs daily at `30 10 * * *` UTC and once at worker startup. The authoritative Taiwan calendar skips closed dates while preserving declared weekend-open sessions. Each run completes official identity ingestion before reading the close snapshots so first-day listings are resolvable. It accepts only non-empty, single-session TWSE and TPEx snapshots whose date matches the latest calendar-authorized session due by 18:00 Asia/Taipei and that pass a per-venue active-listing completeness guard, then resolves each listing universe at that quote session rather than the later retrieval time; stale or otherwise failed validation appends no price records and leaves the job retryable. It ingests authoritative settled daily price snapshots only, writes append-only canonical price history, and never backfills market context from FinMind, Yahoo, or other non-authoritative sources. TPEx `tpex_spendi_today` suspension rows apply only when the retrieval business date matches the TPEx quote snapshot date; historical suspension rows remain independently effective. Request-time freshness resolves the official Taiwan trading calendar version valid at the query's `knowledgeAt` and fails closed when a requested year has no version known at that time: the current settled close is due after 18:00 Asia/Taipei and becomes stale after 22:00 Asia/Taipei only when an authoritative calendar proves the session. Stored exchange observations can prove individual open sessions without inventing unobserved weekday gaps. Manifest price availability is capped at the same `effectiveAt` boundary used by price-series reads.
- `get_price_series` remains store-only even when acquisition is enabled. It supports `latest`, `latest_sessions`, and `date_range`, returns only explicit canonical states, and withholds adjusted-basis outputs that require unavailable canonical verified corporate actions. A metric is withheld when the selected scope cannot supply its complete requested window. Returned metric lineage carries at most 64 boundary observations (first 32 and last 32), reports complete observation/provenance counts, and includes a SHA-256 digest of the full ordered lineage. Public structured content is budgeted to 256 KiB; the service keeps an internal reserve for MCP transport framing and raises `research_record_too_large` when even one session would exceed the budget.
- `get_monthly_revenue` is read-only and store-only. Reads do not contact TWSE or TPEx, enqueue acquisition, populate caches, mutate freshness, write evidence, or change portfolio state. Freshness is evaluated from the latest expected issuer month using the applicable statutory deadline plus the next Taiwan business-day grace.

Built-in production ChatGPT redirect callbacks are:

- `https://chat.openai.com/aip/oauth/callback`
- `https://chat.openai.com/aip/<gpt-id>/oauth/callback`
- `https://chat.openai.com/connector/oauth/<connector-id>`
- `https://chatgpt.com/aip/oauth/callback`
- `https://chatgpt.com/aip/<gpt-id>/oauth/callback`
- `https://chatgpt.com/connector/oauth/<connector-id>`

The admin UI also supports additional exact redirect URI allowlist entries under Admin -> Settings -> MCP. Useful examples shown in the UI are:

- `https://chatgpt.com/connector/oauth/<connector-id>`
- `https://chat.openai.com/connector/oauth/<connector-id>`
- `https://chatgpt.com/aip/oauth/callback`
- `https://chatgpt.com/aip/<gpt-id>/oauth/callback`

Replace placeholders before saving custom entries. Do not include query strings or fragments.

Local/test-only redirect exceptions are limited to localhost or `127.0.0.1` callbacks. Do not rely on localhost redirects for a production ChatGPT connector.

Verify discovery from a shell:

```bash
curl https://<public-api-host>/.well-known/oauth-protected-resource
curl https://<public-api-host>/.well-known/oauth-authorization-server
curl https://<public-api-host>/.well-known/oauth-authorization-server/mcp
```

Expected discovery properties:

- Protected resource `resource` is `https://<public-api-host>/mcp`.
- Protected resource `authorization_servers` includes `https://<public-api-host>`.
- Authorization-server metadata exposes `/oauth/authorize` and `/oauth/token`.
- Token endpoint auth methods include public-client PKCE mode (`none`) and ChatGPT CIMD mode (`private_key_jwt` with `RS256`). ChatGPT-created apps currently publish CIMD client metadata with `token_endpoint_auth_method=private_key_jwt`.
- PKCE code challenge method includes `S256`.
- URL-based client metadata document support is advertised with `client_id_metadata_document_supported: true`.
- Public HTTPS issuers advertise `authorization_response_iss_parameter_supported: true`, and approval/denial callbacks back to ChatGPT include `iss=<public-api-origin>`.

Then configure ChatGPT as a custom app / MCP connector:

1. In ChatGPT, enable Developer Mode under Settings -> Apps -> Advanced settings.
2. Create a new app or custom MCP connector.
3. Set the server URL to `https://<public-api-host>/mcp`.
4. Choose OAuth authentication if ChatGPT asks for an auth mode. Discovery should otherwise identify OAuth automatically from the MCP metadata.
5. Start the connect flow. ChatGPT redirects to Vakwen OAuth.
6. Sign in to Vakwen if needed.
7. Review the Vakwen consent screen, choose connector lifetime and granted scopes, then approve.
8. Let ChatGPT scan the MCP tools.
9. Start a new chat and select the Vakwen app from the tool/app picker.
10. Manage the connected account in Vakwen under Settings -> AI connectors.
11. Manage global policy in Vakwen under Admin -> Settings -> MCP.

#### ChatGPT transaction draft component surface

The Phase 3 AI Copilot inbox work adds a ChatGPT Apps component for draft review and guarded posting. The component shell lives in `apps/web`; MCP auth, discovery, render tools, and mutations remain in `apps/api`.

Runtime surface:

- Public component route: `/connectors/chatgpt/transaction-draft`
- Local harness route: `/connectors/chatgpt/transaction-draft/harness`
- Render tool: `get_transaction_draft_batch_component`
- Guarded posting tool: `post_transaction_draft_rows`

The component is intentionally decoupled from the normal Vakwen web session:

- ChatGPT loads the public shell from the web app origin using the MCP tool's `openai/outputTemplate`.
- The shell does not call Vakwen REST endpoints directly.
- All state refreshes and mutations go back through the MCP bridge with `window.openai.callTool(...)`.
- Component-origin mutations are audited as MCP actions with source metadata set to `chatgpt_component`.
- `post_transaction_draft_rows` commits row confirmations, the accounting snapshot, the batch version, and the confirmation event together; optimistic version conflicts abort before the post is stored.

Expected draft-tool wiring for the widget:

- `get_transaction_draft_batch_component` refreshes the full widget payload for a batch.
- `update_transaction_draft_rows`
- `exclude_transaction_draft_rows`
- `reinclude_transaction_draft_rows`
- `reject_transaction_draft_rows`
- `archive_transaction_draft_batch`
- `delete_unconfirmed_transaction_draft_batch`
- `post_transaction_draft_rows`

The harness route is for local browser and Playwright verification only. CI uses the mocked `window.openai` bridge there; live ChatGPT is not part of the required automated gate.

#### Connector-mediated CSV/image/PDF handling

Phase 3 does not add a Vakwen raw upload endpoint. CSV, image, and PDF inputs are handled through the ChatGPT connector path, then reduced to structured draft candidates plus bounded provenance before Vakwen sees them.

Current contract:

- Allowed provenance `sourceType` values: `csv`, `image`, `pdf`
- `preflight_transaction_draft_candidates` and `create_transaction_draft_batch` accept structured candidates plus optional provenance metadata only
- Candidate-level source metadata is accepted in `sourceMetadata`; raw file blobs are not
- Row and file snippets are capped at 500 characters
- Provenance file lists are capped at 10 entries per request
- Vakwen stores source/file metadata, row mappings, extractor metadata, warnings, capped snippets, and audit history
- Vakwen does not store raw CSV/image/PDF contents in this flow

Operationally, treat any request body containing a `rawPayload` field as invalid for connector-mediated imports. The server-side validation for this flow is intentionally strict so ChatGPT-side extraction can evolve without turning Vakwen into a file-retention service.

ChatGPT-side file handling should stay ephemeral by default. The temporary file may remain in ChatGPT for the current interaction, but Vakwen should receive only structured candidates and capped provenance unless the user explicitly opts into ChatGPT's own file-library behavior.

#### Optional live ChatGPT smoke checklist

This is an optional post-merge validation path. It is not a CI requirement.

Preconditions:

- Deployed HTTPS API and web origins are reachable
- `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server` resolve on the public API host
- Admin -> Settings -> MCP has a valid public issuer, token secret, and ChatGPT enabled
- Draft scopes are enabled; enable `transaction:write` only if you want to exercise posting

Checklist:

1. Connect the Vakwen app in ChatGPT against `https://<public-api-host>/mcp`.
2. Approve consent with the default draft scopes and confirm `transaction:write` is still off by default.
3. Ask ChatGPT to import a small CSV, image, or PDF transaction sample into Vakwen.
4. Confirm ChatGPT renders the transaction draft component rather than falling back to plain text only.
5. In the widget, verify the provenance copy states that Vakwen received structured candidates/capped provenance only and did not receive a raw file upload.
6. Edit one row, exclude or reinclude one row, and confirm the widget refreshes through MCP tool calls without requiring a Vakwen browser session.
7. Open the Vakwen deep link and confirm the same batch appears under `Transactions -> AI Inbox`.
8. In Vakwen Settings -> AI Connectors or admin access logs, confirm recent connector activity exists for the session.
9. If you are validating posted writes, reconnect or re-consent with `transaction:write`. Verify draft posting through `post_transaction_draft_rows`; verify posted corrections through preview first, explicit post-preview approval, and then the matching update/delete confirmation tool.

### Posted transaction mutation operations

- Admin -> Settings -> MCP controls `postedTransactionMutationBatchLimit`. The default is 50, the value must be a positive integer, and the application has no hard cap. Values above 200 remain saveable but display warnings about payload/response size, preview or client timeouts, longer locks and revision conflicts, queue backlog, and a client timeout after the server has committed.
- AI callers must resolve immutable IDs with `get_recent_transactions`, submit an update or delete preview, present the returned impact, then wait for explicit user approval before calling the matching confirmation tool. The original correction request is not approval of the preview.
- Inspect large previews with `get_posted_transaction_mutation_preview` or `/transactions/mutations/previews/:previewId`. The preview is read-only, paginated, expires after 30 minutes, and supports account, ticker, market, item status, warning, and blocker filters.
- Treat the core accounting commit and snapshot rebuild as separate states. Use `get_posted_transaction_mutation_run` or `/transactions/mutations/runs/:runId`; do not report full completion while rebuild status is queued or running.
- On `partially_failed` or `failed`, the corrected transaction facts and core accounting remain committed. Use the existing portfolio preview/replay tools to recover failed snapshot scopes. Do not repeat confirmation unless the returned run indicates the core commit did not occur.
- Delegated shared-portfolio mutations require `transaction:write`. A destructive confirmation that can purge dividend artifacts also requires `dividend:write`.

### Holdings table preferences

- Ticker selection is one user-scoped global preference shared by Top Holdings, Portfolio Holdings, and report holdings tables. `All` means every row visible after that table's current filters and limits; a custom selection includes every account row for each selected market/ticker identity.
- Column order, visibility, width, row order, filters, mobile summary count, Top Holdings count, and Portfolio compact/detailed style are stored in independent stable table contexts. Context merges are atomic, so one mounted table cannot overwrite another table's layout.
- Legacy `holdings.shared` preferences migrate on read. To diagnose a reported reset, inspect `GET /user-preferences` for `holdingsTableSettings`, verify the expected context key remains present, and confirm `PATCH /user-preferences` returns the merged sibling contexts.
10. For a 6+ row or high-value posting case, confirm the widget requires typed confirmation in the form `POST {N} TRADES`.

If the live smoke test fails, capture which phase broke:

- Discovery/connect failure
- OAuth consent/token exchange failure
- Component render failure
- Draft mutation failure
- Deep-link/handoff failure
- Posting gate or typed-confirmation failure

Official references:

- OpenAI Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- OpenAI ChatGPT app connection flow: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- MCP authorization specification: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- Cloudflare security feature interoperability: https://developers.cloudflare.com/waf/feature-interoperability/
- Cloudflare bot categories and Block AI bots: https://developers.cloudflare.com/bots/concepts/bot/

#### Cloudflare prerequisites for ChatGPT MCP

The public API host must let non-browser ChatGPT/OpenAI server requests reach the origin for OAuth
discovery, token exchange, and MCP transport. On Cloudflare, configure a first-match skip rule for the API
OAuth/MCP paths:

The checked-in rule fragment lives at `infra/cloudflare/chatgpt-mcp-skip-rule.json`. Replace
`<PUBLIC_API_HOST>` with the deployed API hostname, prepend the rule to the zone-level
`http_request_firewall_custom` entrypoint, and validate the template or an exported ruleset before deploy:

```bash
npm run infra:cloudflare:validate
node infra/cloudflare/validate-chatgpt-mcp-skip-rule.mjs /path/to/exported-ruleset.json
```

```text
(http.host eq "<public-api-host>" and (
  http.request.uri.path eq "/mcp" or
  starts_with(http.request.uri.path, "/mcp/") or
  starts_with(http.request.uri.path, "/oauth/") or
  starts_with(http.request.uri.path, "/.well-known/oauth-") or
  starts_with(http.request.uri.path, "/.well-known/openid-configuration")
))
```

Set the rule action to `Skip`, enable request logging, and skip these components for the matched API
traffic:

- all remaining custom rules
- rate limiting rules
- managed rules
- Super Bot Fight Mode rules
- Browser Integrity Check

Do not rely on this skip rule to bypass plain Bot Fight Mode. Cloudflare runs Bot Fight Mode outside the
Ruleset Engine, so custom WAF skip rules cannot skip it. If the zone is on a plan that only exposes
`Security -> Settings -> Bot fight mode`, keep that toggle off for the dev/API zone. Use Super Bot Fight
Mode or Bot Management on paid plans if per-path bot exemptions are required.

`Block AI bots` can stay enabled when the skip rule above is first in order and skips managed rules for the
API paths. If ChatGPT again returns from approval but the API logs do not show `POST /oauth/token`, check
Cloudflare Security Events for the exact timestamp and API host before changing OAuth code. A Cloudflare
block/challenge before origin will produce pending Vakwen connector rows with unconsumed authorization
codes and no token-exchange log.

#### ChatGPT connector troubleshooting

If ChatGPT says `MCP server ... does not implement OAuth`, check:

- `/.well-known/oauth-protected-resource` exists on the public API host.
- `authorization_servers` is non-empty and points at the public API issuer.
- `/.well-known/oauth-authorization-server` exists on that issuer.
- The MCP server URL entered in ChatGPT exactly matches the protected-resource `resource`.

If discovery exists but advertises the wrong origin or resource, check:

- Protected-resource `resource` must be the public HTTPS MCP URL and must include `/mcp`.
- `authorization_servers[0]` must be the public HTTPS API origin, not `localhost`, a container hostname, or an internal proxy hostname.
- Authorization-server endpoint URLs must use the same public HTTPS issuer.
- If any discovery value points at `localhost`, an internal host, HTTP, or a resource without `/mcp`, fix Admin -> Settings -> MCP -> Public API origin and retry discovery before reconnecting ChatGPT.

If OAuth starts but token exchange fails, check:

- Cloudflare Bot Fight Mode is off or the plan supports a bot product that the API skip rule can actually
  bypass. If approval returns to ChatGPT but no `POST /oauth/token` reaches the API, treat Cloudflare edge
  blocking as the first suspect.
- ChatGPT redirect URI matches the strict allowlist. Vakwen accepts `https://chat.openai.com/aip/oauth/callback`, `https://chatgpt.com/aip/oauth/callback`, GPT-scoped `/aip/<gpt-id>/oauth/callback` variants, and live custom connector callbacks such as `https://chatgpt.com/connector/oauth/<connector-id>`.
- If ChatGPT uses a new callback shape, add the exact deployed `redirect_uri` to Admin -> Settings -> MCP -> Additional redirect URI allowlist and retry the OAuth flow.
- ChatGPT URL client metadata is reachable from the API host. Current ChatGPT-created CIMD apps publish `client_id=https://chatgpt.com/oauth/<connector-id>/client.json` and `token_endpoint_auth_method=private_key_jwt`; the API must be able to fetch that client metadata and its `jwks_uri`.
- If approval returns to ChatGPT but ChatGPT never calls `/oauth/token`, confirm the callback URL includes `iss` matching the authorization-server metadata `issuer`. A missing or mismatched authorization response issuer can be rejected by MCP/OAuth clients before token exchange.
- `resource` equals the full public `/mcp` URL.
- Authorization code is not expired or already used.
- PKCE method is `S256`.
- The connector is still pending/active and the user is not deactivated.
- Session version has not changed due to an explicit account security reset.

If refresh fails with `invalid_grant`, check whether the connector expired, was revoked, hit refresh-token reuse detection, or was invalidated by a session-version security reset.

Rotating or clearing the MCP OAuth token secret intentionally revokes active and pending ChatGPT connector rows and their stored refresh credentials. Users must reconnect ChatGPT after a secret change.

#### Local dev-token smoke test

Use this only for local or controlled self-hosted testing. It authenticates as the seeded `user-1` memory-store user and grants read/draft scopes directly in the token payload.

```bash
TOKEN="$(
  node -e 'const p={userId:"user-1",clientId:"chatgpt",scopes:["portfolio:mcp_read","transaction_draft:create","transaction_draft:edit"]}; console.log("vakwen-dev."+Buffer.from(JSON.stringify(p)).toString("base64url"))'
)"

curl -i http://localhost:4000/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"init-1","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"manual","version":"1.0.0"}}}'
```

The response should include an `mcp-session-id` header. Pass that header on subsequent `tools/list` or `tools/call` requests in the same MCP session.

For ChatGPT Apps connector validation, every advertised tool descriptor must include OAuth `securitySchemes`
at the top level and mirrored under `_meta.securitySchemes`, an `outputSchema`, and MCP tool
`annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). App tools must also
point to a readable `text/html;profile=mcp-app` resource through `_meta.ui.resourceUri` (and the ChatGPT
compatibility alias `_meta["openai/outputTemplate"]`). The protected-resource metadata should advertise every
implemented MCP scope, including advanced scopes such as `account:manage`, so ChatGPT can reconcile reconnect
and insufficient-scope consent flows. When adding a new MCP scope, update the Postgres check constraints for
connector scopes and share capabilities in a forward migration; otherwise consent can authorize the scope but
fail with `internal_error` while persisting the connector. The static widget resource must be readable during
pre-OAuth discovery, while `tools/call` remains bearer-protected. If ChatGPT shows the app with "No app
actions available yet" and OAuth returns to ChatGPT without a follow-up `/oauth/token` request, inspect the
callback first: it must include an RFC 9207 `iss` parameter matching the public OAuth issuer. Then inspect the
live `tools/list` and `resources/read` responses before changing token handling. Also verify
ChatGPT-origin CORS preflight for `/mcp` and `/oauth/token`, plus both OAuth authorization-server and
OpenID Connect discovery aliases; ChatGPT may probe the OIDC well-known URL even for an OAuth-only MCP
authorization server.

### Redeploy a Single Service

Use `redeploy-service.sh` to rebuild and restart just one service without a full deployment:

```bash
# Rebuild and restart just the web container (local)
bash infra/scripts/redeploy-service.sh -e local web

# Rebuild and restart just the API (dev server)
bash infra/scripts/redeploy-service.sh -e dev api

# Rebuild with dependencies (restarts dependent services too)
bash infra/scripts/redeploy-service.sh -e production --with-deps web
```

**Options:**
- `-e, --environment ENV` — `local`, `dev`, or `production` (required)
- `--with-deps` — also restart services that depend on the target
- `SERVICE` — `api` or `web`

The script builds the target, restarts it (with `--no-deps` by default), runs a health check, and reports pass/fail. On failure, it logs the last 50 lines of the container and suggests recovery commands.

### E2E tests (local)

- **Run**: From repo root, `npm run test:e2e:bypass:mem` (or `npm run test:e2e:ci:bypass:mem` for JUnit output).
- **Setup**: Run `npm run onboard` or `npm run install:full` from repo root once per machine (installs npm deps, Playwright browsers, and on Linux prompts for system deps). If Chromium fails with missing shared libraries, run `npx playwright install-deps` manually (may need `sudo`).
- **Ports**: E2E uses `WEB_PORT` (default `3000` from `.env.local`) and `API_PORT` (default `4000`). Playwright only reclaims stale repo-owned web/API dev servers on those ports. If another process owns a port, the run fails and reports the owning PID/cwd/command; stop that process or override the ports.
- **Servers**: Playwright's `webServer` starts API and web automatically; no separate server script needed. Uses `PERSISTENCE_BACKEND=memory` and `AUTH_MODE=dev_bypass`.

### Integration tests with isolated host DB stack (CI-like local run)

- For macOS guest-VM Docker setup and troubleshooting, see [macos-vm-docker-setup.md](./macos-vm-docker-setup.md).

- **Run from repo root (explicit modes)**:
  ```bash
  npm run test:integration:full:host
  npm run test:integration:full:container
  ```
- `npm run test:integration:ci` is retired to avoid ambiguous host routing.
- Both explicit commands:
  - start `infra/docker/docker-compose.ci-integration.yml`
  - wait for Postgres/Redis readiness
  - poll host reachability for mapped DB/Redis ports to absorb startup races
  - run API integration tests with `RUN_POSTGRES_INTEGRATION=1`
  - tear down the CI stack automatically (`down -v`) unless `KEEP_CI_STACK=1`

- **Why host-port polling is required**:
  - Postgres/Redis can report ready from inside the containers before Docker host port forwarding is reachable from the caller shell.
  - This is common on Linux VM/containerized routing paths where `host.docker.internal` resolves, but mapped ports become reachable moments later.
  - Without polling, a single immediate probe can fail even though the stack becomes reachable shortly after.
  - Poll behavior is tunable with:
    - `CI_HOST_PORT_PROBE_ATTEMPTS` (default `120`)
    - `CI_HOST_PORT_PROBE_INTERVAL_SECONDS` (default `1`)
  - The managed harness also sets bounded Postgres/Redis connection timeouts from `CI_DB_CONNECT_TIMEOUT_SECONDS` and skips eager Redis init for direct `PostgresPersistence` setup. Redis-dependent paths still connect lazily with the same bounded timeout/retry behavior.

- **Isolation**:
  - CI stack uses non-conflicting ports by default:
    - Postgres: `15432`
    - Redis: `16379`
  - Existing stacks such as `vakwen-dev-postgres` (`5454`) and `vakwen-dev-redis` (`6363`) are untouched.

- **Mode-specific host routing**:
  - `test:integration:full:host`:
    - Intended for host shells, including guest VM shells that can access a Docker daemon.
    - Resolution order:
      1. `CI_TEST_HOST` (if set)
      2. `localhost`
      3. `DOCKER_HOST` TCP host (if present)
      4. OS default gateway (`route` on Darwin, `ip route` on Linux)
    - The script probes both DB/Redis ports and fails fast with `CI_TEST_HOST=<host-ip-or-dns>` guidance when no candidate is reachable.
    - Guest VM note: `localhost` usually points at the guest itself, not the physical host running Docker.
  - `test:integration:full:container`:
    - Intended for Linux/containerized shells.
    - Uses `host.docker.internal` and requires host-gateway mapping.
    - `docker run` example:
      ```bash
      --add-host=host.docker.internal:host-gateway
      ```
    - `docker compose` example:
      ```yaml
      extra_hosts:
        - "host.docker.internal:host-gateway"
      ```
    - The script fails fast if `host.docker.internal` is not resolvable.

- **Optional overrides**:
  - `CI_DB_PORT` (default `15432`)
  - `CI_REDIS_PORT` (default `16379`)
  - `CI_DB_NAME` (default `vakwen_ci`)
  - `CI_COMPOSE_PROJECT` (default `vakwen-ci-integration`)
  - `CI_TEST_HOST` (host mode only; explicit Docker-host IP/DNS override)
  - `KEEP_CI_STACK=1` keeps containers running for debugging

---

## 3. Deployment Overview

For architecture diagrams, topology, port mappings, resource limits, and CI pipeline details, see:
- [System Architecture](../001-architecture/architecture.md) — deployment topology, environment tiers, port mapping, container resource limits
- [CI/CD](./ci-cd.md) — CI pipeline, Docker build validation, deploy workflows

### 3.1 Containers

| Environment | Stack prefix | Example containers | Compose file |
|-------------|--------------|--------------------|----|
| `local` | `vakwen-local` | `vakwen-local-web`, `vakwen-local-api`, `vakwen-local-postgres` | `docker-compose.local.yml` |
| `dev` | `vakwen-dev` | `vakwen-dev-web`, `vakwen-dev-api`, `vakwen-dev-postgres` | `docker-compose.dev.yml` |
| `production` | `vakwen-prod` | `vakwen-prod-web`, `vakwen-prod-api`, `vakwen-prod-postgres` | `docker-compose.prod.yml` |

`IMAGE_TAG` is set by the deploy script (see Deploy script options). App images are environment-specific (`vakwen-prod-*` or `vakwen-dev-*`), while Postgres, Redis, and cloudflared use fixed upstream images.

---

## 4. First-time Setup

1. **Clone the repo** on the QNAP (e.g. inside the `ubuntu-sshd` data mount):
   ```bash
   cd ~ && git clone <repo-url> vakwen
   ```

2. **Create the environment file on the deploy host**:
   ```bash
   # Interactive setup (recommended — validates with Zod, prompts for secrets)
   npm run env:setup -- --target docker:prod
   chmod 600 infra/docker/.env.prod

   # For the dev lane:
   npm run env:setup -- --target docker:dev
   chmod 600 infra/docker/.env.dev
   ```
   All variables are documented in the unified `.env.example` at the repo root. The `env:setup` tool reads the schema, prompts for values, and auto-generates passwords where possible. See `.env.example` for `[context]` annotations indicating which vars apply to each deployment context.

3. **Configure the Cloudflare Tunnel** in the Cloudflare Zero Trust dashboard (see `infra/cloudflared/README.md`). Add both public hostnames for the web and API services.

4. **Set up Google OAuth credentials** (see [Section 4.0 Google OAuth Credentials](#40-google-oauth-credentials) below). Fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `SESSION_SECRET` in the env file.

5. **Deploy**:
   ```bash
   cd ~/vakwen
   bash infra/scripts/deploy.sh --environment production
   ```

### 4.0 Google OAuth Credentials

Follow these steps once per environment to obtain OAuth credentials from Google Cloud Console.

1. **Create a GCP project** (or reuse an existing one). In [Google Cloud Console](https://console.cloud.google.com/), go to `APIs & Services` -> `OAuth consent screen`.
2. **Configure the consent screen**:
   - Choose **Internal** (Google Workspace only) or **External** (any Google account) as the user type.
   - Fill in the app name, support email, and developer contact.
   - Add any required scopes (for this app: `openid`, `email`, `profile`).
3. **Create an OAuth 2.0 client ID**:
   - Go to `APIs & Services` -> `Credentials` -> `Create credentials` -> `OAuth client ID`.
   - Choose **Web application** as the application type.
   - Add the authorized redirect URI for each environment:
     - Production: `https://<PUBLIC_DOMAIN_API>/auth/google/callback`
     - Dev: `https://<PUBLIC_DOMAIN_API>/auth/google/callback`
   - Click `Create` and copy the **Client ID** and **Client Secret**.
4. **Update the env file** with the values from step 3:
   ```bash
   # In infra/docker/.env.prod or infra/docker/.env.dev:
   GOOGLE_CLIENT_ID=<your-client-id>
   GOOGLE_CLIENT_SECRET=<your-client-secret>
   ```
5. **Generate a SESSION_SECRET**:
   ```bash
   openssl rand -hex 32
   ```
   Add the output as `SESSION_SECRET` in the env file.
6. **Reference**: [Google OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)

`GOOGLE_REDIRECT_URI` and `APP_BASE_URL` are computed automatically in the compose files from `PUBLIC_DOMAIN_API` and `PUBLIC_DOMAIN_WEB`. Do not set them in the env file.

### 4.1 GitHub Actions Deploy Path via WARP

This repository's automated deploy path uses **Cloudflare WARP + private routing**, not `cloudflared access ssh`.

Why:

- Cloudflare documents client-side `cloudflared` for non-HTTP apps as a legacy path for SSH.
- Cloudflare documents that client-side `cloudflared` depends on WebSockets and notes that long-lived connections can close unexpectedly.
- Cloudflare recommends **WARP-to-Tunnel** or **Access for Infrastructure** for SSH instead.
- For GitHub Actions, the runner is a headless machine. WARP with a **service token** is the correct non-interactive authentication model.

In both deploy workflows, the runner:

1. Installs the WARP client
2. Enrolls into the Zero Trust organization using a **service token**
3. Routes traffic for the deploy host over WARP
4. SSHes to the deploy host by the environment-scoped `DEPLOY_HOST` value
5. Runs `infra/scripts/deploy.sh --environment <environment> --branch <branch> -t latest <sha>`

What this means in practice:

- the GitHub-hosted runner starts on the public internet and cannot normally reach your private deploy host
- WARP enrolls the runner into Cloudflare Zero Trust for the duration of the job
- once enrolled, Cloudflare routes only the allowed private destination traffic through WARP
- SSH then behaves like a normal private-network SSH connection to the deploy host
- the deploy script checks out the exact CI-tested commit SHA and builds app images tagged as `latest`

Expected deployment inputs for this flow:

- `CF_ACCESS_CLIENT_ID`
- `CF_ACCESS_CLIENT_SECRET`
- `CF_TEAM_NAME`
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_PATH`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

### 4.2 Branch-to-Environment Mapping

This repository uses two deployment lanes:

- `dev` -> [`.github/workflows/deploy-dev.yml`](/home/ubuntu/github/vakwen/.github/workflows/deploy-dev.yml) -> GitHub Environment `dev`
- `main` -> [`.github/workflows/deploy.yml`](/home/ubuntu/github/vakwen/.github/workflows/deploy.yml) -> GitHub Environment `production`

Expected promotion flow:

1. Merge feature work into `dev`
2. `CI` runs on `dev`
3. Run the dev deploy workflow manually from GitHub Actions
4. Validate the dev environment
5. Merge `dev` into `main`
6. `CI` runs on `main`
7. Successful `CI` triggers the production deploy workflow automatically

### 4.3 Cloudflare Prerequisites for Automated Deploy

Before enabling the GitHub Actions deploy workflow, configure all of the following in Cloudflare Zero Trust.

The IPs, hostnames, and team names below are documentation examples only; use your GitHub Environment values for real deployments.

#### A. Tunnel and private route

The deploy target must be reachable through an existing Cloudflare Tunnel.
For instance:
- Deploy target: `192.0.2.10`
- SSH user: `ubuntu`

Terms:

- **Private route**: a Cloudflare route that tells WARP which internal IP or CIDR range should be sent through the tunnel instead of the public internet.
- **CIDR**: address and prefix notation used to describe either a single host or a range of IPs.

In Zero Trust:

1. Go to `Networks` -> `Routes` -> `CIDR`.
2. Add a route for the private deploy endpoint `192.0.2.10/32`
3. Attach that route to the same tunnel that is running on the QNAP side.
4. Confirm the QNAP-side tunnel connector is actually running and healthy before testing WARP from GitHub Actions.

CIDR examples:

- `192.0.2.10/32` means exactly one host
- if you need a small range such as `192.0.2.65` through `192.0.2.69`, one broad CIDR is `192.0.2.64/29`, which also includes `.64`, `.70`, and `.71`
- if you need to cover exactly `192.0.2.65` through `192.0.2.69`, use multiple routes:
  - `192.0.2.65/32`
  - `192.0.2.66/31`
  - `192.0.2.68/31`

Why:

- The GitHub runner must reach the deploy host as a **private network destination** over WARP.
- A public hostname mapped to `ssh://...:22` is not required for this WARP-based machine flow.

Verify from a trusted machine on the tunnel side before touching GitHub Actions:

```bash
nc -vz 192.0.2.10 22
```

If this fails locally from the tunnel side, WARP will not fix it.

What failure looks like:

- the route is missing or attached to the wrong tunnel: SSH from the runner times out
- the deploy host is down or SSH is not listening: `nc` fails locally and the GitHub job fails at the SSH verification step
- the tunnel is not running on the QNAP or is not advertising the route: WARP enrollment succeeds, but the runner still cannot reach the deploy host

Host-side validation checklist:

1. Confirm the Cloudflare Tunnel or connector process is running on the QNAP host.
2. Confirm the tunnel attached to the private route is the same tunnel running on that host.
3. Confirm the deploy host IP used by `DEPLOY_HOST` falls inside the advertised private route.
4. From the QNAP side, confirm SSH is listening on the deploy target:
   ```bash
   nc -vz 192.0.2.10 22
   ```
5. If the tunnel runs in Docker Compose, inspect the connector logs:
   ```bash
   docker logs vakwen-prod-cloudflared --tail 100
   docker logs vakwen-dev-cloudflared --tail 100
   ```
6. If the tunnel runs as a host service, inspect the local service logs instead:
   ```bash
   sudo journalctl -u cloudflared -n 100 --no-pager
   ```

Important:

- WARP on the GitHub runner is only the client-side on-ramp.
- You still need a Cloudflare Tunnel, WARP Connector, or equivalent private-network connector on the QNAP side.
- A valid service token alone does not make the private host reachable.

#### B. Service token for headless enrollment

Create a dedicated service token for the GitHub runner.

Term:

- **Service token**: a machine credential pair used by automation instead of an interactive browser login.

In Zero Trust:

1. Go to `Settings` -> `Service tokens`.
2. Create a service token for deploy automation.
3. Save the **Client ID** and **Client Secret**.

Why:

- Cloudflare documents service tokens as the non-interactive way to enroll devices.
- The GitHub Actions runner cannot complete a browser login or interactive identity-provider flow.

What failure looks like:

- wrong Client ID or Client Secret: WARP registration fails
- missing token policy permissions: WARP starts but never connects to the private route

#### C. Device enrollment permissions

Allow that service token to enroll devices into WARP.

Term:

- **Device enrollment permission**: the Zero Trust policy that decides which identities or service tokens may register a device into WARP.

In Zero Trust:

1. Create an Access policy with:
   - `Action`: `Service Auth`
   - `Include`: the deploy service token
2. Add that policy to `Settings` -> `WARP Client` -> `Device enrollment permissions`.

Why:

- Without a device enrollment rule, the runner will load the MDM file but fail registration.
- In our debugging, this class of problem showed up as missing registration or auth failures even though the daemon was running.

Validation:

- confirm the policy action is `Service Auth`
- confirm the service token you created is included in that policy
- confirm the policy is attached to WARP device enrollment permissions, not only to an unrelated Access application

#### D. Team name / organization

Set the WARP `organization` value to the **team name**, not the full domain.

Correct example:

```xml
<key>organization</key>
<string>example-team</string>
```

Incorrect example:

```xml
<key>organization</key>
<string>example-team.cloudflareaccess.com</string>
```

How to find it:

1. Open Zero Trust.
2. Go to `Settings`.
3. Find the team name / team domain section.

For a team domain like `example-team.cloudflareaccess.com`, the organization value is `example-team`.

Why:

- WARP expects the team name.
- Using the full Access domain causes registration/authentication failures even though the local MDM file is loaded successfully.

#### E. Device profile and Split Tunnels

For GitHub Actions, prefer a **narrow Include-mode** profile for just the deploy destination.

Terms:

- **Split Tunnels**: WARP rule set that decides which traffic goes through Cloudflare and which traffic goes directly to the internet.
- **Include mode**: only the listed IPs/domains go through WARP.
- **Exclude mode**: everything goes through WARP except the listed IPs/domains.

Recommended:

1. Go to `Team & Resources` -> `Devices` -> `Device profiles`.
2. Edit the profile used by the GitHub runner.
3. Set `Split Tunnels` to `Include IPs and domains`.
4. Include only the deploy destination or the narrowest private route that covers it.

Why:

- The runner only needs to send deploy traffic through WARP.
- This keeps the policy easy to reason about and avoids unintentionally tunneling unrelated runner traffic.

Common mistake:

- Leaving the default `Exclude IPs and domains` profile in place with your private range excluded.

Impact:

- Traffic to the deploy host bypasses WARP entirely.
- The runner times out on `ssh` to the deploy host.

This was a real failure mode during setup.

Validation:

- confirm the device profile used by the runner is the one you edited
- confirm the deploy host IP or CIDR appears in the Include list
- if you broaden the route later, keep `DEPLOY_HOST` inside the included CIDR range

### 4.4 GitHub Environment Secrets and Variables

Create two GitHub Environments:

- `dev`
- `production`

Store deploy values in the environment that uses them. Keep the secret names the same across environments, but set environment-specific values.

How to think about these values:

- use **secrets** for credentials or values you do not want printed in logs, such as SSH keys, host keys, service-token credentials, and usually the private deploy host
- use **variables** for stable non-secret configuration if your policy allows it
- all of these values feed the deploy workflow directly, so a typo here usually shows up as a failed WARP connection, failed SSH connection, or wrong remote path

| Name | Type | Value | Where to get it |
|---|---|---|---|
| `CF_ACCESS_CLIENT_ID` | Secret | Cloudflare Zero Trust service token Client ID | Cloudflare Zero Trust -> `Settings` -> `Service tokens` |
| `CF_ACCESS_CLIENT_SECRET` | Secret | Cloudflare Zero Trust service token Client Secret | Cloudflare Zero Trust -> `Settings` -> `Service tokens` |
| `CF_TEAM_NAME` | Secret | Cloudflare Zero Trust team name only, for example `twp` | Cloudflare Zero Trust team/domain settings |
| `DEPLOY_SSH_KEY` | Secret | Private SSH deploy key in OpenSSH format | The private half of the deploy keypair generated for the remote deploy account |
| `DEPLOY_KNOWN_HOSTS` | Secret | Verified OpenSSH `known_hosts` entry for the deploy host | Generate with `ssh-keyscan -H 192.0.2.10` on a trusted machine, then verify the fingerprint out-of-band before storing |
| `DEPLOY_HOST` | Secret or variable | Private host/IP used for SSH over WARP, for example `192.0.2.10` | Your private deploy endpoint |
| `DEPLOY_USER` | Secret or variable | SSH user for remote deploy, for example `ubuntu` | The remote account used for deployment |
| `DEPLOY_PATH` | Secret or variable | Absolute repo path on the deploy host | The checked-out repo location on the remote machine |

Recommended:

- keep `DEPLOY_HOST` as a secret if you want it masked in logs
- use separate dev and production values whenever the targets differ
- scope all deploy values to the matching environment, not repository-wide secrets

Concrete examples:

- `DEPLOY_HOST=192.0.2.10`
- `DEPLOY_USER=ubuntu`
- `DEPLOY_PATH=/home/ubuntu/vakwen`
- `CF_TEAM_NAME=example-team`

Relationship to the deploy flow:

- `DEPLOY_HOST` must match the host covered by the Cloudflare private route
- `DEPLOY_KNOWN_HOSTS` should be generated only after you have confirmed the final deploy host/IP
- `DEPLOY_PATH` must point to the repo checkout that contains `infra/scripts/deploy.sh`
- `DEPLOY_USER` must own or be allowed to execute the deploy script and access the repo directory

`DEPLOY_PATH` requirements:

- Use an absolute path such as `/home/ubuntu/vakwen`.
- Do not use `~/vakwen`.
- The workflow quotes `DEPLOY_PATH` inside the remote SSH command, so `~` is treated literally and does not expand to the deploy user's home directory.
- If `DEPLOY_PATH` uses `~`, the preflight step fails with exit code `1` because checks like `test -f '$DEPLOY_PATH/infra/scripts/deploy.sh'` cannot find the repo.

### 4.5 Prepare the SSH Target

Create a dedicated deploy key and authorize it on the deploy host.

#### A. Generate the deploy keypair

Run this on a trusted machine:

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f github-actions-deploy
chmod 600 ./github-actions-deploy
```

This creates:

- `github-actions-deploy`: private key
- `github-actions-deploy.pub`: public key

Important:

- The private key must stay private and should only be stored in GitHub Secrets and trusted operator machines.
- OpenSSH will refuse to use a private key if permissions are too broad.

If you see:

```text
WARNING: UNPROTECTED PRIVATE KEY FILE!
Permissions 0644 for './github-actions-deploy' are too open.
```

fix it with:

```bash
chmod 600 ./github-actions-deploy
```

#### B. Install the public key on the deploy target

Authorize the public key for the deploy user on the deploy host:

```bash
ssh-copy-id -i github-actions-deploy.pub ubuntu@192.0.2.10
```

If `ssh-copy-id` is unavailable, append the key manually on the target:

```bash
mkdir -p /home/ubuntu/.ssh
chmod 700 /home/ubuntu/.ssh
cat github-actions-deploy.pub >> /home/ubuntu/.ssh/authorized_keys
chmod 600 /home/ubuntu/.ssh/authorized_keys
chown -R ubuntu:ubuntu /home/ubuntu/.ssh
```

#### C. Verify the host is reachable and the key works

Before configuring GitHub Actions, verify three things from a machine that can reach the target on the LAN.

1. Port `22` is reachable:

```bash
nc -vz 192.0.2.10 22
```

2. The private key file permissions are correct:

```bash
ls -l ./github-actions-deploy
```

Expected mode is `-rw-------` or equivalent `600`.

3. SSH succeeds with the private key:

```bash
ssh -i ./github-actions-deploy ubuntu@192.0.2.10 'hostname && whoami'
```

Expected result:

- the remote hostname is printed
- the configured deploy user is printed

Why:

- WARP handles network reachability.
- SSH authentication is still your responsibility; this deploy path should use a dedicated deploy key for a dedicated deploy user.

#### D. Capture and verify the host key

On a trusted machine, collect the host key:

```bash
ssh-keyscan -H 192.0.2.10
```

Then verify the fingerprint directly on the server or through an already trusted channel before storing the final entry as `DEPLOY_KNOWN_HOSTS`.

#### E. Store the private key in GitHub Actions

Add the full contents of `github-actions-deploy` as the `DEPLOY_SSH_KEY` secret.

Do not store the `.pub` file in GitHub Secrets. Only the private key is needed by the workflow.

#### F. Troubleshooting SSH key verification

If `ssh` fails before prompting or connecting:

- verify `nc -vz 192.0.2.10 22` succeeds
- verify the target SSH daemon is listening on port `22`
- verify the public key is present in the deploy user's `authorized_keys`

If `ssh` says the private key is ignored:

- run `chmod 600 ./github-actions-deploy`

If `ssh` prompts for a password instead of using the key:

- the wrong public key was installed, or
- the key was installed for the wrong user, or
- `authorized_keys` / `.ssh` permissions are too open

### 4.6 Workflow Behavior

Both deploy workflows use the same hardened pattern:

1. Wait for the `CI` workflow to succeed on the matching branch
2. Install the WARP client on the GitHub-hosted runner
3. Write a root-only local WARP `mdm.xml` with:
   - `auth_client_id`
   - `auth_client_secret`
   - `organization`
   - `service_mode`
4. Start WARP and connect the runner
5. Install the SSH private key and pinned `known_hosts` entry
6. Verify the remote deploy script, compose file, and env file exist on the target host
7. Run:
   ```bash
   bash infra/scripts/deploy.sh --environment "$DEPLOY_ENVIRONMENT" --branch "$DEPLOY_BRANCH" -t "$DEPLOY_IMAGE_TAG" "$DEPLOY_SHA"
   ```

Current workflow triggers:

- Dev deploys are manual-only via `workflow_dispatch` in [`.github/workflows/deploy-dev.yml`](/home/ubuntu/github/vakwen/.github/workflows/deploy-dev.yml).
- Production deploys run automatically after a successful `CI` run on `main` via [`.github/workflows/deploy.yml`](/home/ubuntu/github/vakwen/.github/workflows/deploy.yml).

Why the workflow passes both branch and SHA:

- the deploy script validates that the target SHA is reachable from the branch being deployed
- the workflow always deploys the exact CI-tested commit while still tagging the resulting images as `latest`

Jargon explained:

- **workflow_run**: a GitHub Actions trigger that starts this deploy workflow after another workflow, in this case `CI`, completes
- **environment**: the GitHub Actions environment that scopes deploy secrets, variables, and optional approval gates
- **known_hosts**: the local SSH trust file used to verify the deploy host identity before the connection is allowed

### 4.7 Why `cloudflared access ssh` Is Not the Deploy Method

Do not use `cloudflared access ssh --hostname ...` with a service token for GitHub Actions deploys.

Reasons:

- Cloudflare documents client-side `cloudflared` SSH as **legacy**.
- Cloudflare states that `cloudflared` authentication relies on **WebSockets**.
- Cloudflare notes that automated services should use a **service token** where possible and recommends **WARP-to-Tunnel** in those situations.
- In practice, this path is easier to misconfigure because it mixes a user-style SSH flow with machine credentials.

What usually goes wrong with the legacy path:

- `websocket: bad handshake`
- service-token policy attached to a flow that expects browser/user login
- tunnel hostname mapped correctly, but auth method still mismatched

For human operators, evaluate **Access for Infrastructure** instead. Cloudflare recommends it for SSH because it adds finer-grained policies, short-lived certificates, and command logging.

---

## 5. Deployment Flow

Deploys use the shared `infra/scripts/deploy.sh` entrypoint with an explicit `--environment` flag. The script selects the matching compose file and env file (`docker-compose.prod.yml` + `.env.prod` for production, `docker-compose.dev.yml` + `.env.dev` for dev), checks out the target ref, waits for backup-safe Postgres readiness, takes a pre-migration DB backup before any image builds, runs Docker disk preflight checks, builds app images, runs migrations, brings up services, runs health checks, and on failure performs an automatic rollback.

### 5.1 Automated Dev Deploy

When a change is merged into `dev`:

1. GitHub runs `CI` on `dev`
2. an operator manually runs [`.github/workflows/deploy-dev.yml`](/home/ubuntu/github/vakwen/.github/workflows/deploy-dev.yml)
3. the runner deploys the selected `dev` commit SHA to the `dev` environment
4. the remote deploy script builds images tagged `latest`

### 5.2 Automated Production Deploy

When validated changes are merged into `main`:

1. GitHub runs `CI` on `main`
2. a successful `CI` run triggers [`.github/workflows/deploy.yml`](/home/ubuntu/github/vakwen/.github/workflows/deploy.yml)
3. the runner deploys the exact `main` commit SHA to the `production` environment
4. the remote deploy script builds images tagged `latest`

### 5.3 Manual Deploy

```bash
ssh ubuntu@192.0.2.10
cd ~/vakwen
bash infra/scripts/deploy.sh --environment production
```

To deploy a specific CI-tested commit:

```bash
bash infra/scripts/deploy.sh --environment production <commit-sha>
```

### 5.4 Deploy Script Reference

**Usage:** `infra/scripts/deploy.sh [OPTIONS] [DEPLOY_SHA]`

| Option / argument | Description |
|-------------------|-------------|
| `-h`, `--help` | Show help and exit |
| `-e`, `--environment ENV` | Deploy `production` or `dev` (default: `production`) |
| `-b`, `--branch BRANCH` | Deploy from this branch (default: `main`; use `dev` for the dev lane) |
| `-s`, `--select-branch` | Interactively choose deploy branch from `git branch -a` (requires a TTY) |
| `-t`, `--image-tag TAG` | Use **TAG** for all app images in the selected environment (`vakwen-prod-*` or `vakwen-dev-*`). The GitHub Actions deploy workflows pass `latest` here. |
| `-f`, `--force` | Allow deploy with uncommitted changes (use with care; uncommitted changes may be lost on checkout) |
| `DEPLOY_SHA` | Optional. Commit SHA to deploy; must be reachable from the target branch. If omitted, script pulls latest from the branch. |

Option examples:

- deploy the latest commit from `main`:
  ```bash
  bash infra/scripts/deploy.sh --environment production
  ```
- deploy the latest commit from `dev`:
  ```bash
  bash infra/scripts/deploy.sh --environment dev --branch dev
  ```
- deploy a specific tested commit from `main`:
  ```bash
  bash infra/scripts/deploy.sh --environment production <commit-sha>
  ```
- deploy a specific tested commit from `dev` while keeping the runtime image tag as `latest`:
  ```bash
  bash infra/scripts/deploy.sh --environment dev --branch dev -t latest <commit-sha>
  ```

**Image tag behavior**

- **Default (no `--image-tag`)**: After checkout, the script sets `IMAGE_TAG=$(git rev-parse --short HEAD)`.
- **With `--image-tag latest`**: The script builds from the exact checked-out commit but tags all three app images as `latest`.
- **Recommended CI practice**: build an additional immutable sibling tag in CI or your image publication step so `latest` stays the runtime tag while each deploy remains traceable to a specific commit.

**Requirements**

- Docker and docker compose on PATH
- `infra/docker/.env.prod` present and configured for production deploys, or `infra/docker/.env.dev` for dev deploys
- Clean git working tree unless `--force` is used

**Exit codes:** `0` = success; `1` = validation or deployment failure (including after rollback).

**Long-running build diagnostics**

- GitHub Actions deploys keep the SSH session alive with client-side keepalives while the remote deploy script runs.
- `deploy.sh` emits periodic heartbeat log lines during long image builds, migrations, and `docker compose up` so a quiet Docker build does not look like a stalled or dead SSH session.
- The reusable deploy workflow captures remote Docker disk diagnostics before deploy, after successful deploys, and again during failure handling when SSH is still available.
- Docker disk diagnostics use `docker info` plus filesystem `df` checks. On QNAP Container Station, the reported Docker root can be private to the container-station administrator, so diagnostics fall back to the nearest inspectable parent filesystem. Detailed `docker system df` is opt-in with `DEPLOY_DOCKER_SYSTEM_DF=1` because it can take several minutes on QNAP.
- If a deploy still fails with `client_loop: send disconnect: Broken pipe`, treat it as a WARP/SSH transport interruption first. Check whether the remote deploy log continued under `~/.local/state/vakwen/<environment>/logs/deploy/` before assuming the app build failed.

**Deploy guardrails**

- `DEPLOY_POSTGRES_BACKUP_READY_TIMEOUT_SECONDS` defaults to `120` seconds. The deploy waits for `pg_isready` and `SELECT NOT pg_is_in_recovery()` before running `backup-postgres.sh`.
- `DEPLOY_MIN_DOCKER_FREE_GB` defaults to `25`, `DEPLOY_MIN_DOCKER_FREE_PERCENT` defaults to `15`, and `DEPLOY_BUILDER_KEEP_STORAGE` defaults to `20GB`.
- `deploy.sh` and `redeploy-service.sh` both use the shared Docker disk helper for build preflight and bounded exit cleanup. Tagged app-image cleanup remains success-only in the full deploy flow.

---

## 6. Health Checks

- **Liveness**: `GET /health/live` → `{ "status": "ok" }`
- **Readiness**: `GET /health/ready` → `{ "status": "ready", "dependencies": { "postgres": true, "redis": true } }`

The deploy script waits up to 30s for the API and 20s for the web; if either fails, it triggers rollback.

---

## 7. Deploy logs and container logs

### Deploy logs

Each run writes a timestamped log and container snapshots under the state directory:

```
~/.local/state/vakwen/<environment>/logs/deploy/
  deploy_YYYYMMDD_HHMMSS.log              # full deploy stdout+stderr
  deploy_YYYYMMDD_HHMMSS_containers/      # per-container log snapshots
    vakwen-<environment>-api.log
    vakwen-<environment>-web.log
    vakwen-<environment>-postgres.log
    ...
```

Logs older than 30 days are pruned automatically. Override the directory with `DEPLOY_LOG_DIR`, or set `VAKWEN_STATE_DIR` as the base for both logs and backups.

### Checking container logs

```bash
docker logs vakwen-prod-api --tail 100 -f
docker logs vakwen-prod-web --tail 100 -f
docker logs vakwen-prod-postgres --tail 50
docker logs vakwen-prod-redis --tail 50
docker logs vakwen-prod-cloudflared --tail 50

docker logs vakwen-dev-api --tail 100 -f
docker logs vakwen-dev-web --tail 100 -f
docker logs vakwen-dev-postgres --tail 50
```

### 7.3 Maintenance Checklist

- Rotate `DEPLOY_SSH_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, and `CLOUDFLARE_TUNNEL_TOKEN` per environment; update the matching GitHub Environment and host env file together.
- Validate configuration before a manual deploy:
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.prod config >/dev/null
  docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev config >/dev/null
  ```
- Verify the active stack on a host:
  ```bash
  docker compose -f infra/docker/docker-compose.prod.yml --env-file infra/docker/.env.prod ps
  docker compose -f infra/docker/docker-compose.dev.yml --env-file infra/docker/.env.dev ps
  ```
- Clean old app images carefully by environment prefix only:
  ```bash
  docker images | grep '^vakwen-prod-'
  docker images | grep '^vakwen-dev-'
  ```

---

## 8. Troubleshooting

### 8.1 API Requests Fail with `net::ERR_NAME_NOT_RESOLVED` (for example `/settings` or `/portfolio/holdings`)

The browser cannot resolve the API hostname. This is a **DNS / Cloudflare Tunnel** configuration issue, not an app bug.

1. **Confirm both tunnel hostnames**  
   In **Cloudflare Zero Trust** -> **Networks** -> **Tunnels** -> your tunnel -> **Public Hostname**:
   - `vakwen-web.example.com` -> `http://vakwen-prod-web:3000`
   - `vakwen-api.example.com` -> `http://vakwen-prod-api:4000`
   If the API hostname is missing, add it (same tunnel). Cloudflare will create the CNAME for the API subdomain.

2. **Verify DNS from the same network as users**  
   From a machine using the same DNS as the browser (e.g. your laptop):
   ```bash
   getent hosts vakwen-api.example.com
   # or: nslookup vakwen-api.example.com
   ```
   If it does not resolve, fix in step 1 and allow TTL/propagation.

3. **Ensure the zone is on Cloudflare**  
   The domain hosting `vakwen-api.example.com` must be in Cloudflare so the tunnel can create CNAMEs. If DNS for that zone is elsewhere, create a CNAME for `vakwen-api.example.com` pointing to your tunnel’s address (for example `<tunnel-id>.cfargotunnel.com`), as shown in the tunnel’s Public Hostname list.

After fixing DNS, no redeploy is needed; the web app already uses the correct API URL.

### 8.2 API Requests Show Response Status 0 (CORS)

If the request to the API hostname shows **status 0** in DevTools and the page origin is the web hostname, the browser is likely blocking the response due to CORS (missing or wrong `Access-Control-Allow-Origin`).

1. **Check the API’s allowed origin** on the server:
   ```bash
   docker exec vakwen-prod-api printenv ALLOWED_ORIGINS
   ```
   It must be exactly `https://vakwen-web.example.com` (no trailing slash). It is set from `PUBLIC_DOMAIN_WEB` in `docker-compose.prod.yml`.

2. **Ensure `.env.prod` has** `PUBLIC_DOMAIN_WEB=vakwen-web.example.com` (no trailing slash), then redeploy so the API container gets the correct env.

3. **Browser console**: Look for a CORS error (e.g. “blocked by CORS policy: No 'Access-Control-Allow-Origin' header”).

4. **Quick test**: Open `https://vakwen-api.example.com/health/live` in a new tab. If it returns JSON, the API and DNS are fine and the issue is CORS for the web origin.

### 8.3 GitHub Actions deploy fails with `No route to host`

This usually means the runner enrolled into WARP but Cloudflare still does not have a working private-network path to the deploy target.

Check these in order:

1. Confirm the QNAP-side Cloudflare Tunnel or connector is running.
2. Confirm the private route covering `DEPLOY_HOST` is attached to that tunnel.
3. Confirm the GitHub Environment `DEPLOY_HOST` value is the private IP or hostname covered by that route.
4. Confirm the WARP device profile for the runner includes the deploy host or CIDR in Split Tunnels.
5. Confirm the service token is allowed in `Settings -> WARP Client -> Device enrollment permissions`.

Useful commands:

```bash
warp-cli --accept-tos status
sudo systemctl status warp-svc --no-pager
nc -vz 192.0.2.10 22
docker logs vakwen-prod-cloudflared --tail 100
docker logs vakwen-dev-cloudflared --tail 100
```

Important:

- WARP client authentication on the runner does not replace the need for a tunnel or private-network connector on the QNAP side.
- If the tunnel is missing, stopped, or not advertising the right route, GitHub Actions can authenticate to WARP and still fail to reach SSH.

### 8.4 GitHub Actions deploy fails with exit code `1` during SSH preflight

If the workflow reaches SSH successfully but exits with code `1` during `Verify SSH connectivity and remote files`, the remote command ran and one of the preflight checks failed.

The workflow checks all of the following on the remote host:

- `infra/scripts/deploy.sh` exists under `DEPLOY_PATH`
- the environment-specific compose file exists
- the environment-specific env file exists
- `docker compose` is available for the deploy user

Common causes:

- `DEPLOY_PATH` is wrong
- `DEPLOY_PATH` uses `~` instead of an absolute path
- `infra/docker/.env.dev` or `infra/docker/.env.prod` has not been created on the remote host
- the deploy user cannot run `docker compose`

Useful remote command:

```bash
ssh "$DEPLOY_USER@$DEPLOY_HOST" "
set -x
ls -l '$DEPLOY_PATH/infra/scripts/deploy.sh'
ls -l '$DEPLOY_PATH/infra/docker/docker-compose.dev.yml'
ls -l '$DEPLOY_PATH/infra/docker/.env.dev'
docker compose version
"
```

If you are debugging production, replace the dev file names with the production equivalents.

### 8.5 Local Docker Deployment

#### SSH tunnel for Docker-hosted API

If the API runs inside a Docker container (e.g. via `docker-compose.local.yml`), the browser on the host cannot reach the container's internal port directly. Create an SSH tunnel forwarding the API port to the Docker host IP:

```bash
ssh -L 4300:192.168.64.1:4300 user@docker-host
```

Replace `192.168.64.1` with your Docker host IP (varies by environment — check `docker network inspect bridge` or your VM's network config).

#### SESSION_COOKIE_NAME

Do not use the `__Host-` prefix (e.g. `__Host-g_auth_session`) when running over HTTP. The `__Host-` prefix requires the `Secure` flag, which browsers reject over plain HTTP. Use `g_auth_session` instead.

#### NODE_ENV behavior matrix

| Value | Cookie `Secure` flag | Port validation | `/__e2e/oauth-session` | `/__e2e/reset` |
|-------|---------------------|-----------------|----------------------|----------------|
| `production` | Set — browser silently drops cookie over HTTP | Standard | Unavailable | Blocked |
| `development` | Not set | Rejects mismatched container/host ports (4000 vs 4300) | Available | Available |
| `test` (recommended) | Not set | Relaxed — no port mismatch errors | Available | Blocked |

`test` is recommended for local Docker because it avoids both the `Secure` cookie problem (production) and the port validation mismatch (development), while keeping the `/__e2e/oauth-session` endpoint available for debugging.

#### NEXT_PUBLIC_AUTH_MODE

`NEXT_PUBLIC_AUTH_MODE` is baked into the Next.js client bundle at build time via the Dockerfile `ARG`/`ENV`, but the multi-stage build does **not** carry `ARG`/`ENV` values from the build stage to the runtime stage. Server-side code (`proxy.ts`, `auth.ts`) reads `process.env.NEXT_PUBLIC_AUTH_MODE` at runtime, so the variable must also be set in the compose `environment` block. All three compose files set it: local uses `${AUTH_MODE:-oauth}` (matching the build arg), dev and prod hardcode `oauth`.

To change auth mode for client-side JavaScript, update the `AUTH_MODE` variable (which feeds the build arg) and rebuild the web image.

#### SERVER_API_BASE_URL

Server-side Next.js route handlers (e.g. `app/api/profile/route.ts`) run inside the Docker network and need to reach the API via the container hostname, not the host-published port or the external Cloudflare URL. Without this override, server-side fetches would hairpin through the public internet (web → Cloudflare edge → tunnel → API), adding latency and a fragile external dependency.

`SERVER_API_BASE_URL` is set in all three compose files (`http://vakwen-{env}-api:4000`) and should not be added to the env files — it is a container-network-specific value.

---

## 9. Rollback

### 9.1 Automatic rollback

If the API or web health check fails after deploy, the script automatically rolls back: it restores the previous git branch and SHA, restores the pre-migration database backup, rebuilds images, and restarts containers. The rollback block uses `set +e` so partial failures do not abort the recovery.

### 9.2 Manual rollback

To redeploy a known-good commit:

```bash
cd ~/vakwen
git log --oneline -5          # find the commit to roll back to
bash infra/scripts/deploy.sh --environment production <commit-sha>
bash infra/scripts/deploy.sh --environment dev --branch dev <commit-sha>
```

The script will checkout that SHA (if reachable from the current branch), use its short SHA as the image tag, and run the full deploy flow. To use a specific tag string for the images instead of the short SHA, pass `--image-tag <tag>` (the repo is still checked out and built from the current ref; only the tag label changes).

**Edge case**: Manual rollback does not re-run migrations in reverse. If the failed deploy applied a migration, the automatic rollback restores the DB from the pre-migration backup. If automatic restore failed, restore manually from backups (see Database backup and Migration rollback below).

### 9.3 Database migration rollback

Migrations are **not** automatically reversed by a code rollback. The deploy script takes a Postgres backup before every migration and restores it during automatic rollback. If automatic restore fails, restore manually from the state backup directory:

```bash
gunzip -c ~/.local/state/vakwen/production/backups/<latest>.sql.gz | docker exec -i vakwen-prod-postgres psql -U vakwen -d vakwen
gunzip -c ~/.local/state/vakwen/dev/backups/<latest>.sql.gz | docker exec -i vakwen-dev-postgres psql -U vakwen -d vakwen
```

Replace `<latest>` with the appropriate backup filename (e.g. the pre-migration backup).

### 9.4 Migration runner and contract

Migrations run in a dedicated image (`db/Dockerfile.migrate`) that bakes SQL files in at build time. The deploy script uses `docker compose run --build --rm` to force a fresh image build before running, preventing Docker layer cache from serving a stale migrate image that is missing new migration files. Both the API startup path and the container runner now use `schema_migrations` as the source of truth and acquire the same advisory lock before applying pending work.

After the migrate container exits successfully, the deploy script runs a **post-migration verification**: it queries `schema_migrations` to confirm the newest numbered migration file is recorded. If verification fails, the deploy logs the current migration state and triggers rollback.

Fresh databases bootstrap from `db/migrations/baseline_current_schema.sql`, then mark the superseded numbered files listed in `db/migrations/manifest.env` as applied. Existing databases continue through the numbered `db/migrations/[0-9][0-9][0-9]_*.sql` files in lexical order, with each file inserted into `schema_migrations` after it succeeds.

The dedicated runner refuses to guess when the public schema already has tables but `schema_migrations` is empty. In that state, recover the ledger explicitly or restore from backup before re-running migrations.

Current support policy for numbered migrations:
- Fresh empty databases do not need the numbered `001` through `010` files individually; the baseline schema supersedes them.
- Existing databases created before the baseline flow still require the numbered files as the supported upgrade path.
- Do not delete or rewrite numbered migrations unless the team explicitly drops support for upgrading legacy databases from those states.

### 9.5 Migration `042_kzo183_account_scoped_fee_profiles.sql` dry-run gate

Migration `042` is a strict-rollout schema change. It aborts when pre-existing data violates the new account-market or fee-profile ownership rules. Do not run a dev or production deploy until the dry-run gate passes.

Required operator procedure:

1. Build or update the worktree on the deployment host so `scripts/migrate/042-dry-run.sh` and migration `042` are present.
2. Run the dry-run script against the target environment database before any deploy that could apply `042`.
3. Capture the output in the deploy notes or PR evidence so the reviewer can confirm the gate was checked.
4. If the script reports any violation rows, stop. Fix or delete the offending data first, then rerun the dry-run until it reports zero violations.

Suggested commands:

```bash
# Local / host-routed database
bash scripts/migrate/042-dry-run.sh

# Explicit target database URL if needed
DB_URL=postgres://... bash scripts/migrate/042-dry-run.sh
```

Expected dry-run checks:
- fan-out count for fee profiles currently referenced by more than one account
- pre-flight violation count for `trade_events` whose `market_code` does not match the market derived from `accounts.default_currency`
- pre-flight violation count for `dividend_ledger_entries` whose posting account does not match the dividend event market implied by the account currency
- human-readable summary showing whether the migration is safe to apply

Interpretation:
- fan-out rows are informational; they show how many new account-owned fee profiles migration `042` will create
- any non-zero market-alignment violation is blocking
- the migration does not backfill `trade_fee_policy_snapshots.profile_id_at_booking`; that field remains audit-only metadata after the rescope

Current numbered migration inventory:
- `001_init.sql`: original base schema with users, fee profiles, accounts, transactions, lots, and recompute tables.
- `002_cost_basis_weighted_average.sql`: normalizes all users to `WEIGHTED_AVERAGE` and enforces the new invariant.
- `003_accounting_core_schema.sql`: introduces the canonical accounting tables such as `trade_events`, dividends, cash ledger, reconciliation, and daily snapshots.
- `004_trade_order_and_lot_allocations.sql`: adds trade booking order, lot opening order, and `lot_allocations`, with backfills for legacy rows.
- `005_booking_order_uniqueness.sql`: repairs duplicate booking and lot sequences, then adds uniqueness indexes.
- `006_dividend_schema_alignment.sql`: aligns dividend ledger structure, adds typed dividend deductions, and retires older deduction columns.
- `007_fee_profile_precision_and_dividend_currency.sql`: adds precise fee-profile fields and `cash_dividend_currency`.
- `008_commission_discount_percent.sql`: derives `commission_discount_percent` from legacy basis-point data.
- `009_retire_twd_ntd_fields.sql`: renames `_ntd` amount fields to amount-plus-currency names and adds currency constraints.
- `010_trade_snapshot_recompute_normalization.sql`: introduces `trade_fee_policy_snapshots`, migrates recompute references, backfills dividend cash ledger entries, and drops retired legacy structures such as `transactions`.
- `014_user_identity_and_demo.sql`: adds `display_name`, `is_demo`, `demo_expires_at`, `created_at`, `updated_at`, `deactivated_at`, `deleted_at` to `users`; creates `user_external_identities`; makes `users.email` nullable with partial unique index.
- `015_cookie_domain_and_session.sql`: adds `COOKIE_DOMAIN` support to session cookie configuration; adjusts demo session cookie handling for cross-subdomain sharing.
- `016_transaction_mutations.sql`: upgrades FK constraints on `cash_ledger_entries.related_trade_event_id`, `lot_allocations.trade_event_id`, `trade_events.reversal_of_trade_event_id`, and `recompute_job_items.trade_event_id` to `ON DELETE CASCADE`; adds `fees_source TEXT NOT NULL DEFAULT 'CALCULATED'` column to `trade_events`.
- `036_kzo158a_user_preferences.sql`: creates `user_preferences` table (per-user JSONB prefs, `user_id TEXT PK` with `ON DELETE CASCADE` on `users.id`); adds `dashboard_performance_ranges JSONB NULL` column to `app_config` (null = use hardcoded default). Idempotent — `CREATE TABLE IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS`. No audit_log changes; no backfill needed.
- `041_kzo179_account_created_at_and_name_uniqueness.sql`: adds `accounts.created_at` and per-user account-name uniqueness to stabilize account ordering and migration backfill naming.
- `042_kzo183_account_scoped_fee_profiles.sql`: moves `fee_profiles` to account ownership, drops `account_fee_profile_overrides.market_code`, adds strict pre-flight market checks, and enforces same-account fee-profile ownership with composite foreign keys.

---

## 10. Database backup

**Script (recommended):**

```bash
bash infra/scripts/backup-postgres.sh --environment production
bash infra/scripts/backup-postgres.sh --environment dev
```

Backups are written to `~/.local/state/vakwen/<environment>/backups/` (or `BACKUP_DIR` / `VAKWEN_STATE_DIR` if set). The script writes to a temporary file and renames only after `pg_dump | gzip` succeeds, so interrupted backups do not leave a partial `.sql.gz` in place.

Retention defaults are environment-aware:

| Environment | Retain days | Max files |
|---|---:|---:|
| `production` | `30` | `60` |
| `dev` | `7` | `20` |

Overrides:

- `BACKUP_RETAIN_DAYS` — explicit day-based retention override
- `BACKUP_RETAIN_MAX_FILES` — explicit max-file retention override
- `RETAIN_DAYS` — backward-compatible alias for `BACKUP_RETAIN_DAYS`

Retention pruning runs only after a new backup completes successfully.

**Manual backup:**

```bash
docker exec vakwen-prod-postgres pg_dump -U vakwen vakwen | gzip > ~/.local/state/vakwen/production/backups/vakwen_$(date +%Y%m%d_%H%M%S).sql.gz
docker exec vakwen-dev-postgres pg_dump -U vakwen vakwen | gzip > ~/.local/state/vakwen/dev/backups/vakwen_$(date +%Y%m%d_%H%M%S).sql.gz
```

---

## 11. Expected downtime

Container recreation causes about **10–30 seconds** of downtime while `docker compose up -d` recreates changed containers and the Cloudflare Tunnel re-establishes. This is acceptable for the home-lab deployment.

---

## 12. Security assumptions

- **External TLS**: All public traffic is encrypted via the Cloudflare Tunnel. TLS terminates at Cloudflare’s edge; the tunnel uses an authenticated, encrypted connection to the `cloudflared` container.
- **Internal traffic**: Communication between containers on the `vakwen-prod-net` and `vakwen-dev-net` Docker bridges (web -> api, api -> postgres, api -> redis) uses plaintext. This is acceptable because each bridge is isolated to the Docker host and not routable from the LAN.
- **Postgres**: No `sslmode`; relies on Docker network isolation.
- **Redis**: Password-authenticated, no TLS; relies on Docker network isolation.
- If the deployment moves to a multi-host setup, internal TLS must be introduced.

---

## 13. Secrets Management

### 13.1 File permissions

`.env.prod` and `.env.dev` must be `chmod 600` (owner-only read/write). This is enforced by the first-time setup `chmod 600` step and should be re-verified after any manual copy.

### 13.2 Never commit real env files

`.env.prod` and `.env.dev` are gitignored. Only `.env.*.example` files with placeholders are committed to the repository. Never commit or share real credentials.

### 13.3 Secret rotation

| Secret | How to rotate |
|---|---|
| `SESSION_SECRET` | Generate new value with `openssl rand -hex 32`, update env file, redeploy. Active sessions are invalidated; users must re-login. |
| `POSTGRES_PASSWORD` | Update in env file AND recreate the Postgres container with the new password. |
| `REDIS_PASSWORD` | Update in env file AND recreate the Redis container with the new password. |
| `GOOGLE_CLIENT_SECRET` | Rotate in Google Cloud Console (`APIs & Services` -> `Credentials`), update env file, redeploy. |
| `CLOUDFLARE_TUNNEL_TOKEN` | Rotate in the Cloudflare dashboard, update env file, redeploy `cloudflared`. |

### 13.4 Backup exclusion

The database backup script stores Postgres dumps only. Do not include `.env.*` files in any backup artifact. Env files contain secrets and must not leave the deployment host.

### 13.5 GitHub Actions secrets

Deploy credentials (SSH keys, CF tokens, WARP service tokens) are scoped to GitHub Environment secrets, never stored in the repository. See Section 4.4 for the full list.

### 13.6 Best practices for home lab

- Use a dedicated deploy user with minimal permissions (deploy script execution and Docker access only).
- Restrict SSH access to key-based auth only; disable password authentication.
- Consider encrypting env files at rest if the host filesystem supports it.
- Docker secrets (`docker secret create`) are an alternative for Swarm mode. For Compose, env files with `chmod 600` permissions are standard practice.

---

## 14. App behavior (reference)

The following sections describe product behavior for support and verification. They are not part of the deployment procedure.

### 14.1 Page-load progress bar

- The thin bar at the very top during **initial page load** is a frontend-only visual indicator.
- It is rendered by the web app’s root layout (`apps/web/app/layout.tsx`) via `LoadingProgressBar` (`apps/web/components/ui/LoadingProgressBar.tsx`) and styled in `apps/web/app/globals.css` (`.loading-progress`, `.loading-progress__bar`).
- The bar shows briefly on first load with a minimum visible duration, advances quickly then creeps toward ~80% on slower loads, and jumps to 100% and hides when the frontend considers the page ready. It does **not** track client-side route transitions.
- Accessibility: respects `prefers-reduced-motion`; uses `aria-live="off"` to avoid spamming screen readers.
- **Operational note**: This bar reflects perceived performance, not backend health; use `/health/live` and `/health/ready` for service status. If the bar is missing or wrong, verify the web container serves the expected layout, `globals.css` (including `.loading-progress` and theme tokens) is loaded, and no overlay is masking the bar (it uses `z-index: 1000`).

### 14.2 Settings drawer

- Open settings from the top-right avatar. Drawer URL state is `/?drawer=settings` for direct linking.
- Tabs: **General** and **Fee Profiles**. **Save Settings** persists locale, poll interval, weighted-average cost basis, and fee profiles atomically via `/settings/full`. Fee profiles support account fallback and per-security overrides; new profile IDs are system-generated (UUID). **Discard Changes** reverts unsaved edits without closing the drawer. Closing with unsaved edits shows a warning.
- In **Fee Profiles**, **Commission Currency** is a dropdown. The UI ships with common options and also preserves already-saved currency codes present in the loaded profile set.
- In **Record Transaction**, the **Currency** field is display-only. It is disabled in the form and is derived from the effective fee profile for the selected account and symbol. Change it from **Settings > Fee Profiles**, not from the transaction card.

### 14.3 Localization

- UI locales: `en` and `zh-TW`. After saving locale, visible wording (including settings tabs and dialogs) switches to the selected language. If language appears stale, reopen the settings drawer or reload and verify the `/settings` response.

### 14.4 Tooltips

- Settings terms and key financial terms on the dashboard/forms have hover/focus tooltips. Weighted-average cost basis includes detailed explanatory content in settings. Tooltips are keyboard-accessible via the info icon triggers.

---

## 15. KZO-143 deploy notes

### Session cookie format change

KZO-143 changes the OAuth session cookie from 2-part (`{userId}.{hmac}`) to 3-part (`{userId}.{sessionVersion}.{hmac}`). On deploy, any user with an active OAuth session will receive a 401 on their next API request because the old 2-part cookie fails the new signature check. The web proxy redirects them to `/login` — a one-time re-login restores the session.

**Demo sessions are unaffected** — they remain 2-part (`demo:{userId}.{hmac}`).

**No data migration required.** The `030_kzo143_auth_foundations.sql` migration adds columns, creates tables, and backfills emails to lowercase. It does not modify or move user data.

**Rollback impact:** Rolling back the API image to pre-KZO-143 means old code sees 3-part cookies and rejects them → another forced re-login. No data corruption in either direction.

### New env var: `INITIAL_ADMIN_EMAIL`

Optional. When set, the startup routine promotes the matching user to admin. On first sign-in, the email bypasses the invite-gate. See [Auth and Session — INITIAL_ADMIN_EMAIL](../001-architecture/auth-and-session.md#initial_admin_email-bootstrap).

If the deployment is a fresh install with no existing users, set this to the admin's Google email before first boot.

### New CLI commands

- `npm run admin:promote -- email@example.com` — promotes an existing user to admin (requires the user to have signed in at least once)
- `npm run admin:bootstrap-invite -- email@example.com admin` — seeds an invite directly in DB, bypassing HTTP auth (escape hatch for fresh deployments when `INITIAL_ADMIN_EMAIL` is not set)

### Migration pre-backfill guard

Migration `030_kzo143_auth_foundations.sql` lowercases all `users.email` values. If case-insensitive duplicates exist (e.g. `User@X.com` and `user@x.com`), the migration **aborts with a listing of the duplicates**. Resolve manually (delete or merge the duplicate) before re-running.

---

## 16. KZO-147 deploy notes

### Migration

`033_kzo147_anonymous_share_tokens.sql` adds:
- `anonymous_share_tokens` table with `ON DELETE CASCADE` on `owner_user_id`
- `ALTER TABLE audit_log` to extend `audit_log_action_check` with `share_token_created` and `share_token_revoked`

Idempotent (`CREATE TABLE IF NOT EXISTS` + a `DO $$ ... END $$` block that drops and re-adds the CHECK constraint). Safe to re-run. No backfill, no data rewrite.

**Rollback impact.** Older API images do not emit the new audit actions, so the updated CHECK is a superset of the old one — rollback needs no schema rollback. If the table is later dropped, all anonymous share tokens are lost (tokens are plaintext and cannot be rehydrated).

### New env vars

Both optional with sensible defaults:
- `ANONYMOUS_SHARE_RATE_LIMIT_MAX` (default `30`) — per-IP sliding window count
- `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` (default `300_000` = 5 min)

Keep the defaults unless a specific abuse pattern is observed; `Retry-After` is emitted as `windowMs / 1000`.

### Plaintext token storage

Anonymous share tokens are stored **plaintext** in `anonymous_share_tokens.token`. This is intentional — the owner UI needs to re-display the full URL from the list page, which rules out hashing. Treat this column as sensitive:

- DB access = token access. Anyone with read access to `anonymous_share_tokens` can impersonate the public URL on any active row.
- Backup files containing this table should be encrypted at rest.
- `pg_dump` output should not be shared casually.

Request logs are redacted server-side (Fastify `serializers.req` rewrites the 22-char token segment to `[REDACTED]`). Upstream proxies (CDN, Cloudflare, reverse proxy) and browser DevTools will still show the plaintext token in URL access logs.

### Re-enable-owner auto-resumes tokens

Disabling a user (`POST /admin/users/:id/disable`) does **not** revoke their anonymous share tokens. The tokens remain in the table with their original `expires_at`, but the public route returns 404 because step 4 of the handler rejects soft-deleted / deactivated owners.

Re-enabling the same user (`POST /admin/users/:id/enable`) transparently resurrects their tokens — they begin resolving again at `/share/{token}` without further action.

If a deployment needs "disable also revokes tokens" semantics, add a revocation pass to `disableUser` in the admin service. Not a default because it changes the contract for short-lived disables (e.g. investigating a suspected-compromised account).

### Rate-limit bucket memory growth

`anonymousShareRateBuckets` (in-process `Map<ip, timestamps[]>`) is periodically swept by `registerAnonymousShareEviction(app)` (KZO-155), which runs `sweepSlidingWindowBucket` on a `windowMs` interval via `setInterval` + `onClose` cleanup. The bucket is bounded to IPs active within the current sliding window. For a single-instance deployment this is not a concern under normal load; under heavy scraper traffic the bucket is self-pruning.

### Operational checks

- If a user reports "my public link stopped working", check (in order): `revoked_at`, `expires_at`, owner `deactivated_at` / `deleted_at`, and `/admin/audit-log` for matching `share_token_revoked`.
- Cap breach: `SELECT COUNT(*) FROM anonymous_share_tokens WHERE owner_user_id = $1 AND revoked_at IS NULL AND expires_at > NOW();` should never exceed 20 — the advisory lock prevents concurrent creates from racing past the cap.
- Retention cleanup (KZO-152): terminal rows are purged daily at 04:00 UTC by the `anonymous-share-token-purge` pg-boss singleton. Rows persist ≥ `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS` (default 90) days past their terminality (revocation or expiration). Observe via structured log `anonymous_share_token_purge_completed` (success, `{ deleted, cutoffMs }`) / `anonymous_share_token_purge_failed` (error, rethrown for pg-boss retry).

---

## 17. KZO-159 deploy notes

### Migration

`036_kzo158a_user_preferences.sql` adds:
- `user_preferences` table: `user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`, `preferences JSONB NOT NULL DEFAULT '{}'`, `created_at`, `updated_at`. Stores per-user JSONB preferences with lazy insert semantics (no row created on read; created on first PATCH).
- `app_config.dashboard_performance_ranges JSONB NULL` column: `null` = fall back to hardcoded `["1M","3M","YTD","1Y"]` default.

Both operations are idempotent (`CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`). No backfill, no data rewrite. Safe to re-run on an already-migrated database.

**No `audit_log_action_check` change.** User-pref edits are not audited. Admin changes to `dashboard_performance_ranges` reuse the existing `app_config_updated` action already in the CHECK constraint (added by migration `034`).

**Rollback impact.** Removing the column requires a manual `ALTER TABLE app_config DROP COLUMN dashboard_performance_ranges` and `DROP TABLE user_preferences`. API images prior to KZO-159 are unaware of these additions and will ignore them cleanly — the column is nullable, the table is unreferenced by old code.

### Admin Settings — Dashboard Timeframe Defaults

Admins can configure the default dashboard timeframe list at **`/admin` → Settings → Dashboard Timeframe Defaults**. The section:
- Shows chip toggles for the active ranges plus a custom range text input.
- Save = `PATCH /admin/settings { dashboardPerformanceRanges: string[] | null }`. `null` resets to the hardcoded default `["1M","3M","YTD","1Y"]`.
- Each chip must match the grammar `^YTD$|^ALL$|^([1-9]\d*)(M|Y)$` (case-sensitive), min 1, max 12, no duplicates. Invalid input disables the Save button.
- The admin setting becomes the default for all users who have not saved their own preference (KZO-161 / 158C for user-facing UI).

### `user_preferences` table lifecycle

- Rows are created lazily on first `PATCH /user-preferences`. `GET /user-preferences` returns `{ preferences: {} }` for users with no row — no insert on read.
- `user_id` is TEXT to match `users.id` PK type. `ON DELETE CASCADE` cleans up on user deletion; no manual purge needed.
- No audit log. Prefs are user-owned settings, not admin-auditable actions.
- 8 KB JSONB cap enforced at the route layer (Fastify `bodyLimit: 8192` per-route + hard re-check after parse). Oversized bodies → `413 payload_too_large`.
- Currently recognized top-level keys: `dashboardPerformanceRanges` (`string[] | null`), `cardOrder` (`object | null`), `reportingCurrency` (`"TWD" | "USD" | "AUD" | "KRW" | null`), `holdingAllocationBasis` (`"market_value" | "cost_basis" | null`), plus UI display keys such as `themeAccent` and `density`. Unknown top-level keys → `400 unknown_preference_key`; invalid enum values → `400 invalid_preference`.

### `GET /user-preferences/effective-ranges`

Three-tier resolution — returns `{ ranges: string[], source: "user" | "admin" | "default" }`:

1. **User tier**: user's stored `preferences.dashboardPerformanceRanges`, pruned against the admin list (elements not in the admin list are silently dropped). Non-empty intersection → `source = "user"`.
2. **Admin tier**: `app_config.dashboard_performance_ranges` if non-null → `source = "admin"`.
3. **Default tier**: hardcoded `["1M","3M","YTD","1Y"]` → `source = "default"`.

Auto-prune happens **at resolve time** — stored user preferences are never rewritten. If an admin removes a range that a user had saved, the user's stored value is preserved but silently excluded from the resolved list until they save again.

### Dashboard performance range validator

`GET /dashboard/performance?range=X` now validates `range` against the caller's `effectiveRanges` list (resolved per the 3-tier chain above) rather than the static `z.enum(["1M","3M","YTD","1Y"])`. Out-of-list values → `400 invalid_range`. This means users with custom admin or user overrides (after 158C ships) can query non-standard ranges.

### E2E seed endpoint

`POST /__e2e/seed-user-preferences` is a test-only endpoint guarded by `assertE2ESeedEnabled()` (requires `NODE_ENV !== "production"` + `PERSISTENCE_BACKEND=memory`). Body: `{ userId?: string, preferences: Record<string, unknown> }`. Performs a full-replace write (bypasses merge semantics). Not available in production.

### Operational checks

- To see a user's stored prefs: `SELECT preferences FROM user_preferences WHERE user_id = '<uuid>';`
- To see the admin timeframe override: `SELECT dashboard_performance_ranges FROM app_config WHERE id = 1;`
- To reset admin override to default: `UPDATE app_config SET dashboard_performance_ranges = NULL, updated_at = NOW() WHERE id = 1;` (or use the admin UI "Reset to defaults" button).
- `dashboard_performance_ranges` changes emit `app_config_updated` audit entries (visible in `/admin/audit-log`).

---

## 18. KZO-164 deploy notes

### Migration

`037_kzo164_fx_rates.sql` adds `market_data.fx_rates` and extends `audit_log_action_check` with `admin_fx_rates_refresh`.

The FX table stores daily rates by `(date, base_currency, quote_currency)` with:

- `rate NUMERIC(20, 8) NOT NULL`
- `source TEXT NOT NULL`
- `CHECK (rate > 0)`
- uppercase 3-letter currency checks
- `CHECK (base_currency <> quote_currency)`
- `idx_fx_rates_pair_date_desc` for latest-rate reads

No destructive rewrite or backfill is performed by the migration.

### Daily refresh

The `fx-refresh` pg-boss singleton runs daily at `22:00 UTC`.

Expected steady-state behavior:

- Queue: `fx-refresh`
- Cron: `0 22 * * *`
- Provider: Frankfurter v2 default blend
- Calls per run: 3 HTTP calls, one each for `TWD`, `USD`, and `AUD`
- Rows per one-day run: about 6 rows after self-pairs are filtered
- Success log: `fx_refresh_completed` with `dates_covered`, `rows_upserted`, and `durationMs`
- Failure log: `fx_refresh_failed`; the handler rethrows so pg-boss retry policy applies

On first deploy with an empty table, the cron path auto-seeds the most recent 30-day window. It does not walk back to each user's earliest cross-currency trade date; KZO-174 owns that historical walk and recompute flow.

### Manual trigger

Admins can enqueue a refresh manually:

```http
POST /admin/fx-rates/refresh
Content-Type: application/json

{
  "startDate": "2026-04-01",
  "endDate": "2026-04-26",
  "bases": ["TWD", "USD", "AUD", "KRW"]
}
```

All fields are optional. Missing dates default to today's UTC date; missing `bases` defaults to all stored bases.

Responses:

- `200 { "status": "queued", "jobId": "..." }` when a job is enqueued.
- `200 { "status": "skipped_existing_job", "reason": "..." }` when singleton dedup finds an existing job.
- `503 { "code": "queue_unavailable", ... }` when pg-boss is unavailable, such as memory-backed local mode.

Manual triggers write an `admin_fx_rates_refresh` audit row. Cron refreshes do not write audit rows.

### Freshness check

Admins can inspect stored pair freshness:

```http
GET /admin/fx-rates/freshness
```

Response shape:

```json
{
  "pairs": [
    {
      "baseCurrency": "USD",
      "quoteCurrency": "TWD",
      "latestDate": "2026-04-26",
      "ageInDays": 0
    }
  ],
  "queriedAt": "2026-04-26T22:15:00.000Z"
}
```

Interpretation:

- `ageInDays` is calculated against today's UTC date.
- `ageInDays` of 0-3 is normal around weekends, holidays, or provider forward-fill behavior.
- `ageInDays > 3` usually means Frankfurter is unavailable, cron did not run, pg-boss is unhealthy, or the worker failed and exhausted retries.

### Operational checks

Check latest rows directly:

```sql
SELECT base_currency, quote_currency, MAX(date) AS latest_date
FROM market_data.fx_rates
GROUP BY 1, 2
ORDER BY 1, 2;
```

Check the queue:

```sql
SELECT name, state, count(*)
FROM pgboss.job
WHERE name = 'fx-refresh'
GROUP BY name, state
ORDER BY state;
```

If data is stale, first check API logs for `fx_refresh_failed`, then verify pg-boss is running and Frankfurter is reachable from the API host. A manual refresh for the missing date window is safe; upserts are idempotent on `(date, base_currency, quote_currency)`.

---

## 19. KZO-172 deploy notes — AU market data ingestion

### Provider and env vars

KZO-172 adds the AU market data provider (`yahoo-finance2@^3.14.0`) and the `GET /market-data/search` endpoint. No DB schema migrations are required (the `market_data.instruments` composite PK already covers AU via `market_code = 'AU'` from migration `044`).

Three new env vars with safe defaults:

| Var | Default | Purpose |
|---|---|---|
| `YAHOO_AU_RATE_LIMIT_PER_MINUTE` | `60` | Self-imposed per-minute ceiling on Yahoo API calls. Yahoo publishes no official limit; 60 is the empirically safe value from the KZO-171 spike. Raise only if AU catalog grows significantly. |
| `AU_PROVIDER_MOCK` | `false` | Set to `true` for local dev and all test runs. Production deployments leave unset (default `false`). |
| `MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE` | `20` | Per-IP per-minute cap on `GET /market-data/search`. Separate bucket from the `/market-data/price` limit (30/min) to prevent multi-IP coordinated Yahoo budget drain. |

### Yahoo ToS notice at startup

When `AU_PROVIDER_MOCK=false` (production mode), the API emits at `warn` level on boot:

```
yahoo_finance_tos_notice: ToS limits use to personal/non-commercial. For multi-tenant deployment, switch to EODHD per spike §7.3.
```

This log line is expected and not an error. If the deployment is ever transitioning from personal use to multi-tenant or commercial use, consult `docs/004-notes/kzo-171/spike-202605021115-au-provider.md` §7.3 for EODHD upgrade triggers.

### AU catalog (Twelve Data, KZO-194)

The AU catalog is sourced from Twelve Data's free Basic tier: `/stocks?exchange=ASX` (~2,013 rows) + `/etf?exchange=ASX` (~449 rows), warrants filtered, cross-endpoint dedup preferring `/etf` classification. Net ~2,439 instruments per sync. `YahooFinanceAuMarketDataProvider.fetchInstrumentCatalog()` now returns `[]` — Yahoo is retained for AU bars/dividends/metadata/search only.

The catalog-sync cron (`30 17 * * 1-5`, post-AU-close) calls `TwelveDataAuCatalogProvider.fetchInstrumentCatalog()` and idempotently upserts to `market_data.instruments`. On transient HTTP/rate-limit failures the provider throws — pg-boss retries with backoff and the previous day's catalog is preserved by the upsert path.

**Startup-tick (KZO-194 critical gap 2):** `pgBoss.ts` enqueues a one-shot `boss.send(CATALOG_SYNC_QUEUE, {}, { singletonKey: ... })` at boot, immediately after registering the cron. Without this, a Friday-evening deploy would leave the AU catalog empty until Monday's 17:30 UTC cron tick (~72h gap).

**LIC/CEF coverage gap:** Twelve Data's bulk endpoints do not include some Australian listed investment companies (AFI, ARG, AUI, etc.). These remain discoverable via `searchInstruments` (delegated to Yahoo's live `search()` per KZO-188) and enrich inline at first backfill via `fetchInstrumentMetadata` (also Yahoo-delegated). Users see them via autocomplete and can add them via transactions; they just don't appear in the bulk Browse Full Catalog grid. LIC instruments have `last_seen_in_catalog_at IS NULL` and are **never** candidates for auto-delisting (see §23).

**Required env:** `TWELVE_DATA_API_KEY` (Twelve Data Basic). `TWELVE_DATA_BASE_URL` defaults to `https://api.twelvedata.com`. `TWELVE_DATA_RATE_LIMIT_PER_MINUTE` defaults to 8 (matches Basic tier). `AU_CATALOG_PROVIDER_MOCK=1` forces the mock; absence of `TWELVE_DATA_API_KEY` also routes to the mock (FinMind precedent).

**Commercial-use note:** Twelve Data Basic ToS §2.3(l) prohibits commercial use; commercialization swaps to EODHD commercial ($399/mo) per the KZO-171 spike. Yahoo retirement is also deferred to that swap — TD's free tier does not cover bars/dividends/quotes (Pro tier $229/mo+).

### AU quote fallback (EODHD EOD)

The EODHD fallback is for per-ticker display/valuation close repair when Yahoo is known to be delayed or wrong for a held AU instrument. It does not replace AU daily bars, dividends, metadata, search, reports, or the Twelve Data catalog.

Configuration:
- Rotate **EODHD API key** from `/admin/settings?tab=provider-keys`, or set `EODHD_API_KEY` as env fallback.
- Set **EODHD daily call limit** from the same settings tab; NULL falls back to `EODHD_DAILY_CALL_LIMIT` (default 20, bounds 1-1000).
- Create a policy from `/admin/market-data/AU/instruments` by opening an instrument drawer, setting the provider symbol, and saving the quote fallback policy. AU defaults to `<ticker>.AU`, for example `ETPMAG.AU`.

Runtime behavior:
- Normal dashboard, portfolio, report, and ticker reads never call EODHD. They only read cached snapshots.
- The quote-fallback worker scans active policies and refreshes after the market is closed according to existing trading-calendar/session helpers.
- Manual refresh enqueues the same worker path and writes an audit row with `quote_fallback_manual_refresh_requested`.
- If the strict local budget is exhausted, refreshes are blocked locally and the policy records `rate_limited`; no outbound call is attempted.
- While a policy is active, Yahoo intraday and Yahoo daily display prices are suppressed for that ticker. The cached EODHD `close` is used as the trusted current valuation close.
- If fallback daily change is stale or unavailable, portfolio aggregate daily change is marked stale/unavailable instead of being partially computed.

Operational checks:

```sql
-- Active fallback policies
SELECT market_code, ticker, provider_symbol, active, last_refresh_status, last_refresh_at, last_refresh_error
FROM market_data.quote_fallback_policies
WHERE active = TRUE
ORDER BY market_code, ticker;

-- Latest cached fallback close
SELECT p.market_code, p.ticker, s.market_date, s.close, s.previous_close, s.currency, s.fetched_at
FROM market_data.quote_fallback_policies p
LEFT JOIN LATERAL (
  SELECT *
  FROM market_data.quote_fallback_snapshots s
  WHERE s.policy_id = p.id
  ORDER BY s.market_date DESC
  LIMIT 1
) s ON TRUE
WHERE p.active = TRUE
ORDER BY p.market_code, p.ticker;

-- Daily EODHD budget usage
SELECT budget_date, call_count, updated_at
FROM market_data.eodhd_call_budget_usage
ORDER BY budget_date DESC
LIMIT 10;
```

Rollback:
- Deactivate the affected policy from the instrument drawer to restore normal Yahoo display-price selection.
- To disable EODHD globally without deleting policy rows, clear the encrypted key and unset `EODHD_API_KEY`; refreshes will fail safely while reads continue to use existing cache only when a policy remains active.
- Migration rollback is additive-table cleanup only: drop `market_data.quote_fallback_snapshots`, `market_data.quote_fallback_policies`, `market_data.eodhd_call_budget_usage`, and the `app_config` EODHD columns after deactivating policies.

### History start

AU bar history starts from `1988-01-28` (BHP.AX `meta.firstTradeDate`). Trade dates predating this are truncated with a `pre_provider_history_truncated` log entry; the trade itself is accepted and persisted normally.

### Backfill queue observability

AU backfill jobs run on the same `finmind-backfill` queue as TW and US jobs. To check AU-specific job health:

```sql
SELECT state, count(*)
FROM pgboss.job
WHERE name = 'finmind-backfill'
  AND data->>'marketCode' = 'AU'
GROUP BY state
ORDER BY state;
```

Failed AU jobs set `market_data.instruments.bars_backfill_status = 'failed'`. Check API logs for `backfill_metadata_fetch_failed` (warn-and-continue; bars may have landed even if Yahoo `quote()` enrichment failed) and `backfill_failed` (full job failure; no bars or dividends).

### Search endpoint observability

The `GET /market-data/search` route logs:
- `search_provider_error` (warn) — Yahoo provider error, non-`RateLimitedError`. Response has `X-Search-Degraded: true` header and `503`.
- Per-IP rate-limit breach returns `429 rate_limit_exceeded`. Provider budget exhaustion returns `503 provider_rate_limited` with `Retry-After` header.

A `search_provider_error` spike (>3 occurrences per minute) may indicate Yahoo search endpoint breakage (see issue #967 in `gadicc/yahoo-finance2`). If sustained, consider setting `AU_PROVIDER_MOCK=true` temporarily and opening the EODHD upgrade process.

---

## 20. KZO-189 deploy notes — Metadata Enrichment Gate

### Migration

`045_kzo189_metadata_enrichment_mode.sql` adds a `metadata_enrichment_mode TEXT NULL` column to `app_config` with a CHECK constraint (`'unconditional'` or `'conditional'`). `NULL` means "use `METADATA_ENRICHMENT_MODE` env var fallback." Idempotent (`ADD COLUMN IF NOT EXISTS`). No data backfill required.

### Metadata Enrichment Mode

**Setting location:** Admin Settings page (`/admin/settings`) → "Metadata Enrichment Mode" select, or `METADATA_ENRICHMENT_MODE` env var.

**Valid values:** `unconditional` (always enrich) | `conditional` (skip on `daily_refresh` trigger). Default: `conditional`.

**When to change:**
- Set to `unconditional` if you need to force metadata re-enrichment on the next daily refresh pass (e.g., after a bulk instrument import where metadata is stale).
- Keep `conditional` (default) under normal operation to preserve Yahoo Finance API budget — daily refreshes only update price bars, not instrument metadata.

**Yahoo budget pressure signal:** Frequent `backfill_rate_limited` warnings in logs on a per-instrument basis (not just the shared budget) may indicate enrichment is running more often than needed. Confirm `mode = conditional` is set.

**Auditing a change:** Filter `audit_log` by `action = 'app_config_updated'` and inspect `metadata.before.metadataEnrichmentMode` and `metadata.after.metadataEnrichmentMode`.

**Rollback:** Set `METADATA_ENRICHMENT_MODE=unconditional` in env (or set DB column to `unconditional` via admin UI) to restore pre-KZO-189 behavior. Change is passive — applies to future jobs only, no replay needed.

---

## 21. KZO-177 deploy notes — Provider Health Monitoring

### Migration

`046_kzo177_provider_health.sql` adds two tables in the `market_data` schema:

- `market_data.provider_health_status` — one row per provider, tracks timestamps, current status, and notification suppression keys.
- `market_data.provider_error_trail` — append-only error log per provider; indexed on `(provider_id, occurred_at DESC)`.

Both tables are created with `CREATE TABLE IF NOT EXISTS`. Provider rows are pre-seeded in `provider_health_status` (initial `status='down'`) via `ON CONFLICT DO NOTHING`; later migrations add AU catalog/GICS and KR rows. No destructive rewrite or backfill. Safe to re-run.

**Rollback impact:** Older API images are unaware of these tables and will leave them empty. The new admin page will 404 (old routing) or show empty state. The backfill/FX workers will fail silently if they reference the missing `getProviderHealthStatus` method — ensure old code is never deployed against this migration without the matching API image.

### Provider Health Monitoring

**Admin UI location:** `/admin` → Providers

The providers page shows real-time health status for the market-data providers this app uses:

| Provider ID | Markets covered |
|---|---|
| `finmind-tw` | TW equity bars + dividends |
| `finmind-us` | US equity bars + dividends |
| `yahoo-finance-au` | AU equity bars + metadata |
| `twelve-data-au` | AU catalog sync |
| `asx-gics-csv` | AU GICS enrichment |
| `yahoo-finance-kr` | KR equity bars + metadata |
| `twelve-data-kr` | KR catalog sync |
| `frankfurter` | FX rates (TWD, USD, AUD, KRW crosses) |

#### Status semantics

| Status | Meaning | Badge color |
|---|---|---|
| `healthy` | Last successful run is current (≥ latest settled trading day) AND no errors in past 24 h | Green |
| `degraded` | Last successful run is current, but ≥ 1 error in past 24 h | Amber |
| `down` | Last successful run is older than the latest settled trading day (or never ran) | Red |

"Latest settled trading day" is resolved from the KZO-173 trading calendar (TWSE, NYSE, ASX, or weekday-only FX calendar). A provider transitions to `down` only when market data was expected but absent — weekend and holiday gaps never trigger `down`.

#### Admin notifications

Notifications are posted to all admin users when:

- **Provider transitions to `down`:** a `provider_down` notification is fanned out at most once per 24 h per provider (suppressed by `last_down_notification_at`). Notification severity: `error`.
- **Provider recovers from `down`:** a `provider_recovered` notification fires on the first successful run that brings the provider out of `down`. Uses a compare-and-swap on `last_down_notification_at` to prevent duplicate fires from concurrent workers. Notification severity: `info`.

Notifications on `degraded` transitions are intentionally suppressed — `degraded` is informational and does not require immediate operator action.

#### Market-data Admin Console

The admin UI surface is the market-data console at `/admin/market-data`. Use the market workspaces to diagnose provider errors, inspect instrument support/backfill state, preview guarded backfill and purge operations, and review provider-scoped operations/logs without leaving the market-first workflow. Provider-scoped `/admin/providers/:providerId/*` APIs remain backend/back-compatible execution surfaces, not the primary UI destination.

Provider fixer flow:

1. **Diagnose:** reads durable unresolved items plus provider error history and shows unresolved counts by provider/market.
2. **Preview:** stores a query-backed operation with match count, sample rows, snapshot hash, preview token, and expiry. KR samples use Twelve Data catalog evidence to propose `.KS` / `.KQ`, then verify the sample candidate against Yahoo before showing it as verified.
3. **Execute:** requires the preview token and acknowledgement. Dangerous scopes also require the typed confirmation shown in the preview. Provider-scoped Execute returns `202`, marks the operation running, completes work in the background, and writes only Yahoo-verified KR mappings to `market_data.provider_resolution_mappings`. KR mapping repair is mapping-only; any KR bars/dividends backfill is a separate explicit market-data backfill action.
4. **Audit/logs:** each preview/execute/control action writes a `provider_fixer_operation` audit row and a provider operation log row.

Guardrail settings live in `/admin/settings?tab=provider-health`:

| Setting | Purpose |
|---|---|
| Provider Fixer dangerous match threshold | Match count at or above this requires typed confirmation |
| Provider Fixer preview sample limit | Maximum sample rows stored/displayed per preview |
| Provider Fixer UI page size | Default page size for fixer tables |
| Provider Fixer auto-pause failures/min | Threshold reserved for worker-level auto-pause controls |
| Provider Fixer preview token TTL | Preview-token expiry in minutes |

KR binding details:

- Canonical KR catalog tickers stay bare KRX codes such as `005930`.
- Twelve Data catalog evidence provides deterministic suffix hints: `KOSPI` / `KRX` / `XKRX` → `.KS`, `KOSDAQ` / `XKOS` → `.KQ`.
- The hint alone is not durable truth. Provider Fixer verifies the candidate through Yahoo (`quote_first` or `chart_probe_v1`) before persisting a mapping.
- `YahooFinanceKrMarketDataProvider` consults `provider_resolution_mappings` first, then falls back to catalog hints and the current probing modes.

Current limitation: Provider Fixer pause/resume/cancel endpoints update Provider Fixer operation rows. They do not kill an already-running pg-boss backfill worker. Legacy pg-boss batch cancellation is intentionally not exposed until it can avoid stale active-operation locks.

Rollback/recovery:

- Reverting the UI/API change leaves already-written `provider_resolution_mappings` rows in place. They are safe to keep; the KR provider treats them as preferred bindings.
- To undo a bad KR binding, delete the specific mapping row, then rerun Provider Fixer preview before re-executing:

```sql
DELETE FROM market_data.provider_resolution_mappings
WHERE provider_id = 'yahoo-finance-kr'
  AND market_code = 'KR'
  AND source_symbol = '<bare_krx_ticker>';
```

- KR backfill jobs are not automatically enqueued by mapping repair. If an admin explicitly started KR backfill after mapping, those jobs are idempotent daily-bar/dividend upserts. Let them finish unless the broader pg-boss queue is unhealthy.

#### Back-compatible Re-run API

`POST /admin/providers/:providerId/rerun` remains as a temporary API surface for existing tests and external callers. The admin UI should use `/admin/market-data` market actions for provider repair/backfill/purge flows. The route dispatches provider-wide refresh jobs:

- **`finmind-tw`:** enqueues daily-refresh for the TW market (all monitored TW tickers).
- **`finmind-us`:** enqueues daily-refresh for the US market.
- **`yahoo-finance-au`:** dispatches a **union** of (a) catalog warm-up over `market_data.instruments WHERE market_code='AU' AND bars_backfill_status IN ('pending','failed') AND delisted_at IS NULL`, and (b) daily-refresh for all monitored AU tickers. On a fresh deploy this enqueues ~2,400 backfill jobs. See §25 for the full fresh-deploy warm-up runbook.
- **`yahoo-finance-kr`:** dispatches the same union for KR instruments and monitored KR tickers. Canonical KR tickers stay bare KRX codes; the provider resolves `.KS` / `.KQ` suffixes internally.
- **`frankfurter`:** enqueues an FX-refresh job for all stored currency bases.
- **`twelve-data-au`:** re-syncs the AU instrument catalog from Twelve Data (metadata only, no bars).
- **`twelve-data-kr`:** re-syncs the KR instrument catalog from Twelve Data (metadata only, no bars).
- **`asx-gics-csv`:** re-runs the ASX GICS sector + industry-group enrichment from the S&P/ASX CSV.

**Per-provider cooldown (KZO-197/KR):** the cooldown is per-provider. Yahoo market providers (`yahoo-finance-au`, `yahoo-finance-kr`) default to **30 minutes** (DB-tunable via `app_config.yahoo_au_rerun_cooldown_ms`). All other providers default to **60 seconds**. A click inside the cooldown window returns `429 rate_limit_exceeded` with `Retry-After: <cooldown_seconds>`. The active cooldown value is visible through market-data action metadata and remains present in the back-compatible `/admin/providers` DTO as `rerunCooldownMs`.

**KR resolver repair guardrail:** `quote_first` is the safe default for KR admin reruns. `chart_probe_v1` is a repair mode for unresolved KR symbols; it probes Yahoo chart data across `.KS` / `.KQ` candidates and may increase upstream calls. The back-compatible API rejects `chart_probe_v1` unless `resolverModeRiskAccepted=true`, and resolver-mode payloads are rejected for non-KR providers.

**Audit log:** every Re-run now click writes an `audit_log` row with `action = 'provider_health_rerun'`, `targetType = 'provider'`, `targetId = providerId`, and `metadata: { tickerCount, marketCode }`. For Yahoo market providers, the metadata also includes nested `catalogBackfill: { tickerCount, jobId }` and `monitoredRefresh: { tickerCount, jobId }` blocks (top-level `tickerCount` = sum; back-compat). Visible at `/admin/audit-log`.

**Existing `/admin/fx-rates/refresh` is NOT deprecated** — it remains the path for targeted date-range FX backfills. Re-run now triggers a full current-day FX refresh.

#### User repair vs admin Re-run

| | User repair (`/backfill/retry`, `/backfill/repair`) | Admin Re-run |
|---|---|---|
| Scope | Per-user, per-ticker | Provider-wide (all monitored tickers for that market) |
| Auth required | Any authenticated user | Admin only |
| Typical use | One ticker missing data after a manual trade entry | Provider-wide data lag (e.g., provider outage recovery) |
| Audit | No audit log | `provider_health_rerun` audit entry |
| Cooldown | Per-ticker cooldown (`REPAIR_COOLDOWN_MINUTES`) | Per-provider (60 s most providers; 30 min for Yahoo market providers) |

#### Error trail

The `market_data.provider_error_trail` table stores up to 10 recent errors per provider in the admin UI. Error classes:

| Class | When used |
|---|---|
| `rate_limit` | Provider returned HTTP 429 or the self-imposed rate-limit guard fired |
| `http_4xx` | Provider returned a 4xx error (excluding 429) |
| `http_5xx` | Provider returned a 5xx error |
| `network` | Network-level failure (connection refused, timeout) |
| `parse` | Response body did not match expected schema |
| `other` | Catch-all for unclassified errors |

Note: `rate_limit` entries do **not** change the provider status — rate limits are expected transient events and do not count toward the error threshold that triggers `degraded` or `down`. They are logged separately to aid capacity planning.

**Retention:** trail rows older than 30 days are pruned daily by an in-process `setInterval`-based purge registered by `registerProviderErrorTrailPurge(app)`. The purge runs every 24 hours and logs `provider_error_trail_purged` (info) on success, `provider_error_trail_purge_failed` (warn) on error. No pg-boss job — this is a host-process sweep, not a scheduled queue job.

#### Stale-data badge on Holdings

Holdings rows in the dashboard now carry a `freshness` field (`current` | `stale_amber` | `stale_red`) computed server-side from the latest bar date for each ticker:

| `freshness` | Condition | Badge |
|---|---|---|
| `current` | `daysBehind ≤ 0` | Hidden |
| `stale_amber` | `daysBehind = 1` | Amber chip |
| `stale_red` | `daysBehind ≥ 2` (or no bar data at all) | Red chip |

"Days behind" is computed in trading days via `tradingDaysBetween(latestBarDate, latestSettledTradingDay, market)`. Manual/unsupported instruments (no resolvable `marketCode`) always show `current` with no badge.

The badge is **hidden** on the anonymous share view (`/share/[token]`) — the `showFreshnessBadge` prop defaults to `false` there, and the DTO server-side sets `freshnessTooltip = null` as defense-in-depth.

#### Operational checks

```sql
-- Check provider health rows
SELECT provider_id, status, last_successful_run, last_failed_run, updated_at
FROM market_data.provider_health_status
ORDER BY provider_id;

-- Check recent error trail for a specific provider
SELECT occurred_at, error_class, error_message
FROM market_data.provider_error_trail
WHERE provider_id = 'finmind-tw'
ORDER BY occurred_at DESC
LIMIT 20;

-- Count trail rows per provider
SELECT provider_id, COUNT(*) AS trail_count, MAX(occurred_at) AS latest
FROM market_data.provider_error_trail
GROUP BY provider_id
ORDER BY provider_id;
```

If a provider is stuck in `down` after a genuine recovery:
1. Check `last_successful_run` — if it's current (≥ today's settled trading day), the status will update on the next worker run.
2. Trigger the provider refresh from `/admin/market-data` for the affected market, or use the back-compatible `POST /admin/providers/:providerId/rerun` API if operating from scripts.
3. Watch API logs for `provider_health_outcome_recorded` (info) confirming the success outcome was processed.

---

## 22. KZO-198 deploy notes — Hybrid env+app_config for Tier A constants

### Deployment prerequisite: `APP_CONFIG_ENCRYPTION_KEY`

**Required** in all non-test runtimes (`NODE_ENV !== "test"`). The API will fail at boot with a clear error message if absent:

```
Error: APP_CONFIG_ENCRYPTION_KEY is required (64 lowercase hex chars).
Generate with `openssl rand -hex 32`.
```

**Primary path — `npm run env:setup`:**

```bash
npm run env:setup
```

The interactive setup wizard prompts "Auto-generate APP_CONFIG_ENCRYPTION_KEY?" (defaults yes). Answering yes generates a cryptographically random 64-hex key and writes it to `.env.local` automatically; the value is masked in the summary display. This is the recommended path for local development and for initialising a new deployment environment.

**Manual fallback (CI / headless environments):**

```bash
openssl rand -hex 32
```

This prints a 64-character lowercase hex string. Add it to the deployment environment (Docker env, `.env.prod`, Kubernetes secret, etc.) as `APP_CONFIG_ENCRYPTION_KEY=<value>`.

**Properties:**

| Property | Value |
|---|---|
| Algorithm | AES-256-GCM |
| Key material | Raw 32 bytes encoded as 64 lowercase hex chars |
| Rotation | Requires a re-encrypt migration (see [Key rotation note](#key-rotation-note) below) |
| Test exemption | `NODE_ENV=test` skips this validation; test workers use `PERSISTENCE_BACKEND=memory` |

### Migration

`047_kzo198_app_config_tier_a_constants.sql` adds 19 nullable columns to the `app_config` singleton row:

- **2 Tier 0** (`TEXT NULL`) — `finmind_api_token`, `twelve_data_api_key` — encrypted at rest as `nonce_b64:ciphertext+tag_b64`.
- **12 Tier 1** (`INT` / `BIGINT NULL`) — admin-editable via `/admin/settings`; `NULL` falls back to the matching env var.
- **5 Tier 2** (`INT` / `BIGINT NULL`) — DB-only escape hatch; no admin UI; `NULL` falls back to the matching env var.

No CHECK constraints were added (SQL escape hatch preserved). All columns are nullable — backward compatible with old API images.

`101_quote_fallback_eodhd.sql` extends the same pattern with `eodhd_api_key` (Tier 0 encrypted secret) and `eodhd_daily_call_limit` (Tier 1 admin-editable budget, defaulting to `EODHD_DAILY_CALL_LIMIT`).

### Admin UI — Tier 1 knobs

Navigate to **`/admin` → Settings** to adjust the following levers. Changes take effect on the next resolver read (≤ 8 s TTL cache propagation).

As of KZO-199, the Settings page is organised into **five tabs** (`?tab=<slug>` URL state). The default tab when no `?tab` query is present is **`rate-limits`**.

**Tab: Rate Limits** (`?tab=rate-limits`)
- Market data price: window (ms) and per-window cap
- Market data search: window (ms)
- Invite status: window (ms) and per-window cap

**Tab: Sharing** (`?tab=sharing`) — *added in KZO-199*
- Anonymous-share token cap (max active tokens per owner)
- Anonymous-share rate-limit max (requests per window, per IP)
- Anonymous-share rate-limit window (ms)

**Tab: Provider Health** (`?tab=provider-health`)
- Down-notification suppression (ms)
- Error trail retention (days)
- Re-run cooldown (ms) — generic, all providers except yahoo-finance-au
- Yahoo-AU re-run cooldown (ms)

**Tab: Backfill & Repair** (`?tab=backfill-repair`)
- Retry limit (count)
- Retry delay (seconds)
- FinMind 402 retry delay (ms)
- Repair cooldown (minutes)

**Tab: Catalog & Metadata** (`?tab=catalog-metadata`)
- Catalog absence threshold (consecutive missed syncs before delisting)
- Absence guard percent (max % of catalog removable per sync)
- Absence guard floor (minimum removable count regardless of percent)
- Metadata enrichment mode (`unconditional` or `conditional`)

**Tab: Provider Keys** (`?tab=provider-keys`)
- FinMind API token
- Twelve Data API key
- EODHD API key
- EODHD daily call limit

Each field has a "Reset to default (NULL)" button that clears the DB override and causes the resolver to fall back to the env var default.

### Tier 0 key rotation procedure

Rotating a FinMind, Twelve Data, or EODHD API key:

1. Navigate to **`/admin` → Settings → Provider Keys**.
2. Click **Rotate** on the relevant key field.
3. The masked input (`••••••••`) shows the current state (set or unset). The existing value is **never displayed**.
4. Enter the new API key (20–500 characters). The field shows a character count.
5. Click **Save**. The API validates length, encrypts with AES-256-GCM using `APP_CONFIG_ENCRYPTION_KEY`, and writes the `nonce:ciphertext+tag` to the DB column.
6. The cache is invalidated immediately; all provider fetches within 8 s will re-read and decrypt the new value.

**Audit trail:** the audit log records `metadata: { type: "rotation", field: "finmind_api_token" | "twelve_data_api_key" | "eodhd_api_key", actorUserId }`. The plaintext value is **never** stored in the audit log.

To clear a key (force env-fallback): click **Rotate** → leave the input blank → click **Clear** (submits `null`, which sets the column to NULL and forces env-fallback on the next read).

### Tier 2 SQL escape hatch

The Tier 2 fields are not in the admin UI. Adjust them directly via SQL on the `app_config` singleton (id = 1). The API's TTL cache picks up the change within 8 s of the SQL write — no restart required.

**KZO-198 Tier 2 fields:**

```sql
-- Daily-refresh lookback window (days)
UPDATE app_config SET daily_refresh_lookback_days = 14, updated_at = NOW() WHERE id = 1;

-- pg-boss daily-refresh job priority (higher = runs sooner)
UPDATE app_config SET daily_refresh_priority = 20, updated_at = NOW() WHERE id = 1;

-- SSE keepalive heartbeat interval (ms)
UPDATE app_config SET sse_heartbeat_interval_ms = 15000, updated_at = NOW() WHERE id = 1;

-- Max concurrent SSE connections per user
UPDATE app_config SET sse_max_connections_per_user = 10, updated_at = NOW() WHERE id = 1;

-- BufferedEventBus per-user event TTL (ms)
UPDATE app_config SET sse_buffer_default_ttl_ms = 30000, updated_at = NOW() WHERE id = 1;

-- Reset any KZO-198 Tier 2 field to env-fallback
UPDATE app_config SET sse_heartbeat_interval_ms = NULL, updated_at = NOW() WHERE id = 1;
```

**KZO-199 Tier 2 fields** (added by migration 052):

```sql
-- How long a revoked/expired anonymous share token remains listable (ms)
-- Default: 2592000000 (30 days). Bounds: [86400000 (1d), 31536000000 (365d)]
-- ⚠ Retention coupling: keep ≤ ANONYMOUS_SHARE_TOKEN_PURGE_DAYS × 86400000
--   to preserve UI visibility guarantee — purge cron deletes rows the UI would otherwise surface.
UPDATE app_config SET anonymous_share_token_retention_ms = 604800000, updated_at = NOW() WHERE id = 1;
-- (example: set to 7 days = 604800000 ms)

-- Max body size (bytes) for PATCH /user-preferences
-- Default: 8192. Bounds: [256, 1048576]. Fastify bodyLimit is fixed at 1 MiB (the bound ceiling).
UPDATE app_config SET user_preferences_max_bytes = 65536, updated_at = NOW() WHERE id = 1;
-- (example: raise to 64 KiB)

-- Reset any KZO-199 Tier 2 field to env-fallback
UPDATE app_config SET anonymous_share_token_retention_ms = NULL, updated_at = NOW() WHERE id = 1;
UPDATE app_config SET user_preferences_max_bytes = NULL, updated_at = NOW() WHERE id = 1;
```

**Note:** SQL writes do **not** stamp an audit_log entry. If audit trail is required, use the admin UI (Tier 1 fields only).

### Decryption-failure troubleshooting

If the API log shows:

```
app_config_decrypt_failed  { field: "finmind_api_token", reason: "tag_mismatch" }
```

This means the `APP_CONFIG_ENCRYPTION_KEY` in the current deployment does not match the key used to encrypt the stored ciphertext.

**Behavior during failure:** the resolver falls back to `Env.FINMIND_API_TOKEN`, `Env.TWELVE_DATA_API_KEY`, or `Env.EODHD_API_KEY` transparently. Provider fetches continue using the env var value. No panic, no outage.

**Recovery options:**

1. **Restore the original key** — if the env key was accidentally rotated, restore the correct 64-hex value to `APP_CONFIG_ENCRYPTION_KEY` and redeploy. The stored ciphertext remains valid.

2. **Re-rotate via admin UI** — navigate to `/admin` → Settings → Provider Keys → Rotate. Enter the new API key. This re-encrypts with the current `APP_CONFIG_ENCRYPTION_KEY`.

3. **Clear the stored value** — if the correct key cannot be recovered, use the Rotate modal → Clear button to set the column to NULL and rely on `Env.*` until a fresh rotation is performed.

**Reason codes:**

| `reason` | Meaning |
|---|---|
| `tag_mismatch` | Authentication tag check failed — key mismatch or ciphertext corrupted |
| `bad_key` | `APP_CONFIG_ENCRYPTION_KEY` is malformed (wrong length or non-hex chars) |
| `malformed_input` | Stored value does not have the expected `nonce_b64:ct+tag_b64` format |

### Key rotation note

`APP_CONFIG_ENCRYPTION_KEY` rotation (changing the env var to a new 64-hex key) requires re-encrypting all Tier 0 secrets stored in `app_config` before the new key is deployed. A re-encrypt migration is **out of scope** for KZO-198 and is tracked as a future ticket.

**Do not change `APP_CONFIG_ENCRYPTION_KEY` without a re-encrypt migration.** Doing so will cause `tag_mismatch` decryption failures until the admin re-rotates the API keys via the UI. The env-fallback path is safe, but the DB ciphertexts become unreadable.

### Tier 3 cron schedules

The 3 cron env vars are Tier 3 (env-only, restart-required to change) and are fully wired to their respective workers:

| Env var | Default | Schedule | Worker |
|---|---|---|---|
| `CATALOG_SYNC_CRON` | `"30 17 * * 1-5"` | Weekdays 17:30 UTC | `registerCatalogSyncWorker.ts` |
| `FX_REFRESH_CRON` | `"0 22 * * *"` | Daily 22:00 UTC | `fxRefreshWorker.ts` |
| `ANONYMOUS_SHARE_TOKEN_PURGE_CRON` | `"0 4 * * *"` | Daily 04:00 UTC | `registerAnonymousShareTokenPurgeWorker.ts` |

Overriding any of these in the deployment environment changes the effective cron schedule on the next deploy/restart.

> **Quoting requirement:** cron strings contain spaces and **must be double-quoted** in `.env` files. The `npm run env:setup` generator handles this automatically. Manually authored `.env*` files (e.g. `.env.prod`) must quote all cron values — for example `CATALOG_SYNC_CRON="30 17 * * 1-5"` — or bash sourcing (`set -a; source .env.local`) will fail with `command not found` errors.

### Audit log queries

```sql
-- See all app_config_updated entries with type discriminator
SELECT
  id,
  actor_user_id,
  created_at,
  metadata->>'type' AS audit_type,
  metadata->'before' AS before_val,
  metadata->'after' AS after_val,
  metadata->>'field' AS rotated_field
FROM audit_log
WHERE action = 'app_config_updated'
ORDER BY created_at DESC
LIMIT 20;

-- Check current Tier 0 column state (columns are encrypted — values are opaque)
SELECT
  finmind_api_token IS NOT NULL AS finmind_key_set,
  twelve_data_api_key IS NOT NULL AS twelve_data_key_set,
  updated_at
FROM app_config WHERE id = 1;

-- Check current Tier 1 effective values (NULL = using env fallback)
SELECT
  market_data_price_window_ms,
  market_data_price_limit,
  market_data_search_window_ms,
  invite_status_window_ms,
  invite_status_limit,
  provider_down_notification_suppression_ms,
  provider_error_trail_retention_days,
  provider_rerun_cooldown_ms,
  backfill_retry_limit,
  backfill_retry_delay_seconds,
  backfill_finmind_402_retry_ms
FROM app_config WHERE id = 1;
```

---

## 23. KZO-195 deploy notes — ASX Delisting Detection

### Migration

`049_kzo195_absence_delisting_detection.sql` adds:

- **Three columns to `market_data.instruments`:**
  - `last_seen_in_catalog_at TIMESTAMP NULL` — stamped each sync run for instruments present in a diff-enabled Twelve Data catalog. `NULL` = LIC, manually-added instrument, or untracked legacy row; these are **never** absence candidates.
  - `absence_streak INTEGER NOT NULL DEFAULT 0` — consecutive missed catalog appearances. Reset to `0` when the instrument re-appears.
  - `delisting_detection_excluded BOOLEAN NOT NULL DEFAULT FALSE` — admin-set exclusion flag; excluded instruments are never bumped or stamped.

- **Three columns to `app_config`** (Tier 1 — admin-editable): `catalog_absence_threshold INT`, `catalog_absence_guard_percent NUMERIC(5,2)`, `catalog_absence_guard_floor INT`.

- **Backfill:** `last_seen_in_catalog_at` is backfilled from `updated_at` for existing AU non-provisional instruments. TW/US rows are left `NULL` (outside the detection scope at the time of KZO-195). KR rows start being stamped when the KR catalog provider runs.

- **`audit_log_action_check` constraint extended** with two new action codes: `instrument_undelete`, `instrument_exclusion_toggle`.

Safe to re-run (columns added with `ADD COLUMN IF NOT EXISTS`). No destructive operations. No down migration.

### How absence detection works (AU/KR)

Each catalog-sync run for a diff-enabled Twelve Data catalog provider:

1. Present instruments are bulk-upserted and have `last_seen_in_catalog_at` stamped to `NOW()` and `absence_streak` reset to `0`.
2. Absent instruments (had `last_seen_in_catalog_at IS NOT NULL` before this run, not in the current catalog) are collected.
3. Excluded instruments (`delisting_detection_excluded = TRUE`) and LICs (`last_seen_in_catalog_at IS NULL`) are **removed from candidates**.
4. Mass-delisting guard evaluated: if `candidates > max(guardFloor, prevCatalogSize × guardPercent / 100)` — the guard trips, no bumps/stamps occur, a `warning` admin notification fires.
5. If guard does not trip: each candidate's `absence_streak` is incremented. Candidates whose `absence_streak + 1 >= threshold` have `delisted_at` stamped (`status_reason = 'absence_detected'`); an `instrument_undelete` audit row is written per stamped ticker.

**TW and US are unaffected** — they use `supportsDelistingFeed=true` (TW) and `absenceDetectionEnabled=false` (US) respectively. See transition note §1 for the full capability flag taxonomy.

### Threshold tuning

Default values (env vars):

| Env var | Default | Meaning |
|---|---|---|
| `CATALOG_ABSENCE_THRESHOLD` | `3` | Runs absent before auto-delisting |
| `CATALOG_ABSENCE_GUARD_PERCENT` | `1.0` | % of catalog that triggers the mass-delisting guard |
| `CATALOG_ABSENCE_GUARD_FLOOR` | `5` | Minimum absent instruments to trip the guard |

**Adjust via admin UI:** Navigate to `/admin` → **Settings** → **Catalog Absence** section. Changes take effect on the next sync run (TTL cache ≤ 8 s). The **Reset to default (NULL)** button restores the env-var tier.

**Adjust via env var:** set in `.env.prod` / deployment env and restart. Cron strings are unaffected (absence detection shares the existing `CATALOG_SYNC_CRON`).

### Runbook: Mass-delisting guard tripped

**Symptom:** Admin notification `severity=warning, source=delisting_detector` reading "Mass-delisting guard tripped (M absent of N catalog rows). No instruments auto-delisted."

**What happened:** The Twelve Data API returned a catalog with more than `max(guardFloor, prevCatalogSize × guardPercent / 100)` absent instruments in a single run. No streaks were bumped and no instruments were stamped. The upsert (for present instruments) still committed.

**Investigation steps:**

1. **Check if the API returned a partial catalog.** Query:
   ```sql
   SELECT COUNT(*) FROM market_data.instruments
   WHERE market_code IN ('AU', 'KR') AND last_seen_in_catalog_at >= NOW() - INTERVAL '1 hour';
   ```
   If this count is significantly below the normal ~2,439, the API likely returned a truncated response.

2. **Check API logs** for `catalog_sync_provider_error` or rate-limit warnings around the time of the notification.

3. **Wait for the next sync run.** The cron runs at `30 17 * * 1-5` (UTC). If the API is healthy on the next run, the guard will not trip again and normal streak tracking resumes. No instruments are harmed — the guard prevents false delistings.

4. **If persistent:** raise `CATALOG_ABSENCE_GUARD_PERCENT` or `CATALOG_ABSENCE_GUARD_FLOOR` temporarily via `/admin/settings` to allow the sync to proceed. Review notification again on the next run.

5. **If a genuine bulk exchange event occurred**: clear the guard by raising the threshold, then manually verify each absent ticker. AU/KR delisting override controls are tracked separately from support/retirement controls; until they are exposed in `/admin/market-data`, use an admin SQL runbook or a focused maintenance script to set `delisting_detection_excluded` for tickers that are legitimately still trading despite the API gap.

### Runbook: Instruments auto-delisted (info notification)

**Symptom:** Admin notification `severity=info, source=delisting_detector` listing auto-delisted tickers.

**Investigation:**

1. Navigate to `/admin/market-data/AU/instruments` or `/admin/market-data/KR/instruments` and filter by **Status: Delisted**.
2. For each ticker: verify against the exchange's official announcements. If the delisting is genuine, no action required.
3. **If false positive (instrument still trading):** use the AU/KR delisting override flow once exposed, or run the focused maintenance path that clears `delisted_at`, resets `absence_streak = 0`, sets `last_seen_in_catalog_at = NOW()`, and writes an audit row. The instrument will be re-evaluated on the next sync run.
4. **To prevent recurrence for a specific ticker:** set the delisting-detection exclusion after undeleting. The instrument will never be auto-delisted again until explicitly re-included.

### Runbook: When to undelete vs. exclude

| Situation | Action |
|---|---|
| Instrument still actively trading; single transient API gap caused the delisting | Undelete. The next sync will re-stamp it and reset the streak. |
| Instrument still trading; Twelve Data repeatedly drops it from the catalog | Undelete + Exclude. Prevents repeated false-positive notifications. |
| Instrument genuinely delisted from the exchange | Leave as delisted. No action needed. |
| LIC / manually-added instrument showing as delisted | Should not happen — LICs have `last_seen_in_catalog_at = NULL` and are never candidates. If it does appear, file a bug. |

### Admin UI location

`/admin` → **Market data** → affected market → **Instruments**. The workspace displays catalog instruments with their absence/delisting, support, and backfill state. Threshold knobs remain under `/admin/settings` for adjustments. AU/KR delisting override controls are separate from support/retirement controls and are tracked as a follow-up until exposed in the market workspace.

**Audit log:** all undelete and exclusion-toggle actions are visible at `/admin/audit-log` with action codes `instrument_undelete` and `instrument_exclusion_toggle`.

### Semantic note: `absent` counter vs. `absentTickers`

`CatalogSyncResult.absent` (visible in API logs) counts **all** absent instruments for that market in a sync run, including `delisting_detection_excluded = TRUE` rows. `absentTickers` (visible in admin notifications) contains only the non-excluded candidates. If logs show `absent=12` but the notification lists only 7 tickers, the delta (5) are excluded instruments. This is expected and intentional — the `absent` counter gives operators the full picture; `absentTickers` is the actionable subset.

### Operational queries

```sql
-- Check recent absence-stamped delistings
SELECT ticker, market_code, delisted_at, absence_streak, status_reason
FROM market_data.instruments
WHERE market_code = 'AU'
  AND delisted_at IS NOT NULL
  AND status_reason = 'absence_detected'
ORDER BY delisted_at DESC
LIMIT 20;

-- Check current streak state for AU instruments
SELECT ticker, absence_streak, last_seen_in_catalog_at, delisting_detection_excluded
FROM market_data.instruments
WHERE market_code = 'AU'
  AND absence_streak > 0
ORDER BY absence_streak DESC;

-- Check current threshold settings (NULL = using env-var default)
SELECT
  catalog_absence_threshold,
  catalog_absence_guard_percent,
  catalog_absence_guard_floor
FROM app_config WHERE id = 1;

-- Audit log for instrument management actions
SELECT actor_user_id, action, metadata->>'ticker' AS ticker, created_at
FROM audit_log
WHERE action IN ('instrument_undelete', 'instrument_exclusion_toggle')
ORDER BY created_at DESC
LIMIT 20;
```

## 24. KZO-196 deploy notes — AU GICS Sector Enrichment

### What ships

Migration `050_kzo196_gics_industry_group.sql` adds `gics_industry_group TEXT NULL` to `market_data.instruments` and `asx_gics_refresh_cron TEXT NULL` to `app_config`. The `asx-gics-csv` pg-boss worker enriches AU instruments with their S&P/MSCI GICS industry-group label from the ASX listed-companies CSV. The `InstrumentCatalogSheet` gains an AU-only sector dropdown for filtering by GICS sector.

### Cron schedule

| Setting | Value |
|---|---|
| Default schedule | `0 2 * * 0` (Sundays 02:00 UTC) |
| Env var | `ASX_GICS_REFRESH_CRON` |
| DB override | `app_config.asx_gics_refresh_cron` (NULL = use env; restart-required to take effect) |
| Singleton key | `asx-gics-sync` (concurrent run-now clicks coalesce) |

**Note:** unlike the catalog-sync cron, changing `app_config.asx_gics_refresh_cron` via the admin UI takes effect only after the next app restart — the schedule is read at boot during pg-boss queue registration, not per-tick.

### Admin run-now button

Navigate to `/admin` → **Providers** → locate the `asx-gics-csv` row → click **Run now**. The button enqueues the same singleton-keyed pg-boss job as the cron. Concurrent clicks coalesce; no duplicate runs will fire.

### Failure modes

| Failure | Error class | Behaviour |
|---|---|---|
| CSV HTTP failure / network timeout (30s) | `AsxGicsFetchError` | Worker marks `asx-gics-csv` provider as `down`; emits `gics_sync_failed` SSE; retries on next cron tick |
| CSV missing `GICS industry group` column | `AsxGicsParseError` | Same as above; logged with `columnName` for diagnosis |
| Parsed row count < 1 000 | sanity warn | Logged at `warn` level; sync proceeds; admin should investigate whether the ASX CSV source changed format |
| Parsed row count > 5 000 | sanity warn | Same; sync proceeds |

No audit log entry is written for cron-triggered runs (matches the sibling catalog-sync and FX-refresh cron behaviour). Admin run-now clicks write a `provider_health_rerun` audit row.

### First-run expectations

AU instruments will show `gics_industry_group = NULL` in the catalog until the first successful cron run (Sundays 02:00 UTC) or until an operator clicks **Run now**. The `InstrumentCatalogSheet` sector dropdown renders immediately but filtering results in zero rows until data is populated.

### Operational queries

```sql
-- Check GICS coverage for AU instruments
SELECT
  gics_industry_group,
  COUNT(*) AS count
FROM market_data.instruments
WHERE market_code = 'AU'
GROUP BY gics_industry_group
ORDER BY count DESC;

-- Check provider health for asx-gics-csv
SELECT status, last_successful_run, last_failed_run, error_count_24h, last_error_message
FROM market_data.provider_health_status
WHERE provider_id = 'asx-gics-csv';

-- Check current cron override (NULL = using env default)
SELECT asx_gics_refresh_cron FROM app_config WHERE id = 1;
```

### Rollback notes

- Migration 050's `UPDATE industry_category_raw = NULL WHERE market_code = 'AU'` is one-way. If rolled back, AU rows will have a NULL `industry_category_raw` column. This is benign — the column was populated with Twelve Data classifier values that were redundant with `instrument_type`, and the front-end does not rely on `industry_category_raw`.
- The `gics_industry_group` column is NULL-safe and removable via a new migration if the feature is reverted.
- To disable the cron without a rollback: delete the pg-boss schedule via `DELETE FROM pgboss.schedule WHERE name = 'asx-gics-sync'` (takes effect immediately; the queue handler remains registered but no new ticks fire).

---

## 25. KZO-197 deploy notes — AU fresh-deploy warm-up + `awaiting` status

### What ships

Migration `051_kzo197_yahoo_au_rerun_cooldown.sql` adds `yahoo_au_rerun_cooldown_ms BIGINT NULL` to `public.app_config` (default `NULL` = use `Env.YAHOO_AU_RERUN_COOLDOWN_MS`, which defaults to 1,800,000 ms = 30 min).

The `yahoo-finance-au` "Re-run now" button now dispatches a **union** of two disjoint sets:

1. **Catalog warm-up** — one backfill job per `market_data.instruments` row where `market_code='AU' AND bars_backfill_status IN ('pending','failed') AND delisted_at IS NULL`. These rows have never had bars fetched. Full history is fetched from `1988-01-28` (Yahoo's BHP.AX `firstTradeDate`). Composite singleton key `${ticker}:AU` prevents duplicates on double-click.
2. **Monitored refresh** — the existing `enqueueDailyRefresh({ marketFilter:'AU' })` path, refreshing only monitored AU tickers. This path was always present; on a fresh deploy where no AU tickers are monitored, it is a no-op that contributes `tickerCount=0`.

After bars data lands, each instrument's `bars_backfill_status` advances to `ready`, and subsequent "Re-run now" clicks produce zero catalog warm-up jobs (the warm-up branch short-circuits on an empty candidate set).

A new neutral-grey badge **"Awaiting first run"** (`awaiting` status) is shown for any provider whose `last_successful_run` and `last_failed_run` are both null. This is a route-layer projection — the `provider_health_status` table and its DB CHECK constraint are unchanged.

### AU fresh-deploy warm-up checklist

1. After deploying KZO-197 (or any fresh environment where the AU catalog has never backfilled), navigate to `/admin` → **Providers**.
2. The `yahoo-finance-au` row shows **"Awaiting first run"** (neutral grey) — expected; no backfill has run yet.
3. Click **Re-run now**. The response returns `tickerCount` = number of pending+failed AU instruments (~2,400 on a fully fresh catalog).
4. Monitor job queue depth:
   ```sql
   SELECT COUNT(*) AS active_jobs
   FROM pgboss.job
   WHERE name = 'finmind-backfill'
     AND data->>'marketCode' = 'AU'
     AND state = 'active';
   ```
5. At Yahoo's self-imposed 60/min ceiling, ~2,400 jobs complete in approximately **40 minutes** of wall-clock time.
6. Once the first job succeeds, `last_successful_run` is stamped and the badge updates to `healthy` (or `degraded`/`down` if errors occurred).

**Note:** the warm-up is operator-initiated. Auto-triggering on deploy is deferred to **KZO-203**.

### Per-provider cooldown

| Provider | Cooldown (default) | DB-tunable via |
|---|---|---|
| `yahoo-finance-au`, `yahoo-finance-kr` | 30 min (1,800,000 ms) | `app_config.yahoo_au_rerun_cooldown_ms` |
| All other providers | 60 s (60,000 ms) | `app_config.provider_rerun_cooldown_ms` (global, KZO-177) |

To adjust the Yahoo market cooldown without a redeploy:
```sql
UPDATE public.app_config
SET yahoo_au_rerun_cooldown_ms = 300000   -- 5 min, for example
WHERE id = 1;
```
The change takes effect on the next market-data/provider health read (including the back-compatible `GET /admin/providers` DTO). No restart required.

To reset to the env-default (30 min):
```sql
UPDATE public.app_config SET yahoo_au_rerun_cooldown_ms = NULL WHERE id = 1;
```

### Operational queries

```sql
-- Check AU warm-up progress
SELECT
  bars_backfill_status,
  COUNT(*) AS count
FROM market_data.instruments
WHERE market_code = 'AU'
GROUP BY bars_backfill_status
ORDER BY bars_backfill_status;

-- Check active AU backfill jobs
SELECT COUNT(*) AS active
FROM pgboss.job
WHERE name = 'finmind-backfill'
  AND data->>'marketCode' = 'AU'
  AND state = 'active';

-- Check yahoo-finance-au provider health
SELECT status, last_successful_run, last_failed_run,
       error_count_24h, last_manual_rerun_at
FROM market_data.provider_health_status
WHERE provider_id = 'yahoo-finance-au';

-- Check current AU cooldown override (NULL = using env default = 30 min)
SELECT yahoo_au_rerun_cooldown_ms FROM public.app_config WHERE id = 1;
```

### Rollback notes

- Migration 051 is additive (`ADD COLUMN IF NOT EXISTS ... NULL`). Rollback: `ALTER TABLE public.app_config DROP COLUMN IF EXISTS yahoo_au_rerun_cooldown_ms;`
- Reverting the PR restores the old "Re-run now" path (monitored-refresh only; no-op on fresh deploy). Any already-enqueued `finmind-backfill` jobs run to completion — they are idempotent upserts and are not cancelled on rollback.
- The `awaiting` badge reverts to `down` after PR revert (both states indicate no successful run; `down` is the pre-KZO-197 form).

---

## 26. KZO-199 deploy notes — Hybrid env+app_config for Tier B constants

KZO-199 extends the KZO-198 Tier A pattern to cover seven Tier B operational constants. No new infrastructure is introduced; all cache, audit-log, and PATCH-handler machinery is reused.

### Migration

`052_kzo199_app_config_tier_b_constants.sql` adds **5 nullable columns** to the `app_config` singleton row:

| Column | Type | Tier | Default (env fallback) |
|---|---|---|---|
| `anonymous_share_token_cap` | `INT NULL` | 1 — admin UI | `ANONYMOUS_SHARE_TOKEN_CAP` = 20 |
| `anonymous_share_rate_limit_max` | `INT NULL` | 1 — admin UI | `ANONYMOUS_SHARE_RATE_LIMIT_MAX` = 30 |
| `anonymous_share_rate_limit_window_ms` | `INT NULL` | 1 — admin UI | `ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS` = 300000 (5 min) |
| `anonymous_share_token_retention_ms` | `BIGINT NULL` | 2 — SQL only | `ANONYMOUS_SHARE_TOKEN_RETENTION_MS` = 2592000000 (30 d) |
| `user_preferences_max_bytes` | `INT NULL` | 2 — SQL only | `USER_PREFERENCES_MAX_BYTES` = 8192 (8 KiB) |

All columns are nullable and additive — backward compatible with prior API images.

Five Tier 3 (env-only, restart-required) Postgres/Redis pool/timing env vars are also added:

| Env var | Default | Wired to |
|---|---|---|
| `POSTGRES_POOL_MAX` | `20` | Main Postgres connection pool (`PostgresPersistence` constructor) |
| `BACKFILL_POSTGRES_POOL_MAX` | `2` | pg-boss Postgres pool (`plugins/pgBoss.ts`) |
| `POSTGRES_CONNECTION_TIMEOUT_MS` | `10000` | Main Postgres connection timeout (`PostgresPersistence` constructor) |
| `REDIS_CONNECTION_TIMEOUT_MS` | `10000` | Redis socket connection timeout (`PostgresPersistence` and `RedisEventBus`) |
| `REDIS_RECONNECT_MAX_RETRIES` | `3` | Max Redis socket reconnect retries before surfacing failure |

### Admin UI — Sharing tab

The new **Sharing tab** (`/admin/settings?tab=sharing`) surfaces the 3 Tier 1 sharing knobs:

- **Anonymous-share token cap** — max active tokens per owner. Raising this value takes effect immediately (next `POST /share-tokens` call). Bounds: 1–1000.
- **Anonymous-share rate-limit max** — requests per window per IP for anonymous-share endpoints. Bounds: 1–10000.
- **Anonymous-share rate-limit window (ms)** — sliding-window length for the rate limiter. Bounds: 1000–600000 (1 s to 10 min).

Each field has a "Reset to default (NULL)" button. Changes propagate within ≤ 8 s (TTL cache).

**Observability:**

```sql
-- Current Tier 1 anonymous-share knobs (NULL = env default active)
SELECT
  anonymous_share_token_cap,
  anonymous_share_rate_limit_max,
  anonymous_share_rate_limit_window_ms
FROM app_config WHERE id = 1;

-- Current active token count per owner (should never exceed cap)
SELECT owner_user_id, COUNT(*) AS active_count
FROM anonymous_share_tokens
WHERE revoked_at IS NULL AND expires_at > NOW()
GROUP BY owner_user_id
ORDER BY active_count DESC
LIMIT 10;
```

### Tier 2 sharing escape hatches

See §22 "Tier 2 SQL escape hatch → KZO-199 Tier 2 fields" for the SQL update commands.

**Retention coupling reminder:** `anonymous_share_token_retention_ms` must stay ≤ `ANONYMOUS_SHARE_TOKEN_PURGE_DAYS × 86400000`. The purge cron (daily 04:00 UTC) physically deletes terminal rows; if the retention window is longer than the purge window, the UI would attempt to surface tokens that no longer exist in the DB.

### Pool-size tuning

These Postgres/Redis env vars are **restart-required** — they are read once at startup, not per-request. The safe pool defaults (20 and 2) match the previous hardcoded values, both connection timeout defaults remain 10 seconds, and Redis retries are bounded to 3 attempts; no action is required on deploy.

The managed Postgres integration harness sets `POSTGRES_CONNECTION_TIMEOUT_MS` and `REDIS_CONNECTION_TIMEOUT_MS` from `CI_DB_CONNECT_TIMEOUT_SECONDS` (default: 10 seconds) and applies the Postgres value to direct test-created `pg.Pool` instances as well as `PostgresPersistence`. Direct test pools also retry transient connection-acquisition timeouts through the Vitest managed-Postgres setup hook. Host-mode detection polls all candidate Docker-published addresses round-robin so an unreachable first candidate does not stall startup before the reachable gateway/localhost address is selected. The managed Postgres Vitest gate runs with one worker because several integration specs reset schemas and create direct pools; the normal memory-backed API suite remains capped at four workers.

To tune:

1. Set `POSTGRES_POOL_MAX`, `BACKFILL_POSTGRES_POOL_MAX`, `POSTGRES_CONNECTION_TIMEOUT_MS`, `REDIS_CONNECTION_TIMEOUT_MS`, and/or `REDIS_RECONNECT_MAX_RETRIES` in the deployment environment.
2. Restart the API service.
3. Verify the pool size via `SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'vakwen%';`

### `/admin/settings` tab restructure

The Settings page is now organised into 5 tabs. Direct links:

- `/admin/settings?tab=rate-limits` — market data + invite-status rate limits
- `/admin/settings?tab=sharing` — anonymous-share token knobs *(KZO-199 new)*
- `/admin/settings?tab=provider-health` — provider health + rerun cooldowns
- `/admin/settings?tab=backfill-repair` — backfill retry + repair cooldown
- `/admin/settings?tab=catalog-metadata` — catalog absence detection + metadata enrichment mode

The default tab (no `?tab` query) is `rate-limits`. All existing per-field knobs are preserved; only the page layout changed.

### Rollback notes

- Migration 052 is additive (`ADD COLUMN IF NOT EXISTS ... NULL`). Rollback per-column: `UPDATE app_config SET <col> = NULL WHERE id = 1;` restores env-fallback immediately. Full schema rollback: `ALTER TABLE app_config DROP COLUMN IF EXISTS anonymous_share_token_cap, DROP COLUMN IF EXISTS anonymous_share_rate_limit_max, DROP COLUMN IF EXISTS anonymous_share_rate_limit_window_ms, DROP COLUMN IF EXISTS anonymous_share_token_retention_ms, DROP COLUMN IF EXISTS user_preferences_max_bytes;`
- Reverting the API image restores the flat settings page layout; the 5 new columns are ignored by older images.
- Postgres/Redis pool/timing env vars: removing `POSTGRES_POOL_MAX`, `BACKFILL_POSTGRES_POOL_MAX`, `POSTGRES_CONNECTION_TIMEOUT_MS`, `REDIS_CONNECTION_TIMEOUT_MS`, or `REDIS_RECONNECT_MAX_RETRIES` restores the schema defaults (20 / 2 / 10000 / 10000 / 3) after a restart.

---

## 27. ui-enhancement deploy notes — Account soft-delete and scheduled hard-purge cron

### What ships

Two-stage account deletion: a user-initiated soft-delete followed by a scheduled hard-purge cron. A "Permanently delete now" shortcut skips the grace period with a typed-name confirmation.

**Migrations:**

| File | Change |
|---|---|
| `053_uie_accounts_deleted_at.sql` | Adds `accounts.deleted_at TIMESTAMPTZ NULL` column + partial index `idx_accounts_deleted_at`. Replaces `ux_accounts_user_id_name` unique index with `ux_accounts_user_id_name_active` (partial — excludes soft-deleted rows) to allow name reuse after soft-delete. |
| `054_uie_app_config_account_hard_purge_days.sql` | Adds `app_config.account_hard_purge_days INT NULL` Tier-B column. |
| `055_uie_audit_log_account_actions.sql` | Extends `audit_log_action_check` CHECK constraint to include `account_soft_deleted`, `account_restored`, `account_hard_purged` action codes. |

Migrations 053 and 054 are additive (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Migration 055 uses DROP + recreate on the CHECK constraint (idempotent across re-runs).

### Account soft-delete and hard-purge operational model

**Soft-delete (user-initiated):**
- `DELETE /accounts/:id` stamps `accounts.deleted_at = NOW()`. Idempotent.
- Account-scoped data (trades, lots, cash-ledger, dividends) is preserved on disk.
- Every read path filters `WHERE accounts.deleted_at IS NULL` — the account disappears from all portfolio views immediately.
- Snapshot policy: filter-on-read for historical snapshots (`daily_holding_snapshots`, `currency_wallet_snapshots`). Past snapshots are **not** recomputed on delete or restore.

**Grace window (default 30 days):**
- A soft-deleted account is recoverable via `POST /accounts/:id/restore` at any time within the grace window.
- After the grace window, the daily cron selects the account as a purge candidate.

**Hard-purge cron (daily, default 04:00 UTC):**
- Queue: `account-hard-purge` (pg-boss singleton schedule).
- Handler reads the live grace period via `getEffectiveAccountHardPurgeDays()` at tick time (sweep-parameter-live — admin overrides take effect on the next tick without a restart).
- For each candidate, a single-transaction DELETE cascade removes all account-scoped child rows in FK-dependency order (see `docs/001-architecture/backend-db-api.md` §Account soft-delete lifecycle for the full 12-table cascade list).
- Emits `account_hard_purged` SSE event per account purged.
- Aggregate log at the end: `{ purged, errors, graceDays }`.

**"Permanently delete now" shortcut:**
- `POST /accounts/:id/purge` accepts `{ confirmationName }` — the user must type the account name verbatim.
- Bypasses the grace window; hard-purges immediately in a single transaction.
- Emits `account_hard_purged` SSE event.
- Available for both active and soft-deleted accounts.

**Restore:**
- `POST /accounts/:id/restore` clears `deleted_at`.
- If an active account already owns the same name, the restored account is auto-renamed to `"{originalName} (restored)"`, then `"(restored 2)"`, etc. (up to 20 attempts; 409 if unresolvable).
- The final name is returned in the response and carried in the `account_restored` SSE event.

### Env vars

Both env vars have `.default(...)` and require a restart to change (cron schedule live-edit is out of scope).

| Env var | Default | Notes |
|---|---|---|
| `ACCOUNT_HARD_PURGE_CRON` | `"0 4 * * *"` | Cron expression for the daily hard-purge job. Restart-required. |
| `ACCOUNT_HARD_PURGE_DAYS` | `30` | Grace period fallback (days). Overridden by `app_config.account_hard_purge_days` without restart. |

### Admin override — `app_config.account_hard_purge_days`

Tier-B operational constant. Admin can change via **Settings → app_config** tab in the admin UI.

| Column | Type | Tier | Env fallback |
|---|---|---|---|
| `account_hard_purge_days` | `INT NULL` | Tier B | `ACCOUNT_HARD_PURGE_DAYS` = 30 |

Bounds: [1, 365]. Setting to `NULL` restores the env-fallback. Changes take effect on the **next cron tick** without a restart (live-tunable via `getEffectiveAccountHardPurgeDays()` resolver).

SQL escape hatch:
```sql
-- Override to 60-day grace window:
UPDATE app_config SET account_hard_purge_days = 60, updated_at = NOW() WHERE id = 1;
-- Restore env-fallback:
UPDATE app_config SET account_hard_purge_days = NULL, updated_at = NOW() WHERE id = 1;
```

### SSE events and audit log

Three new events emitted on account lifecycle transitions:

| Event / Audit code | Trigger | Payload |
|---|---|---|
| `account_soft_deleted` | Soft-delete route | `{ accountId, deletedAt }` |
| `account_restored` | Restore route | `{ accountId, finalName }` |
| `account_hard_purged` | Hard-purge route OR cron | `{ accountId }` |

All three are recorded in `audit_log` with a metadata snapshot (`accountName`, `accountType`, `defaultCurrency`) captured **before** row deletion. The audit row persists post-purge via `audit_log.target_user_id FK ON DELETE SET NULL`.

### Monitoring queries

```sql
-- Count soft-deleted accounts currently in the grace window:
SELECT COUNT(*) AS pending_purge
FROM accounts
WHERE deleted_at IS NOT NULL
  AND deleted_at > NOW() - INTERVAL '30 days';

-- Accounts overdue for purge (exceeded default grace period):
SELECT id, user_id, name, deleted_at
FROM accounts
WHERE deleted_at IS NOT NULL
  AND deleted_at < NOW() - INTERVAL '30 days'
ORDER BY deleted_at ASC;

-- Recent account lifecycle audit events:
SELECT created_at, action, metadata
FROM audit_log
WHERE action IN ('account_soft_deleted', 'account_restored', 'account_hard_purged')
ORDER BY created_at DESC
LIMIT 20;
```

### Rollback notes

- Migration 053 + 054 are additive. Rollback: `ALTER TABLE accounts DROP COLUMN IF EXISTS deleted_at; ALTER TABLE app_config DROP COLUMN IF EXISTS account_hard_purge_days;` — then redeploy the prior image.
- **Important:** if any accounts were hard-purged before rollback, that data is unrecoverable. Soft-deleted accounts (not yet hard-purged) are preserved in the `accounts` table and become visible again if `deleted_at` is cleared.
- Soft-deletes are recoverable until the cron fires. Rollback timing: redeploy the prior image BEFORE the next 04:00 UTC cron tick to prevent further purges.
- The partial unique index `ux_accounts_user_id_name_active` must be restored to the original `ux_accounts_user_id_name` if rolling back migration 053: `DROP INDEX IF EXISTS ux_accounts_user_id_name_active; CREATE UNIQUE INDEX ux_accounts_user_id_name ON accounts (user_id, name);`
