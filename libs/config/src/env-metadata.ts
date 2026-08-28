export interface EnvGroup {
  label: string;
  keys: string[];
}

// Root env groups (matches .env.example section ordering)
export const envGroups: EnvGroup[] = [
  { label: "Environment & modes", keys: ["NODE_ENV", "AUTH_MODE", "PERSISTENCE_BACKEND"] },
  { label: "Application ports", keys: ["API_PORT", "WEB_PORT", "DB_PORT", "REDIS_PORT"] },
  { label: "Database/Redis URLs", keys: ["DB_URL", "REDIS_URL"] },
  { label: "Market data providers", keys: ["DATA_PROVIDER_TIMEOUT_MS", "PRIMARY_PROVIDER", "FALLBACK_PROVIDER"] },
  { label: "Security/Tuning", keys: ["ALLOWED_ORIGINS", "RATE_LIMIT_WINDOW_MS", "RATE_LIMIT_MAX_MUTATIONS", "REPAIR_COOLDOWN_MINUTES", "METADATA_ENRICHMENT_MODE", "ANONYMOUS_SHARE_TOKEN_PURGE_DAYS", "MCP_RESEARCH_ACQUISITION_ENABLED", "MCP_RESEARCH_MCP_ENABLED", "MCP_RESEARCH_SKILL_ENABLED", "APP_CONFIG_ENCRYPTION_KEY", "ANONYMOUS_SHARE_TOKEN_CAP", "ANONYMOUS_SHARE_TOKEN_RETENTION_MS", "USER_PREFERENCES_MAX_BYTES", "POSTGRES_POOL_MAX", "BACKFILL_POSTGRES_POOL_MAX", "POSTGRES_CONNECTION_TIMEOUT_MS", "REDIS_CONNECTION_TIMEOUT_MS", "REDIS_RECONNECT_MAX_RETRIES", "ACCOUNT_HARD_PURGE_CRON", "ACCOUNT_HARD_PURGE_DAYS"] },
  {
    label: "Google OAuth",
    keys: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "SESSION_SECRET",
      "SESSION_COOKIE_NAME",
      "COOKIE_DOMAIN",
      "GOOGLE_TOKEN_URL",
      "APP_BASE_URL",
      "INITIAL_ADMIN_EMAIL",
    ],
  },
];

// Root local groups — includes NEXT_PUBLIC_* for Next.js env generation
export const rootLocalGroups: EnvGroup[] = [
  ...envGroups,
  { label: "Web app (Next.js)", keys: ["NEXT_PUBLIC_AUTH_MODE", "NEXT_PUBLIC_API_BASE_URL"] },
  { label: "Other", keys: ["DEMO_MODE_ENABLED", "DEMO_SESSION_TTL_SECONDS", "FINMIND_API_TOKEN"] },
  { label: "Host", keys: ["MAC_USER", "MAC_PASSWORD"] },
];

// Docker cloud groups (dev + prod — unified)
export const dockerCloudGroups: EnvGroup[] = [
  { label: "Public domains", keys: ["PUBLIC_DOMAIN_WEB", "PUBLIC_DOMAIN_API"] },
  { label: "Postgres", keys: ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"] },
  { label: "Redis", keys: ["REDIS_PASSWORD"] },
  { label: "Cloudflare Tunnel", keys: ["CLOUDFLARE_TUNNEL_TOKEN"] },
  {
    label: "Google OAuth",
    keys: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "SESSION_SECRET",
      "SESSION_COOKIE_NAME",
      "COOKIE_DOMAIN",
      "INITIAL_ADMIN_EMAIL",
    ],
  },
  {
    label: "Application",
    keys: [
      "NODE_ENV",
      "AUTH_MODE",
      "PERSISTENCE_BACKEND",
      "DEPLOY_ENV",
      "API_PORT",
      "WEB_PORT",
      "DATA_PROVIDER_TIMEOUT_MS",
      "PRIMARY_PROVIDER",
      "FALLBACK_PROVIDER",
      "RATE_LIMIT_WINDOW_MS",
      "RATE_LIMIT_MAX_MUTATIONS",
      "REPAIR_COOLDOWN_MINUTES",
      "METADATA_ENRICHMENT_MODE",
      "ANONYMOUS_SHARE_TOKEN_PURGE_DAYS",
      "MCP_RESEARCH_ACQUISITION_ENABLED",
      "MCP_RESEARCH_MCP_ENABLED",
      "MCP_RESEARCH_SKILL_ENABLED",
      "APP_CONFIG_ENCRYPTION_KEY",
      "ANONYMOUS_SHARE_TOKEN_CAP",
      "ANONYMOUS_SHARE_TOKEN_RETENTION_MS",
      "USER_PREFERENCES_MAX_BYTES",
      "POSTGRES_POOL_MAX",
      "BACKFILL_POSTGRES_POOL_MAX",
      "POSTGRES_CONNECTION_TIMEOUT_MS",
      "REDIS_CONNECTION_TIMEOUT_MS",
      "REDIS_RECONNECT_MAX_RETRIES",
      "ACCOUNT_HARD_PURGE_CRON",
      "ACCOUNT_HARD_PURGE_DAYS",
    ],
  },
  { label: "State paths", keys: ["VAKWEN_STATE_DIR", "BACKUP_DIR", "DEPLOY_LOG_DIR"] },
];

// Docker local groups — strict subset for docker-compose.local.yml
export const dockerLocalGroups: EnvGroup[] = [
  { label: "Postgres", keys: ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"] },
  { label: "Redis", keys: ["REDIS_PASSWORD"] },
  {
    label: "Google OAuth",
    keys: [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GOOGLE_REDIRECT_URI",
      "SESSION_SECRET",
      "SESSION_COOKIE_NAME",
      "INITIAL_ADMIN_EMAIL",
    ],
  },
  {
    label: "Application",
    keys: [
      "NODE_ENV",
      "AUTH_MODE",
      "PERSISTENCE_BACKEND",
      "API_PORT",
      "WEB_PORT",
      "DATA_PROVIDER_TIMEOUT_MS",
      "PRIMARY_PROVIDER",
      "FALLBACK_PROVIDER",
      "RATE_LIMIT_WINDOW_MS",
      "RATE_LIMIT_MAX_MUTATIONS",
      "REPAIR_COOLDOWN_MINUTES",
      "METADATA_ENRICHMENT_MODE",
      "ANONYMOUS_SHARE_TOKEN_PURGE_DAYS",
      "MCP_RESEARCH_ACQUISITION_ENABLED",
      "MCP_RESEARCH_MCP_ENABLED",
      "MCP_RESEARCH_SKILL_ENABLED",
      "APP_CONFIG_ENCRYPTION_KEY",
      "ANONYMOUS_SHARE_TOKEN_CAP",
      "ANONYMOUS_SHARE_TOKEN_RETENTION_MS",
      "USER_PREFERENCES_MAX_BYTES",
      "POSTGRES_POOL_MAX",
      "BACKFILL_POSTGRES_POOL_MAX",
      "POSTGRES_CONNECTION_TIMEOUT_MS",
      "REDIS_CONNECTION_TIMEOUT_MS",
      "REDIS_RECONNECT_MAX_RETRIES",
      "ACCOUNT_HARD_PURGE_CRON",
      "ACCOUNT_HARD_PURGE_DAYS",
    ],
  },
  { label: "Docker", keys: ["IMAGE_TAG"] },
];

// Sensitive keys — masked input in prompts and summary display.
// DB_URL and REDIS_URL are included because they embed passwords.
export const sensitiveKeys = new Set([
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_SECRET",
  "CLOUDFLARE_TUNNEL_TOKEN",
  "MAC_PASSWORD",
  "DB_URL",
  "REDIS_URL",
  // KZO-198: AES-256-GCM key for app_config Tier 0 secret encryption.
  "APP_CONFIG_ENCRYPTION_KEY",
]);

// Auto-generatable keys — offer crypto.randomBytes(32).toString('hex')
export const autoGenerateKeys = new Set([
  "POSTGRES_PASSWORD",
  "REDIS_PASSWORD",
  "SESSION_SECRET",
  // KZO-198: 32 random bytes → 64 lowercase hex chars matches the
  // env-schema regex /^[0-9a-f]{64}$/. Required at API boot in non-test
  // runtimes (see Env.validateEnvConstraints).
  "APP_CONFIG_ENCRYPTION_KEY",
]);
