import { z } from "zod";
import { envSchema } from "./env-schema.js";

const dockerBaseExtension = {
  PUBLIC_DOMAIN_WEB: z.string().min(1),
  PUBLIC_DOMAIN_API: z.string().min(1),
  POSTGRES_USER: z.string().default("vakwen"),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().default("vakwen"),
  REDIS_PASSWORD: z.string().min(1),
  CLOUDFLARE_TUNNEL_TOKEN: z.string().min(1),
  PRIMARY_PROVIDER: z.string().default("mock-primary"),
  FALLBACK_PROVIDER: z.string().default("mock-fallback"),
  VAKWEN_STATE_DIR: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
  DEPLOY_LOG_DIR: z.string().optional(),
  // Docker deployments route API and web through separate subdomains, so the session
  // cookie must be scoped to the shared parent domain rather than using __Host- (which
  // is host-bound). Override the base default so COOKIE_DOMAIN works out of the box.
  SESSION_COOKIE_NAME: z.string().min(1).default("g_auth_session"),
};

export const dockerCloudSchema = envSchema.extend({
  ...dockerBaseExtension,
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  DEPLOY_ENV: z.enum(["dev", "production"]),
  // Re-declared to document: no default (overrides dockerBaseExtension spread which also has these fields).
  // env:setup provides domain values.
  PUBLIC_DOMAIN_WEB: z.string().min(1),
  PUBLIC_DOMAIN_API: z.string().min(1),
  // Required — no default. Cross-subdomain session sharing needs explicit domain.
  COOKIE_DOMAIN: z.string().min(1),
});

// Docker local — strict subset: only vars docker-compose.local.yml actually needs.
// Uses a standalone z.object() instead of extending envSchema because the local
// compose target passes ports as strings and only needs a narrow set of vars.
export const dockerLocalSchema = z.object({
  MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED: envSchema.shape.MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED,
  // Database
  POSTGRES_USER: z.string().default("vakwen"),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().default("vakwen"),
  // Redis
  REDIS_PASSWORD: z.string().min(1),
  // Application
  // 'test' is recommended for local Docker — see runbook for NODE_ENV behavior matrix
  NODE_ENV: z.enum(["development", "test", "production"]).default("test"),
  AUTH_MODE: z.enum(["oauth", "dev_bypass"]).default("oauth"),
  PERSISTENCE_BACKEND: z.enum(["postgres", "memory"]).default("postgres"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_PORT: z.coerce.number().int().positive().default(3000),
  DATA_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(3000),
  PRIMARY_PROVIDER: z.string().default("mock-primary"),
  FALLBACK_PROVIDER: z.string().default("mock-fallback"),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_MUTATIONS: z.coerce.number().int().positive().default(120),
  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().default("http://localhost:4300/auth/google/callback"),
  SESSION_SECRET: z.string().min(32),
  INITIAL_ADMIN_EMAIL: z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
  // Use g_auth_session (no __Host- prefix) since local Docker runs on HTTP,
  // and __Host- requires the Secure flag which needs HTTPS.
  SESSION_COOKIE_NAME: z.string().min(1).default("g_auth_session"),
  // Optional
  IMAGE_TAG: z.string().optional(),
});

/**
 * Validates that COOKIE_DOMAIN is set when API and web live on different subdomains.
 * Cross-subdomain session sharing requires an explicit cookie domain scope.
 */
export function validateCookieDomainRequired(input: {
  PUBLIC_DOMAIN_WEB: string;
  PUBLIC_DOMAIN_API: string;
  COOKIE_DOMAIN?: string;
}): void {
  if (input.PUBLIC_DOMAIN_WEB === input.PUBLIC_DOMAIN_API) return;
  if (!input.COOKIE_DOMAIN) {
    throw new Error(
      `PUBLIC_DOMAIN_WEB (${input.PUBLIC_DOMAIN_WEB}) and PUBLIC_DOMAIN_API (${input.PUBLIC_DOMAIN_API}) ` +
      `use different hostnames but COOKIE_DOMAIN is not set. ` +
      `Cross-subdomain session sharing requires COOKIE_DOMAIN (e.g. ".kzokvdevs.dpdns.org").`,
    );
  }
}
