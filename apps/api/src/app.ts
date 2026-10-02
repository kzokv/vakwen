import { redactRequestUrl } from "./lib/redactRequestUrl.js";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
import { Env, type GoogleOAuthEnvConfig } from "@vakwen/config";
import { createPersistence } from "./persistence/index.js";
import type { Persistence } from "./persistence/types.js";
import { createEventBus, type BufferedEventBus } from "./events/index.js";
import {
  CONTEXT_FALLBACK_HEADER,
  contextClearCookieString,
  enforceRouteRole,
  hydrateAuthContext,
  impersonationClearCookieString,
  isPublicRoute,
  registerRoutes,
  sessionClearCookieString,
  shouldStampContextFallback,
} from "./routes/registerRoutes.js";
import { registerPgBoss } from "./plugins/pgBoss.js";
import {
  OPENAI_APPS_MCP_CORS_EXPOSED_HEADERS,
  OPENAI_APPS_MCP_CORS_METHODS,
  OPENAI_APPS_MCP_CORS_PATHS,
  isOpenAiAppsMcpCorsOrigin,
} from "./mcp/openAiAppsAdapter.js";
import { registerMcpRoutes } from "./mcp/registerMcpRoutes.js";
import { buildFundamentalsRegistry } from "./services/fundamentals/registry.js";
import { buildMarketDataRegistry } from "./services/market-data/registry.js";
import { registerTradingCalendarCache } from "./services/market-data/registerTradingCalendarCache.js";
import { registerProviderHealth } from "./services/market-data/registerProviderHealth.js";
import type { GoogleOAuthConfig } from "./auth/googleOAuth.js";
// Compile-time check: GoogleOAuthEnvConfig must remain assignable to GoogleOAuthConfig (P10).
// If fields ever drift, this line fails to compile and surfaces the problem immediately.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertAssignable = GoogleOAuthEnvConfig extends GoogleOAuthConfig ? true : never;

interface BuildAppOptions {
  persistenceBackend?: "postgres" | "memory";
  /** Override the Postgres application pool size for deterministic integration tests. */
  postgresPoolMax?: number;
  seedMemoryCatalog?: boolean;
  eventBusBackend?: "postgres" | "memory";
  /** Disable pg-boss worker registration for route tests that do not exercise queues. */
  registerWorkers?: boolean;
  /** Inject OAuth config directly (used in tests). Pass null to explicitly disable OAuth.
   *  When omitted, reads from environment variables via getGoogleOAuthEnvConfig(). */
  oauthConfig?: GoogleOAuthConfig | null;
  /** Override the web app base URL for post-OAuth redirects (used in tests). */
  appBaseUrl?: string;
}

interface RateCounter {
  count: number;
  windowStartedAt: number;
}

interface HttpishError extends Error {
  statusCode?: number;
  code?: string;
  metadata?: Record<string, unknown>;
}

function appendSetCookieHeader(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader("set-cookie");
  if (existing === undefined) {
    reply.header("set-cookie", cookie);
    return;
  }
  if (Array.isArray(existing)) {
    reply.header("set-cookie", [...existing, cookie]);
    return;
  }
  reply.header("set-cookie", [String(existing), cookie]);
}

export type AppInstance = FastifyInstance & {
  persistence: Persistence;
  eventBus: BufferedEventBus;
};

const mutationBuckets = new Map<string, RateCounter>();

function isKnownClientError(message: string): { statusCode: number; code: string } | null {
  const normalized = message.toLowerCase();
  if (normalized.includes("not found")) {
    return { statusCode: 404, code: "not_found" };
  }
  if (normalized.includes("invalid") || normalized.includes("missing") || normalized.includes("unsupported")) {
    return { statusCode: 400, code: "invalid_request" };
  }
  return null;
}

function getRateLimitKey(req: FastifyRequest): string {
  const userId = String(req.headers["x-user-id"] ?? "anonymous");
  const path = req.url.split("?")[0] ?? req.url;
  return `${req.ip}:${userId}:${req.method}:${path}`;
}

function isLocalDevOrigin(origin: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function requestOrigin(req: FastifyRequest): string | undefined {
  const origin = req.headers.origin;
  return Array.isArray(origin) ? origin[0] : origin;
}

function requestPath(req: FastifyRequest): string {
  return req.url.split("?")[0] ?? req.url;
}

function isOpenAiAppsCorsPath(req: FastifyRequest): boolean {
  return OPENAI_APPS_MCP_CORS_PATHS.has(requestPath(req));
}

async function bootstrapAdminAccess(app: AppInstance): Promise<void> {
  if (Env.AUTH_MODE === "dev_bypass") {
    await app.persistence.ensureDevBypassUser();
    return;
  }

  if (!Env.INITIAL_ADMIN_EMAIL) {
    app.log.warn({ msg: "admin_bootstrap_missing", reason: "no admin bootstrap configured" });
    return;
  }

  const existing = await app.persistence.getAuthUserByEmail(Env.INITIAL_ADMIN_EMAIL);
  if (!existing) {
    app.log.warn({
      msg: "admin_bootstrap_pending",
      email: Env.INITIAL_ADMIN_EMAIL,
      reason: "no user matches INITIAL_ADMIN_EMAIL; admin will be promoted on first sign-in",
    });
    return;
  }

  if (existing.deactivatedAt || existing.deletedAt) {
    app.log.warn({
      msg: "admin_bootstrap_skipped_inactive_user",
      email: Env.INITIAL_ADMIN_EMAIL,
      userId: existing.userId,
    });
    return;
  }

  await app.persistence.promoteUserToAdminByEmail(Env.INITIAL_ADMIN_EMAIL, "admin_promote_startup");
}

export async function buildApp(options: BuildAppOptions = {}): Promise<AppInstance> {
  const app = Fastify({
    logger: {
      serializers: {
        req(request: { method?: string; url?: string; hostname?: string; remoteAddress?: string; remotePort?: number }) {
          return {
            method: request.method,
            url: typeof request.url === "string" ? redactRequestUrl(request.url) : request.url,
            hostname: request.hostname,
            remoteAddress: request.remoteAddress,
            remotePort: request.remotePort,
          };
        },
      },
    },
  }) as AppInstance;
  app.decorateRequest("__sessionType", undefined);
  const persistenceBackend = options.persistenceBackend ?? Env.PERSISTENCE_BACKEND;
  const seedMemoryCatalog = options.seedMemoryCatalog ?? (persistenceBackend === "memory" && Env.NODE_ENV !== "test");
  const seedDevBypassUser = persistenceBackend === "memory" && Env.AUTH_MODE === "dev_bypass";
  app.persistence = createPersistence(persistenceBackend, {
    seedMemoryCatalog,
    seedDevBypassUser,
    postgresPoolMax: options.postgresPoolMax,
  });

  // KZO-198: bind the app_config TTL cache to live persistence + eager pre-
  // warm BEFORE downstream init that consumes effective values (e.g. the
  // market-data registry's real-vs-mock provider gate, pg-boss queue options
  // sourced from `getEffectiveBackfillRetryLimit`). Without this, those
  // consumers read env-only defaults at boot and the DB override silently
  // never takes effect on the first run after deploy. Failures here don't
  // block boot — resolvers gracefully fall back to env.
  const { setAppConfigCachePersistence, refresh: refreshAppConfigCache } =
    await import("./services/appConfig/cache.js");
  setAppConfigCachePersistence(app.persistence);
  // Note: persistence.init() (line below) creates the singleton row; we call
  // it BEFORE the eager pre-warm so the SELECT in `getAppConfig()` succeeds.
  await app.persistence.init();
  try {
    await refreshAppConfigCache();
  } catch (err) {
    app.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "app_config_cache_prewarm_failed",
    );
  }

  app.marketDataRegistry = buildMarketDataRegistry(Env, app.log, app.persistence);
  app.fundamentalsRegistry = buildFundamentalsRegistry(Env);
  registerTradingCalendarCache(app, { persistence: app.persistence });
  registerProviderHealth(app, { persistence: app.persistence });
  // KZO-172: Yahoo's ToS limits use to personal/non-commercial. Surface the constraint
  // at boot time so operators see the notice in production logs (NOT in mock mode —
  // the mock provider doesn't touch Yahoo). Spike §7.3 documents the EODHD switch
  // triggers; a future operator-targeted persistence method (`persistence.countUsers`)
  // could enrich this with a `userCount` field — intentionally NOT added here per the
  // scope-todo's "do NOT add a new persistence method" guard.
  if (!Env.AU_PROVIDER_MOCK) {
    app.log.warn(
      { provider: "yahoo-finance-au" },
      "yahoo_finance_tos_notice: ToS limits use to personal/non-commercial. For multi-tenant deployment, switch to EODHD per spike §7.3.",
    );
  }
  if (!Env.KR_PROVIDER_MOCK) {
    app.log.warn(
      { provider: "yahoo-finance-kr" },
      "yahoo_finance_tos_notice: ToS limits use to personal/non-commercial. For multi-tenant deployment, switch to a commercial market-data provider before multi-tenant production use.",
    );
  }
  const ebBackend = options.eventBusBackend ?? options.persistenceBackend;
  app.eventBus = createEventBus(ebBackend);
  // BufferedEventBus has no init() — it handles pub/sub locally via EventEmitter.
  // The inner RedisEventBus.init() (Redis connect) is intentionally skipped in
  // single-instance mode. When cross-instance pub/sub is needed (KZO-121),
  // BufferedEventBus should expose init() to initialize the inner transport.
  if ("init" in app.eventBus && typeof (app.eventBus as { init?: () => Promise<void> }).init === "function") {
    await (app.eventBus as { init: () => Promise<void> }).init();
  }
  app.oauthConfig = options.oauthConfig !== undefined ? options.oauthConfig : Env.getGoogleOAuthEnvConfig();
  app.appBaseUrl = options.appBaseUrl ?? Env.APP_BASE_URL ?? "http://localhost:3000";
  // KZO-198: a defensive `onReady` re-warm guards the ready-chain transition.
  // The eager pre-warm above gives downstream init (registry, queue options)
  // the hot cache; this hook keeps the cache fresh if `app.ready()` is called
  // long after `buildApp()` returns (idempotent — coalesces under in-flight
  // refresh).
  app.addHook("onReady", async () => {
    try {
      await refreshAppConfigCache();
    } catch (err) {
      app.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "app_config_cache_prewarm_failed",
      );
    }
  });
  await bootstrapAdminAccess(app);

  // KZO-37: Fire-and-forget dividend ledger backfill on boot. Brings stored
  // expected_cash_amount / eligible_quantity / expected_stock_quantity into
  // sync with current trades for any entries that were posted before Rule B
  // recompute went live. Does NOT reset reconciliation_status (4b).
  // Deferred to setImmediate so the ready-check is never blocked.
  setImmediate(async () => {
    try {
      const { runDividendLedgerBackfill } = await import("./services/dividends.js");
      const applied = await runDividendLedgerBackfill(app.persistence);
      if (applied > 0) {
        app.log.info({ msg: "dividend_ledger_backfill_applied", count: applied });
      }
    } catch (error) {
      app.log.warn({
        msg: "dividend_ledger_backfill_failed",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.addHook("onClose", async () => {
    await app.eventBus.close();
    await app.persistence.close();
  });

  const allowedOrigins = Env.getAllowedOrigins();
  const normalizedAllowed = new Set(allowedOrigins.map(Env.normalizeOrigin));
  await app.register(cors, {
    delegator(req, callback) {
      const origin = requestOrigin(req);
      if (!origin) {
        callback(null, { credentials: true, origin: true });
        return;
      }

      if (normalizedAllowed.has(Env.normalizeOrigin(origin))) {
        callback(null, { credentials: true, origin: true });
        return;
      }

      if ((Env.NODE_ENV === "development" || Env.NODE_ENV === "test") && isLocalDevOrigin(origin)) {
        callback(null, { credentials: true, origin: true });
        return;
      }

      if (isOpenAiAppsMcpCorsOrigin(origin) && isOpenAiAppsCorsPath(req)) {
        callback(null, {
          origin: true,
          methods: [...OPENAI_APPS_MCP_CORS_METHODS],
          exposedHeaders: [...OPENAI_APPS_MCP_CORS_EXPOSED_HEADERS],
          maxAge: 600,
        });
        return;
      }

      callback(null, { origin: false });
    },
  });

  app.addHook("onRequest", async (req, reply) => {
    if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return;
    // /__e2e/* paths are test-only (gated by assertE2ESeedEnabled /
    // assertE2EOauthSessionEnabled) and unreachable in production. Counting
    // them against the global mutation budget causes E2E suite flakiness as
    // fixture mints and seed calls exhaust the 120/60s limit.
    if (req.url.startsWith("/__e2e/")) return;

    const key = getRateLimitKey(req);
    const now = Date.now();
    const windowMs = Env.RATE_LIMIT_WINDOW_MS;
    const limit = Env.RATE_LIMIT_MAX_MUTATIONS;
    const existing = mutationBuckets.get(key);

    if (!existing || now - existing.windowStartedAt >= windowMs) {
      mutationBuckets.set(key, { count: 1, windowStartedAt: now });
      return;
    }

    existing.count += 1;
    mutationBuckets.set(key, existing);

    if (existing.count > limit) {
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (req.__clearSessionCookie) {
      appendSetCookieHeader(reply, sessionClearCookieString());
    }
    if (req.__clearImpersonationCookie) {
      appendSetCookieHeader(reply, impersonationClearCookieString());
    }
    if (req.__sessionType) {
      reply.header("x-session-type", req.__sessionType);
    }
    if (shouldStampContextFallback(req)) {
      reply.header(CONTEXT_FALLBACK_HEADER, "revoked");
      appendSetCookieHeader(reply, contextClearCookieString());
    }
  });

  app.addHook("preHandler", async (req) => {
    const routeUrl = req.routeOptions.url;
    if (!routeUrl || isPublicRoute(req.method, routeUrl)) {
      return;
    }

    await hydrateAuthContext(app, req);
    await enforceRouteRole(req);
  });

  app.setErrorHandler((error: HttpishError, req, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      });
    }

    if (typeof error.statusCode === "number") {
      return reply.code(error.statusCode).send({
        error: error.code ?? "request_error",
        message: error.message,
        ...(error.metadata ? { metadata: error.metadata } : {}),
      });
    }

    const known = isKnownClientError(error.message ?? "");
    if (known) {
      return reply.code(known.statusCode).send({ error: known.code, message: error.message });
    }

    req.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.boss = null;
  await registerRoutes(app);
  await registerMcpRoutes(app);
  if (options.registerWorkers !== false) {
    await registerPgBoss(app, options.persistenceBackend);
  }
  return app;
}
