import { z } from "zod";

/**
 * KZO-200: string-aware boolean parser. `z.coerce.boolean()` delegates to
 * `Boolean(string)` which is `true` for any non-empty string — so
 * `*_MOCK=false` (the literal string "false") silently coerces to the boolean
 * `true` and short-circuits real-vs-mock provider gates. This helper accepts
 * the canonical string forms only and rejects anything else as a parse error,
 * preserving the schema's contract: invalid env input fails loudly at boot.
 */
const envBool = z
  .union([
    z.boolean(),
    z
      .enum(["true", "false", "1", "0"])
      .transform((v) => v === "true" || v === "1"),
  ])
  .default(false);

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  DB_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  DATA_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z.string().optional(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_MUTATIONS: z.coerce.number().int().positive().default(120),
  // KZO-147: per-IP rate limit on GET /share/:token. Counts invalid tokens too
  // (enumeration resistance). See docs/004-notes/kzo-147/ Q4.
  ANONYMOUS_SHARE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
  ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(300_000),
  // Daily purge retention for terminal anonymous_share_tokens. Must be ≥ 30
  // (ANONYMOUS_SHARE_TOKEN_RETENTION_MS in days) to preserve the UI visibility guarantee.
  ANONYMOUS_SHARE_TOKEN_PURGE_DAYS: z.coerce.number().int().min(30).default(90),
  MCP_RESEARCH_ACQUISITION_ENABLED: envBool,
  MCP_RESEARCH_MCP_ENABLED: envBool,
  MCP_RESEARCH_SKILL_ENABLED: envBool,
  // Fallback default (minutes) used when `app_config.repair_cooldown_minutes` is NULL or
  // the singleton row is missing. When the DB value is set, it is authoritative. See KZO-133.
  REPAIR_COOLDOWN_MINUTES: z.coerce.number().int().positive().default(60),
  // KZO-189: AU metadata enrichment gate. `unconditional` preserves pre-KZO-189
  // behavior (enrich on every backfill); `conditional` skips enrichment for the
  // `daily_refresh` trigger to conserve the Yahoo budget. The DB override at
  // `app_config.metadata_enrichment_mode` (NULL → use this env value) wins when
  // set. See `services/market-data/metadataEnrichmentMode.ts`.
  METADATA_ENRICHMENT_MODE: z.enum(["unconditional", "conditional"]).default("conditional"),
  ADMIN_IMPERSONATION_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Google OAuth — required when AUTH_MODE=oauth.
  // GOOGLE_CLIENT_ID: OAuth 2.0 client ID from Google Cloud Console credentials.
  // GOOGLE_CLIENT_SECRET: paired secret; never expose to clients.
  // GOOGLE_REDIRECT_URI: must exactly match a URI registered in Google Cloud Console
  //   (e.g. https://api.example.com/auth/google/callback).
  // SESSION_SECRET: random string >= 32 chars used for HMAC CSRF state signing;
  //   rotating this value invalidates all in-flight OAuth flows.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  // Default is "g_auth_session" (no __Host- prefix) so cookies work on HTTP localhost.
  // Production HTTPS deploys should set SESSION_COOKIE_NAME=__Host-g_auth_session explicitly.
  SESSION_COOKIE_NAME: z.string().min(1).default("g_auth_session"),
  GOOGLE_TOKEN_URL: z.string().optional(),
  APP_BASE_URL: z.string().optional(),
  INITIAL_ADMIN_EMAIL: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  // COOKIE_DOMAIN: when set, the session cookie is scoped to this domain (e.g. ".kzokvdevs.dpdns.org")
  // so it is shared across API and web subdomains. Required when those subdomains differ.
  // Must not be set when SESSION_COOKIE_NAME starts with "__Host-" (incompatible prefix).
  COOKIE_DOMAIN: z.string().optional(),
  DEMO_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
  DEMO_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(1800),
  // FinMind API token — required for market data backfill (KZO-126).
  // Free tier: 600 requests/hour. Obtain from https://finmindtrade.com/
  FINMIND_API_TOKEN: z.string().optional(),
  // KZO-163: extracted hardcoded base URL + rate-limit budget so providers can be swapped/tuned
  // without code changes. Defaults match the prior hardcoded values.
  FINMIND_BASE_URL: z.string().url().default("https://api.finmindtrade.com/api/v4/data"),
  FINMIND_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(600),
  // KZO-164: Frankfurter v2 FX-rate ingestion. Frankfurter has no published
  // quota; this is a defensive app-side operation ceiling for admin/cron
  // refreshes and can be tightened via app_config.
  // FX_PROVIDER_MOCK enables the deterministic mock provider for tests/dev without changing
  // the registry call sites; defaults to false so prod always reaches the real provider.
  FRANKFURTER_BASE_URL: z.string().url().default("https://api.frankfurter.dev/v2"),
  FRANKFURTER_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),
  FX_PROVIDER_MOCK: envBool,
  // KZO-172: Yahoo Finance AU provider. Per-minute self-imposed ceiling — Yahoo does not
  // publish a hard limit (KZO-171 spike §5). The AU provider has its own `RateLimiter`
  // instance — NOT shared with FinMind's 600/hr budget. Default 60 req/min is the
  // precautionary value from the spike. AU_PROVIDER_MOCK=true switches the registry to
  // the deterministic mock for tests/dev without changing call sites.
  YAHOO_AU_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  AU_PROVIDER_MOCK: envBool,
  // KR uses the same Yahoo-style provider pattern as AU, with Yahoo suffixes
  // (`.KS` / `.KQ`) resolved internally and bare KRX tickers kept at app boundaries.
  YAHOO_KR_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  YAHOO_KR_RESOLVER_MODE: z.enum(["chart_probe_v1", "quote_first"]).default("quote_first"),
  KR_PROVIDER_MOCK: envBool,
  // JP v1 uses Twelve Data for catalog and Yahoo Finance `.T` for bars,
  // dividends, intraday, metadata, search fallback, and fundamentals.
  YAHOO_JP_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  JP_PROVIDER_MOCK: envBool,
  // KZO-194: Twelve Data AU catalog provider. Free-tier endpoints (`/stocks?exchange=ASX`
  // and `/etf?exchange=ASX`) enumerate the full ASX universe; bars/dividends remain on
  // Yahoo. Default rate-limit budget mirrors Twelve Data's free-tier 8 req/min ceiling.
  // `AU_CATALOG_PROVIDER_MOCK=true` swaps in the deterministic catalog mock for
  // tests/dev without touching the registry call sites. These are server-only; do NOT
  // export via `webEnvSchema`.
  TWELVE_DATA_API_KEY: z.string().optional(),
  TWELVE_DATA_BASE_URL: z.string().url().default("https://api.twelvedata.com"),
  TWELVE_DATA_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8),
  // EODHD EOD fallback provider. Normal dashboard/portfolio reads never call
  // this provider; refresh workers consume cached EOD snapshots under a strict
  // local daily call budget.
  EODHD_API_KEY: z.string().optional(),
  EODHD_BASE_URL: z.string().url().default("https://eodhd.com/api"),
  EODHD_DAILY_CALL_LIMIT: z.coerce.number().int().positive().default(20),
  AU_CATALOG_PROVIDER_MOCK: envBool,
  KR_CATALOG_PROVIDER_MOCK: envBool,
  JP_CATALOG_PROVIDER_MOCK: envBool,
  // KZO-172: per-IP rate limit on `GET /market-data/search`. Bounded autocomplete
  // affordance for AU (Yahoo `search()` per-query). 20/min is generous enough for
  // typeahead UX while keeping abuse off the upstream budget.
  MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),

  // ========================================================================
  // KZO-198 — Hybrid env+app_config Tier A operational constants.
  // Each of the env vars below is the fallback default used when the matching
  // `app_config.<column>` is NULL. The DB override (when set) wins. See
  // apps/api/src/services/appConfig/ for the per-category resolvers and
  // db/migrations/047_kzo198_app_config_tier_a_constants.sql for the schema.
  // ========================================================================

  // KZO-198 Tier 0 — app-level encryption key for Tier 0 secrets stored in
  // app_config (FinMind + Twelve Data API tokens). Raw 32-byte key encoded
  // as 64 lowercase hex chars. Validated at boot in non-test runtimes via
  // `Env.validateEnvConstraints()`. Generate with:
  //   `openssl rand -hex 32`
  // Rotation requires a re-encrypt migration (out of scope for KZO-198).
  APP_CONFIG_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/).optional(),

  // KZO-198 Tier 1 — rate-limit fallbacks for the existing per-IP limiters.
  // The matching app_config columns override these when set.
  MARKET_DATA_PRICE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  MARKET_DATA_PRICE_LIMIT: z.coerce.number().int().positive().default(30),
  MARKET_DATA_SEARCH_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  INVITE_STATUS_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  INVITE_STATUS_LIMIT: z.coerce.number().int().positive().default(20),

  // KZO-198 Tier 1 — provider-health levers.
  PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  PROVIDER_ERROR_TRAIL_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  PROVIDER_RERUN_COOLDOWN_MS: z.coerce.number().int().positive().default(60 * 1000),
  // KZO-197 — yahoo-finance-au rerun cooldown override fallback. The AU
  // "Re-run now" button kicks BOTH the catalog warm-up and the monitored
  // refresh; a 30-min default protects the Yahoo budget from operator
  // re-clicks. The matching `app_config.yahoo_au_rerun_cooldown_ms` column
  // overrides this when set. Other providers continue to use
  // `PROVIDER_RERUN_COOLDOWN_MS` (60 s default).
  YAHOO_AU_RERUN_COOLDOWN_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),

  // KZO-198 Tier 1 / 2 — backfill knobs. RetryLimit and RetryDelay are the
  // pg-boss queue defaults at registration time (eviction/queue cadence is
  // env-only per `fastify-eviction-lifecycle-pattern.md`); the resolver layer
  // exists for the admin DTO and any future use that benefits from live reads.
  BACKFILL_RETRY_LIMIT: z.coerce.number().int().positive().default(3),
  BACKFILL_RETRY_DELAY_SECONDS: z.coerce.number().int().positive().default(60),
  BACKFILL_FINMIND_402_RETRY_MS: z.coerce.number().int().positive().default(60_000),
  DAILY_REFRESH_LOOKBACK_DAYS: z.coerce.number().int().positive().default(7),
  DAILY_REFRESH_PRIORITY: z.coerce.number().int().nonnegative().default(10),

  // KZO-198 Tier 1 / 2 — SSE knobs.
  SSE_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  SSE_MAX_CONNECTIONS_PER_USER: z.coerce.number().int().positive().default(20),
  SSE_BUFFER_DEFAULT_TTL_MS: z.coerce.number().int().positive().default(60_000),

  // KZO-195 Tier 2 — absence-based delisting detection knobs (AU, with US
  // flipping on later). All three have safe defaults so no auto-gen is needed
  // (per `env-setup-autogen-required-secrets.md`).
  CATALOG_ABSENCE_THRESHOLD: z.coerce.number().int().positive().default(3),
  CATALOG_ABSENCE_GUARD_PERCENT: z.coerce.number().nonnegative().default(1.0),
  CATALOG_ABSENCE_GUARD_FLOOR: z.coerce.number().int().nonnegative().default(5),

  // KZO-198 Tier 3 — env-only cron schedules. Restart-required to change
  // (cron live-edit is explicitly out of scope per scope-todo "Out of scope").
  CATALOG_SYNC_CRON: z.string().min(1).default("30 17 * * 1-5"),
  FX_REFRESH_CRON: z.string().min(1).default("0 22 * * *"),
  ANONYMOUS_SHARE_TOKEN_PURGE_CRON: z.string().min(1).default("0 4 * * *"),
  // KZO-196 — AU GICS sync cron. ASX publishes the listed-companies CSV
  // ~daily; weekly is sufficient since GICS classification changes are
  // rare. Sundays 02:00 UTC (low-traffic window). Restart-required to
  // change at the env level; admins can override via `app_config.asx_gics_refresh_cron`
  // (also restart-required — pg-boss schedule is registered once at boot).
  ASX_GICS_REFRESH_CRON: z.string().min(1).default("0 2 * * 0"),
  // ASX publishes no documented quota for the listed-companies CSV. This
  // defensive ceiling controls admin-triggered/manual CSV refresh pacing and
  // can be tightened via app_config.
  ASX_GICS_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(6),

  // ui-enhancement — Tier 3 env-only cron schedule for the daily account
  // hard-purge cron. Restart-required (cron live-edit out of scope). Default
  // 04:00 UTC matches the anonymous-share-token-purge precedent.
  ACCOUNT_HARD_PURGE_CRON: z.string().min(1).default("0 4 * * *"),
  // ui-enhancement — Tier B fallback grace period (days) between
  // account_soft_deleted and cron-driven account_hard_purged. Admin override
  // via `app_config.account_hard_purge_days`. Bounds: [1, 365] (enforced in
  // bounds.ts).
  ACCOUNT_HARD_PURGE_DAYS: z.coerce.number().int().positive().default(30),

  // ========================================================================
  // KZO-199 — Hybrid env+app_config Tier B operational constants.
  // Each env below is the fallback default for the matching `app_config.<col>`
  // (NULL → use env). Bounds in `apps/api/src/services/appConfig/bounds.ts`.
  // ========================================================================

  // KZO-199 Tier 1 — sharing knobs.
  // ANONYMOUS_SHARE_RATE_LIMIT_MAX / WINDOW_MS already exist above (KZO-147).
  // ANONYMOUS_SHARE_TOKEN_CAP is the new fallback for app_config.anonymous_share_token_cap.
  ANONYMOUS_SHARE_TOKEN_CAP: z.coerce.number().int().positive().default(20),

  // KZO-199 Tier 2 — SQL-only retention window for terminated anonymous-share
  // tokens. Must stay ≤ ANONYMOUS_SHARE_TOKEN_PURGE_DAYS * 86_400_000 to
  // preserve the UI visibility guarantee (purge cron erases what we promised
  // to show). Default 30 days; bounds [1d, 365d] enforced in `bounds.ts`.
  ANONYMOUS_SHARE_TOKEN_RETENTION_MS: z.coerce.number().int().positive().default(30 * 24 * 60 * 60 * 1000),

  // KZO-199 Tier 2 — request-body cap for PATCH /user-preferences. The Fastify
  // route's static `bodyLimit` is fixed at the bound max (1 MiB); the runtime-
  // tunable inner check uses `getEffectiveUserPreferencesMaxBytes()` so
  // operators can tighten/loosen via `app_config.user_preferences_max_bytes`.
  USER_PREFERENCES_MAX_BYTES: z.coerce.number().int().positive().default(8192),

  // KZO-199 Tier 3 — env-only Postgres pool settings (restart-required).
  POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(20),
  BACKFILL_POSTGRES_POOL_MAX: z.coerce.number().int().positive().default(2),
  POSTGRES_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  REDIS_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  REDIS_RECONNECT_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
});

export type EnvConfig = z.infer<typeof envSchema>;

/** Generation schema for root:local target. Includes NEXT_PUBLIC_* for Next.js. */
export const rootLocalSchema = envSchema.extend({
  NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
  NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
  // Host credentials — used for SSH tunnel from Lume VM to Mac host.
  // Required when running Docker full stack inside the VM and accessing web via localhost.
  MAC_USER: z.string().optional(),
  MAC_PASSWORD: z.string().optional(),
});

/**
 * Web-side env schema. Safe to import in Edge Runtime (no Node.js modules).
 * SESSION_SECRET is inherited as optional from envSchema. Enforcement (required in
 * oauth mode) relies on validateEnvConstraints() — webEnvSchema.parse() alone will
 * not throw if SESSION_SECRET is absent.
 */
export const webEnvSchema = envSchema
  .pick({ SESSION_SECRET: true, SESSION_COOKIE_NAME: true, COOKIE_DOMAIN: true })
  .extend({
    NEXT_PUBLIC_AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("dev_bypass"),
    NEXT_PUBLIC_API_BASE_URL: z.string().default("http://localhost:4000"),
    /** Server-side API base URL. In Docker, route handlers fetch via container network
     *  (e.g. http://vakwen-local-api:4000) instead of the host-published port. */
    SERVER_API_BASE_URL: z.string().url().optional(),
    DEMO_MODE_ENABLED: z.enum(["true", "false"]).default("false"),
  });

export type WebEnvConfig = z.infer<typeof webEnvSchema>;

export function parseDotEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eqIndex = trimmed.indexOf("=");
  if (eqIndex <= 0) return null;

  const key = trimmed.slice(0, eqIndex).trim();
  let value = trimmed.slice(eqIndex + 1).trim();
  // Strip inline comment (" # comment") so enum/number parsing succeeds
  const commentStart = value.indexOf(" #");
  if (commentStart !== -1) value = value.slice(0, commentStart).trim();
  // Strip surrounding quotes
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  return { key, value };
}
