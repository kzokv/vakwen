# Vakwen Monorepo

Multi-market portfolio intelligence platform — covers Taiwan, US, and Australian markets today with configurable fee/tax rules and weighted-average cost basis. Roadmap expands toward AI copilot, automated analytics, and market monitoring.

## Structure

- `apps/web`: Next.js UI
- `apps/api`: Fastify API
- `libs/domain`: fee/tax/cost-basis engines
- `libs/shared-types`: shared API/domain types
- `apps/web/tests/e2e`: Playwright critical journey tests (owned by web app; run against full stack)

## Ports

All ports are configurable via env vars:

- `WEB_PORT` (default `3000`)
- `API_PORT` (default `4000`)
- `DB_PORT` (default `5432`)
- `REDIS_PORT` (default `6379`)

## Run

**Quick setup:** From repo root run `npm run onboard` (installs deps, builds the workspace libs, installs Playwright browsers/system deps, creates `.env` from `.env.example` if missing, and runs lint). Or use `npm run install:full` for install only (npm + Playwright + system deps). Then start infra and dev as below.

### Node toolchain (required)

Use Node `24.13.0` or newer with npm `11.x` for this repo.

- If you use `nvm`: run `nvm install && nvm use` at repo root (reads `.nvmrc`).
- If you use `nodenv`/`asdf`: `.node-version` is pinned to `24.13.0`.
- Avoid mixing Homebrew Node and `nvm` Node in the same shell session.

1. Copy `.env.example` to `.env` (or use `npm run onboard` to do this automatically).
2. Install dependencies: `npm run install:full` or `npm install`
   - Onboarding already builds `@vakwen/domain` and `@vakwen/shared-types`. If you install dependencies without running `npm run onboard`, or if you edit either lib, rerun `npm run build -w libs/domain -w libs/shared-types` before starting the dev servers.
3. Choose one dev mode (`npm run dev` prints the full list):
   - `npm run dev:local:bypass:mem` — Fastest iteration, no auth, in-memory storage.
   - `npm run dev:local:bypass:pg` — Bypass auth, real Postgres. Start Postgres first: `docker compose -f infra/docker/docker-compose.yml up -d`.
   - `npm run dev:local:oauth:mem` — Google OAuth, in-memory storage.
   - `npm run dev:local:oauth:pg` — Google OAuth, Postgres (closest to prod).
   - `npm run dev:docker` — Full Docker Compose local stack (oauth + postgres).
   - Full Docker stack validation (build, migrate, up, healthcheck): generate `infra/docker/.env.local` via `npm run env:setup -- --target docker:local`, then run `npm run dev:docker:validate`. This uses `infra/docker/docker-compose.local.yml` (ports: web 3300, api 4300, DB 5732, Redis 6679) and does not require cloudflared.
4. The dev scripts and onboarding build workspace libs when needed, but rerun `npm run build -w libs/domain -w libs/shared-types` after editing those packages or if you skipped onboarding.

Notes:
- `infra/docker/docker-compose.yml` is a local fallback Postgres/Redis provider and is not required when using memory mode or external DB/Redis URLs.
- The identity-only Taiwan research rollout is controlled by three independent default-off env gates: `MCP_RESEARCH_ACQUISITION_ENABLED`, `MCP_RESEARCH_MCP_ENABLED`, and `MCP_RESEARCH_SKILL_ENABLED`. It provides official TWSE/TPEx identity acquisition, `get_research_manifest`, `get_research_identity`, and the public `taiwan-stock-research` Skill. See `docs/002-operations/runbook.md` for rollout behavior and `docs/001-architecture/research-identity.md` for contracts and persistence.

## Test

- Unit: `npm run test:unit`
- Integration: `npm run test:integration`
- E2E: `npm run test:e2e:bypass:mem`
- API test reports (HTML / JSON / JUnit): see [apps/api/README.md](apps/api/README.md#testing-vitest).

## Web UI behavior

- Locale is user-configurable (`en`, `zh-TW`) from the avatar settings drawer.
- Saving locale to `zh-TW` translates the full web UI to Traditional Chinese.
- Settings drawer now has two tabs: `General` and `Fee Profiles`.
- Fee profile configuration is managed in the settings drawer (not on the dashboard).
- Users can maintain multiple fee profiles with auto-generated profile IDs (UUID).
- Account-level fallback profile + per-security override bindings are configurable in settings.
- Recompute uses per-security override first, then account fallback profile after confirmation.
- Drawer warns before closing with unsaved edits and supports explicit `Discard Changes`.
- Key terms expose contextual tooltips, including weighted-average cost-basis guidance.

## Demo mode

The app supports a demo mode that lets visitors try the portfolio tracker without signing in to Google OAuth.

- Set `DEMO_MODE_ENABLED=true` in your env to enable. Disabled by default.
- `DEMO_SESSION_TTL_SECONDS` controls session lifetime (default 1800 = 30 min).
- Demo users get 12 seeded transactions across 5 sample symbols.
- An amber "You're using a demo session" banner appears on all pages for demo users.
- Expired demo users and their data are cleaned up automatically every 15 minutes (Postgres only).
- See `docs/002-operations/runbook.md` for operational procedures and `docs/004-notes/003-oauth-env-refactor/010-kzo-107-108-transition-guide.md` for full technical details.

## API security defaults

- CORS allowlist is controlled by `ALLOWED_ORIGINS`.
- Mutation routes are protected by in-process rate limiting:
  - `RATE_LIMIT_WINDOW_MS`
  - `RATE_LIMIT_MAX_MUTATIONS`
- API validates request payloads with strict runtime schemas.
- Persistence blocks cross-tenant ID takeover on upsert for accounts/fee profiles.
