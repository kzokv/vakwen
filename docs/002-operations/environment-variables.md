# Environment Variables

Complete reference for all environment variables, schemas, validation rules, and generation tooling.

---

## Env File Architecture

```mermaid
flowchart TD
  A[.env.example] -->|env:setup script| B[".env.local (root:local)"]
  A -->|env:setup --target docker:local| C["infra/docker/.env.local (docker:local)"]
  A -->|env:setup --target docker:dev| D["infra/docker/.env.dev (docker:dev)"]
  A -->|env:setup --target docker:prod| E["infra/docker/.env.prod (docker:prod)"]
```

### Targets

| Target | Output path | Schema | Purpose |
|--------|------------|--------|---------|
| `root:local` | `.env.local` | `rootLocalSchema` | Host-level dev servers (`npm run dev:local:*`) |
| `docker:local` | `infra/docker/.env.local` | `dockerLocalSchema` | Local Docker Compose stack |
| `docker:dev` | `infra/docker/.env.dev` | `dockerCloudSchema` | Dev server (QNAP + Cloudflare) |
| `docker:prod` | `infra/docker/.env.prod` | `dockerCloudSchema` | Production (QNAP + Cloudflare) |

---

## Schemas

```mermaid
graph TD
  ENV[envSchema] -->|API + services| A["Env object"]
  WEBENV[webEnvSchema] -->|Web middleware + SSR| B["WebEnv object"]
  ROOT[rootLocalSchema] -->|host dev| C[".env.local"]
  DLOCAL[dockerLocalSchema] -->|docker local| D[".env.local docker"]
  DCLOUD[dockerCloudSchema] -->|docker cloud| E[".env.dev / .env.prod"]
```

| Schema | Location | Purpose |
|--------|----------|---------|
| `envSchema` | `libs/config/src/env.ts` | Full API env — all vars for the Fastify server |
| `webEnvSchema` | `libs/config/src/env-web.ts` | Web-only env — `NEXT_PUBLIC_*` vars for Edge + SSR |
| `rootLocalSchema` | `scripts/env-setup/schemas.ts` | Validation for host-level `.env.local` |
| `dockerCloudSchema` | `scripts/env-setup/schemas.ts` | Validation for cloud Docker env files (dev, prod) |
| `dockerLocalSchema` | `scripts/env-setup/schemas.ts` | Validation for local Docker env file |

### Import boundary

`env-web.ts` is Edge Runtime safe and **never** imports `env.ts`. The web middleware and client components use `WebEnv` exclusively. Server-side API code uses `Env` from `env.ts`.

---

## Variable Reference

### Mode switches

| Variable | Values | Default | Description |
|----------|--------|---------|-------------|
| `NODE_ENV` | `development`, `test`, `production` | `development` | Controls cookie Secure flag, E2E endpoint availability, port validation |
| `AUTH_MODE` | `dev_bypass`, `oauth` | — | Authentication strategy; `dev_bypass` restricted to non-production `NODE_ENV` |
| `PERSISTENCE_BACKEND` | `memory`, `postgres` | — | Storage backend for the API |
| `DEPLOY_ENV` | `local`, `dev`, `production` | — | Deploy target identifier (Docker compose only) |

### Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `API_PORT` | `4000` | Fastify API listen port |
| `WEB_PORT` | `3000` | Next.js web listen port |
| `DB_PORT` | `5432` | Postgres mapped port (compose) |
| `REDIS_PORT` | `6379` | Redis mapped port (compose) |

### Database and Redis

| Variable | Example | Description |
|----------|---------|-------------|
| `DB_URL` | `postgres://app:app@localhost:5432/vakwen` | Postgres connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection string |

### OAuth

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth 2.0 client secret |
| `GOOGLE_REDIRECT_URI` | Callback URL: `https://<domain>/auth/google/callback` (computed in compose) |
| `SESSION_SECRET` | >=32 char hex string for HMAC session signing. Generate: `openssl rand -hex 32` |
| `APP_BASE_URL` | Post-login redirect base URL (computed in compose from `PUBLIC_DOMAIN_WEB`) |
| `GOOGLE_TOKEN_URL` | Google token endpoint (default: `https://oauth2.googleapis.com/token`) |

### Admin bootstrap

| Variable | Default | Description |
|----------|---------|-------------|
| `INITIAL_ADMIN_EMAIL` | (none) | Optional. When set, promotes matching user to `admin` on startup; bypasses invite-gate on first sign-in. See [Auth — INITIAL_ADMIN_EMAIL](../001-architecture/auth-and-session.md#initial_admin_email-bootstrap). |

### Cookie configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_COOKIE_NAME` | `__Host-g_auth_session` | Session cookie name; use `g_auth_session` (no `__Host-` prefix) for HTTP |
| `COOKIE_DOMAIN` | (none) | Cookie domain for cross-subdomain sharing (e.g., `.example.com`) |

In addition to the configurable session cookie, the API emits two other cookies whose names are fixed in code:

| Cookie | Name | Purpose | Attributes |
|---|---|---|---|
| Switcher context | `tw_context_user_id` | Picks an owner from the grantee's share list (KZO-146). | Readable (not HttpOnly), `SameSite=Lax`, `Secure` in prod, `COOKIE_DOMAIN`. |
| Admin impersonation | `g_impersonation` | Carries the HMAC-signed `{adminId}.{targetUserId}.{expiresAtMs}` payload during an impersonation session (KZO-148). Signed with `SESSION_SECRET`. | `HttpOnly`, `SameSite=Lax`, `Secure` in prod, `COOKIE_DOMAIN`, no `__Host-` prefix. Max-Age = `ADMIN_IMPERSONATION_TTL_MINUTES * 60 + 300` (5-minute grace past expiry). |

### Admin impersonation

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_IMPERSONATION_TTL_MINUTES` | `30` | Lifetime of an impersonation session. Server enforces expiry on every request via the `expiresAt` claim inside the signed cookie. On expiry, the server auto-clears the cookie and emits an `impersonation_end {reason: "expired"}` audit row. See [Auth — Admin Impersonation](../001-architecture/auth-and-session.md#admin-impersonation-kzo-148). |

### Demo mode

| Variable | Default | Description |
|----------|---------|-------------|
| `DEMO_MODE_ENABLED` | `"false"` | Enable demo sign-in button and demo user creation |
| `DEMO_SESSION_TTL_SECONDS` | `1800` | Demo session lifetime (30 minutes) |
| `NEXT_PUBLIC_DEMO_MODE_ENABLED` | `"false"` | Client-side flag for demo UI components (baked at build time) |

### Security and CORS

| Variable | Example | Description |
|----------|---------|-------------|
| `ALLOWED_ORIGINS` | `http://localhost:3000,https://vakwen-web.example.com` | Comma-separated CORS allowlist |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rolling rate-limit window (ms) |
| `RATE_LIMIT_MAX_MUTATIONS` | `60` | Max write operations per window |

### MCP additive research rollout

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_RESEARCH_ACQUISITION_ENABLED` | `false` | Registers the official Taiwan research acquisition worker for identity and monthly revenue, and allows new OAuth consents and bearer connectors to acquire `research:read`. Existing connectors are not upgraded silently. |
| `MCP_RESEARCH_MCP_ENABLED` | `false` | Exposes `get_research_manifest`, `get_research_identity`, `get_monthly_revenue`, and the additive research authorization/search path in MCP discovery. |
| `MCP_RESEARCH_SKILL_ENABLED` | `false` | Allows the public `taiwan-stock-research` Skill to continue after its manifest check and render the identity-only, focused-market, or monthly-revenue report artifact when the requested dataset is available. When false, the manifest reports disabled and the Skill fails closed. |

These gates are intentionally independent and default-off. Connector scope acquisition and research tool exposure require both the acquisition and MCP gates; Skill orchestration additionally requires the Skill gate. Safe rollback is to turn the gates back off without mutating canonical history or existing connector rows. OAuth and bearer connectors that need `research:read` must reconnect or be recreated after acquisition is enabled.

Behavior notes:

- `portfolio:mcp_read` remains the legacy multi-market read scope and still backs the pre-rollout `search_instruments` behavior.
- `research:read` is additive, not a replacement. It owns the canonical manifest, identity, and monthly-revenue tools; `search_instruments` is shared with the legacy read surface.
- Research-only `search_instruments` is limited to Taiwan (`marketCode=TW`).
- When the additive research path is active, `search_instruments.includeInactive=true` widens results without changing legacy error shapes.
- Each returned item may include `researchIdentity.availability` with `available`, `unavailable`, or `not_applicable`.
- Stored legacy OAuth and bearer grants remain in place for rollback and are not auto-upgraded. Connectors that need `research:read` must reconnect or be recreated after acquisition is enabled.

### Data providers

| Variable | Default | Description |
|----------|---------|-------------|
| `PRIMARY_PROVIDER` | `mock-primary` | Primary market data provider |
| `FALLBACK_PROVIDER` | `mock-fallback` | Fallback market data provider |
| `DATA_PROVIDER_TIMEOUT_MS` | `5000` | Provider request timeout |
| `FINMIND_API_TOKEN` | (none) | TW/US market-data token. Can also be stored encrypted in `app_config`; admin value wins. |
| `FINMIND_BASE_URL` | `https://api.finmindtrade.com/api/v4/data` | FinMind API endpoint. |
| `FINMIND_RATE_LIMIT_PER_HOUR` | `600` | Shared FinMind hourly budget. |
| `TWELVE_DATA_API_KEY` | (none) | AU/KR/JP catalog key. Can also be stored encrypted in `app_config`; admin value wins. |
| `TWELVE_DATA_BASE_URL` | `https://api.twelvedata.com` | Twelve Data API endpoint. |
| `TWELVE_DATA_RATE_LIMIT_PER_MINUTE` | `8` | Twelve Data Basic/free per-minute budget. |
| `EODHD_API_KEY` | (none) | EODHD EOD quote fallback key. Can also be stored encrypted in `app_config`; admin value wins. |
| `EODHD_BASE_URL` | `https://eodhd.com/api` | EODHD API endpoint. |
| `EODHD_DAILY_CALL_LIMIT` | `20` | Strict local daily EODHD call budget for fallback refreshes. Normal reads do not call EODHD. |

### Next.js web only

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_AUTH_MODE` | Client-side auth mode flag — baked into the JS bundle at build time |
| `NEXT_PUBLIC_API_BASE_URL` | Client-side API URL (browser-accessible, e.g., `http://localhost:4000`) |
| `SERVER_API_BASE_URL` | Server-side API URL (container-internal, e.g., `http://vakwen-prod-api:4000`) |

`NEXT_PUBLIC_*` vars are inlined at **build time** by Next.js. Changing them requires a rebuild. `SERVER_API_BASE_URL` is read at runtime and set in compose `environment` blocks (not env files).

### Docker cloud only

| Variable | Description |
|----------|-------------|
| `PUBLIC_DOMAIN_WEB` | Public web hostname (e.g., `vakwen-web.example.com`) |
| `PUBLIC_DOMAIN_API` | Public API hostname (e.g., `vakwen-api.example.com`) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Tunnel authentication token |
| `POSTGRES_USER` | Postgres superuser name |
| `POSTGRES_PASSWORD` | Postgres superuser password |
| `POSTGRES_DB` | Postgres database name |
| `REDIS_PASSWORD` | Redis AUTH password |
| `IMAGE_TAG` | Docker image tag (set by deploy script; default: short SHA) |

### Sensitive keys

| Variable | Auto-generable? | Notes |
|----------|----------------|-------|
| `SESSION_SECRET` | Yes | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Yes | `openssl rand -base64 24` |
| `REDIS_PASSWORD` | Yes | `openssl rand -base64 24` |
| `GOOGLE_CLIENT_ID` | No | From Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | No | From Google Cloud Console |
| `CLOUDFLARE_TUNNEL_TOKEN` | No | From Cloudflare dashboard |

---

## Values Per Runtime Context

| Variable | bypass:mem | bypass:pg | oauth:mem | oauth:pg | docker:local | docker:dev | docker:prod |
|----------|-----------|----------|----------|---------|-------------|-----------|------------|
| `AUTH_MODE` | `dev_bypass` | `dev_bypass` | `oauth` | `oauth` | `oauth` | `oauth` | `oauth` |
| `PERSISTENCE_BACKEND` | `memory` | `postgres` | `memory` | `postgres` | `postgres` | `postgres` | `postgres` |
| `NODE_ENV` | `development` | `development` | `development` | `development` | `test` | `production` | `production` |
| `DB_URL` | — | local | — | local | compose | compose | compose |
| `REDIS_URL` | — | local | — | local | compose | compose | compose |
| `SESSION_COOKIE_NAME` | — | — | `g_auth_session` | `g_auth_session` | `g_auth_session` | `__Host-...` | `__Host-...` |

---

## Validation Rules

| Rule | Description |
|------|-------------|
| Port uniqueness | `WEB_PORT`, `API_PORT`, `DB_PORT`, `REDIS_PORT` must be distinct |
| `dev_bypass` restriction | `AUTH_MODE=dev_bypass` rejected when `NODE_ENV=production` |
| OAuth required vars | When `AUTH_MODE=oauth`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET` required |
| Hostname consistency | `GOOGLE_REDIRECT_URI` host must match `PUBLIC_DOMAIN_API` |
| Redirect port match | `GOOGLE_REDIRECT_URI` port (if any) must match `API_PORT` for local setups |
| Cookie prefix | `__Host-` prefix only valid when `Secure=true` (HTTPS / `NODE_ENV=production`) |
| Cross-subdomain cookie | `COOKIE_DOMAIN` must be a parent domain of both web and API hostnames |

---

## Variable Dependency Graph

```mermaid
flowchart TD
  AUTH[AUTH_MODE] -->|oauth| GOOGLE[GOOGLE_CLIENT_ID + SECRET]
  AUTH -->|oauth| SESSION[SESSION_SECRET]
  AUTH -->|oauth| COOKIE[SESSION_COOKIE_NAME]
  AUTH -->|oauth| DOMAIN[COOKIE_DOMAIN]

  PERSIST[PERSISTENCE_BACKEND] -->|postgres| DB[DB_URL]
  PERSIST -->|postgres| REDIS[REDIS_URL]

  PUB_WEB[PUBLIC_DOMAIN_WEB] --> APP_BASE[APP_BASE_URL]
  PUB_WEB --> ORIGINS[ALLOWED_ORIGINS]
  PUB_API[PUBLIC_DOMAIN_API] --> REDIRECT[GOOGLE_REDIRECT_URI]

  DEMO_EN[DEMO_MODE_ENABLED] --> DEMO_TTL[DEMO_SESSION_TTL_SECONDS]
  DEMO_EN --> DEMO_PUB[NEXT_PUBLIC_DEMO_MODE_ENABLED]
```

---

## Env Loading Flow

```mermaid
flowchart TD
  A[Process starts] --> B{Which runtime?}
  B -->|API / Node.js| C["import Env from libs/config/env.ts"]
  C --> D["Zod envSchema.parse(process.env)"]
  D --> E[Env singleton available]

  B -->|Web middleware / Edge| F["import WebEnv from libs/config/env-web.ts"]
  F --> G["Zod webEnvSchema.parse(process.env)"]
  G --> H[WebEnv singleton available]

  B -->|Web SSR / route handlers| I["Both Env and WebEnv available"]
```

---

## Env File Generation Flow

```mermaid
flowchart TD
  A["npm run env:setup"] --> B["scripts/env-setup/index.ts"]
  B --> C{--target?}
  C -->|root:local| D["Read .env.example
    Apply rootLocalSchema
    Write .env.local"]
  C -->|docker:local| E["Read .env.example
    Apply dockerLocalSchema
    Write infra/docker/.env.local"]
  C -->|docker:dev| F["Read .env.example
    Apply dockerCloudSchema
    Write infra/docker/.env.dev"]
  C -->|docker:prod| G["Read .env.example
    Apply dockerCloudSchema
    Write infra/docker/.env.prod"]

  B --> H{--non-interactive?}
  H -->|Yes| I[Use defaults + auto-generate secrets]
  H -->|No| J[Prompt for each value]
```

---

## Related Docs

- [System Architecture](../001-architecture/architecture.md) — deployment topology, build model
- [Auth and Session](../001-architecture/auth-and-session.md) — OAuth flow, cookie details, demo mode
- [Runbook](./runbook.md) — first-time setup, secret rotation, local Docker config
