import { createHash, createHmac, randomBytes, timingSafeEqual, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  AiConnectorClientKind,
  AiConnectorPolicySettingsDto,
  AiConnectorProvider,
  AiConnectorReadinessDto,
  AiConnectorScope,
} from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import { getMcpClientByKind, getMcpClientByLegacyProvider, legacyProviderForClientKind, MCP_CLIENT_REGISTRY } from "../mcp/clientRegistry.js";
import {
  researchAcquisitionEnabled,
  researchMcpExposureEnabled,
  researchSkillExposureEnabled,
  researchScopeAcquisitionAllowed,
} from "../mcp/tools.js";
import type {
  AiConnectorPolicySettingsRecord,
  AiConnectorConnectionRecord,
  AuditLogInput,
  SaveAiConnectorConnectionInput,
  SaveAiConnectorPolicySettingsInput,
} from "../persistence/types.js";

const FRESH_AUTH_HEADER = "x-vakwen-fresh-auth-at";
const FRESH_AUTH_TOKEN_VERSION = 1;
const GENERATED_BEARER_TOKEN_PREFIX = "vakwen-mcpb";

interface McpFreshAuthTokenPayload {
  v: typeof FRESH_AUTH_TOKEN_VERSION;
  sub: string;
  sv: number;
  iat: number;
  nonce: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sessionSecretForApp(app: FastifyInstance): string {
  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required for MCP fresh-auth token verification");
  }
  return sessionSecret;
}

function signFreshAuthPayload(payload: string, sessionSecret: string): string {
  return createHmac("sha256", sessionSecret).update(payload).digest("hex");
}

function verifyFreshAuthSignature(payload: string, receivedSignature: string, sessionSecret: string): boolean {
  const expectedSignature = signFreshAuthPayload(payload, sessionSecret);
  try {
    const expected = Buffer.from(expectedSignature, "hex");
    const received = Buffer.from(receivedSignature, "hex");
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

function parseFreshAuthToken(token: string, sessionSecret: string): McpFreshAuthTokenPayload | null {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || token.split(".").length !== 2) return null;
  if (!verifyFreshAuthSignature(payload, signature, sessionSecret)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<McpFreshAuthTokenPayload>;
    if (
      parsed.v !== FRESH_AUTH_TOKEN_VERSION ||
      typeof parsed.sub !== "string" ||
      !Number.isInteger(parsed.sv) ||
      !Number.isInteger(parsed.iat) ||
      typeof parsed.nonce !== "string" ||
      parsed.nonce.length < 16
    ) {
      return null;
    }
    return parsed as McpFreshAuthTokenPayload;
  } catch {
    return null;
  }
}

function activeConnection(record: AiConnectorConnectionRecord, nowMs = Date.now()): boolean {
  return record.status === "active" && (!record.expiresAt || Date.parse(record.expiresAt) > nowMs);
}

function addDaysIso(days: number, nowMs = Date.now()): string {
  return new Date(nowMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function hashGeneratedBearerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isGeneratedBearerToken(token: string): boolean {
  return token.startsWith(`${GENERATED_BEARER_TOKEN_PREFIX}.`);
}

function createGeneratedBearerToken(): string {
  return `${GENERATED_BEARER_TOKEN_PREFIX}.${randomBytes(32).toString("base64url")}`;
}

function notificationTitle(status: "expiring" | "expired" | "revoked"): string {
  if (status === "expiring") return "AI connector expiring soon";
  if (status === "revoked") return "AI connector revoked";
  return "AI connector expired";
}

async function createConnectorNotification(
  app: FastifyInstance,
  connection: AiConnectorConnectionRecord,
  status: "expiring" | "expired" | "revoked",
  detail?: Record<string, unknown>,
): Promise<void> {
  const notificationId = await app.persistence.createNotification({
    userId: connection.userId,
    severity: status === "expiring" ? "warning" : "info",
    source: "ai_connector",
    sourceRef: connection.id,
    title: notificationTitle(status),
    body: `${connection.displayName} (${connection.provider}) ${status === "expiring" ? "expires soon" : `was ${status}`}.`,
    detail: {
      connectionId: connection.id,
      provider: connection.provider,
      status,
      ...detail,
    },
  });
  await app.eventBus.publishEvent(connection.userId, "ai_connector_notification", {
    connectionId: connection.id,
    provider: connection.provider,
    status,
    notificationId,
  });
}

export function connectorGroupForScope(scope: AiConnectorScope): "read" | "research" | "drafts" | "write" {
  if (scope === "portfolio:mcp_read") return "read";
  if (scope === "research:read") return "research";
  if (scope === "transaction:write" || scope === "dividend:write" || scope === "account:manage") return "write";
  return "drafts";
}

export function buildAiConnectorReadiness(settings: AiConnectorPolicySettingsRecord): AiConnectorReadinessDto {
  const endpoint = settings.oauthPublicIssuer ? `${settings.oauthPublicIssuer.replace(/\/$/, "")}/mcp` : "/mcp";
  const enabledClientKindCount = MCP_CLIENT_REGISTRY.filter((client) => settings.allowedClientKinds[client.clientKind]).length;
  const anyToolGroupEnabled = settings.groupToggles.read || settings.groupToggles.research || settings.groupToggles.drafts || settings.groupToggles.write;
  const publicIssuerConfigured = Boolean(settings.oauthPublicIssuer);
  const checks: AiConnectorReadinessDto["checks"] = [
    { key: "deployment", status: settings.enabled ? "ok" : "blocked" },
    { key: "public_issuer", status: publicIssuerConfigured ? "ok" : "warning" },
    { key: "oauth_token_secret", status: settings.oauthTokenSecretSet ? "ok" : "warning" },
    { key: "mcp_url", status: publicIssuerConfigured ? "ok" : "warning" },
    { key: "client_kind_policy", status: enabledClientKindCount > 0 ? "ok" : "blocked" },
    { key: "high_risk_tools", status: settings.groupToggles.write ? "warning" : "info" },
    { key: "bearer_fallback", status: settings.bearerFallback.enabled ? "warning" : "info" },
  ];
  const hasBlockedCheck = checks.some((check) => check.status === "blocked");
  const hasWarningCheck = checks.some((check) => check.status === "warning");
  return {
    status: !settings.enabled || !anyToolGroupEnabled || hasBlockedCheck ? "disabled" : hasWarningCheck ? "degraded" : "ready",
    endpoint,
    deploymentEnabled: settings.enabled,
    publicIssuerConfigured,
    oauthTokenSecretConfigured: settings.oauthTokenSecretSet,
    mcpUrlReady: publicIssuerConfigured,
    enabledClientKindCount,
    totalClientKindCount: MCP_CLIENT_REGISTRY.length,
    highRiskToolsEnabled: settings.groupToggles.write,
    bearerFallbackEnabled: settings.bearerFallback.enabled,
    checks,
  };
}

export function toAiConnectorPolicySettingsDto(settings: AiConnectorPolicySettingsRecord): AiConnectorPolicySettingsDto {
  return {
    ...settings,
    researchRollout: {
      acquisitionEnabled: researchAcquisitionEnabled(),
      mcpExposureEnabled: researchMcpExposureEnabled(),
      skillExposureEnabled: researchSkillExposureEnabled(),
    },
    readiness: buildAiConnectorReadiness(settings),
  };
}

export function createMcpFreshAuthToken(app: FastifyInstance, req: FastifyRequest, nowMs = Date.now()): string {
  if (!req.authContext) {
    throw routeError(401, "auth_required", "authentication required");
  }
  const payload: McpFreshAuthTokenPayload = {
    v: FRESH_AUTH_TOKEN_VERSION,
    sub: req.authContext.sessionUserId,
    sv: req.authContext.sessionVersion,
    iat: nowMs,
    nonce: randomBytes(12).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${signFreshAuthPayload(encodedPayload, sessionSecretForApp(app))}`;
}

export function assertFreshAuth(
  app: FastifyInstance,
  req: FastifyRequest,
  settings: Pick<AiConnectorPolicySettingsDto, "freshAuthMaxAgeMs">,
): void {
  if (!req.authContext) {
    throw routeError(401, "auth_required", "authentication required");
  }
  const raw = req.headers[FRESH_AUTH_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    throw routeError(403, "mcp_fresh_auth_required", "Fresh authentication is required for AI connector policy changes");
  }
  const parsed = parseFreshAuthToken(value, sessionSecretForApp(app));
  if (!parsed) {
    throw routeError(400, "mcp_fresh_auth_invalid", "Fresh authentication token is invalid");
  }
  if (parsed.sub !== req.authContext.sessionUserId || parsed.sv !== req.authContext.sessionVersion) {
    throw routeError(403, "mcp_fresh_auth_required", "Fresh authentication is required for AI connector policy changes");
  }
  const ageMs = Date.now() - parsed.iat;
  if (ageMs < 0 || ageMs > settings.freshAuthMaxAgeMs) {
    throw routeError(403, "mcp_fresh_auth_required", "Fresh authentication is required for AI connector policy changes");
  }
}

export async function updateAiConnectorPolicySettings(
  app: FastifyInstance,
  input: SaveAiConnectorPolicySettingsInput,
  audit: Omit<AuditLogInput, "action">,
): Promise<AiConnectorPolicySettingsDto> {
  const before = await app.persistence.getAiConnectorPolicySettings();
  const after = await app.persistence.saveAiConnectorPolicySettings(input);
  await app.persistence.appendAuditLog({
    ...audit,
    action: "app_config_updated",
    metadata: {
      type: "ai_connector_policy",
      before,
      after,
    },
  });
  return toAiConnectorPolicySettingsDto(after);
}

export async function createAiConnectorConnection(
  app: FastifyInstance,
  input: Omit<SaveAiConnectorConnectionInput, "id" | "status"> & {
    id?: string;
    provider: AiConnectorProvider;
  },
  audit: Omit<AuditLogInput, "action" | "targetUserId">,
): Promise<AiConnectorConnectionRecord> {
  const settings = await app.persistence.getAiConnectorPolicySettings();
  const clientKind = input.clientKind ?? getMcpClientByLegacyProvider(input.provider).clientKind;
  if (!settings.enabled) {
    throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
  }
  const clientAllowed = settings.allowedClientKinds?.[clientKind] ?? settings.allowedProviders[input.provider];
  if (!clientAllowed) {
    throw routeError(403, "mcp_client_kind_disabled", `AI connector client kind ${clientKind} is disabled`);
  }
  const existing = await app.persistence.listAiConnectorConnectionsForUser(input.userId);
  for (const connection of existing) {
    if (
      connection.provider === input.provider
      && connection.status === "active"
      && connection.expiresAt
      && Date.parse(connection.expiresAt) <= Date.now()
    ) {
      await expireAiConnectorConnection(app, connection, "absolute_expiry");
    }
  }
  const refreshedExisting = await app.persistence.listAiConnectorConnectionsForUser(input.userId);
  const activeCount = refreshedExisting.filter((connection) => activeConnection(connection)).length;
  if (activeCount >= settings.maxActiveConnectionsPerUser) {
    throw routeError(409, "mcp_connection_limit_exceeded", "AI connector connection limit exceeded");
  }

  const scopes = [...new Set(input.scopes)].filter((scope) => (
    settings.groupToggles[connectorGroupForScope(scope)]
    && (scope !== "research:read" || researchScopeAcquisitionAllowed())
  ));
  if (scopes.length === 0) {
    throw routeError(403, "mcp_all_requested_scopes_disabled", "All requested AI connector scope groups are disabled");
  }

  const record = await app.persistence.saveAiConnectorConnection({
    ...input,
    id: input.id ?? randomUUID(),
    status: "active",
    scopes,
  });
  await app.persistence.appendAuditLog({
    ...audit,
    action: "ai_connector_connected",
    targetUserId: input.userId,
    metadata: {
      connectionId: record.id,
      provider: record.provider,
      vendor: record.vendor,
      clientKind: record.clientKind,
      authMode: record.authMode,
      scopes: record.scopes,
      expiresAt: record.expiresAt,
    },
  });
  return record;
}

export async function createAiConnectorBearerFallback(
  app: FastifyInstance,
  input: {
    userId: string;
    clientKind: Exclude<AiConnectorClientKind, "chatgpt_app" | "claude_ai_connector">;
    displayName: string;
    scopes: AiConnectorScope[];
    lifetimeDays: number;
  },
  audit: Omit<AuditLogInput, "action" | "targetUserId">,
): Promise<{
  connection: AiConnectorConnectionRecord;
  bearerToken: string;
  tokenHint: string;
  expiresAt: string;
}> {
  const authUser = await app.persistence.getAuthUserById(input.userId);
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
    throw routeError(401, "mcp_auth_invalid_user", "MCP bearer token user is not active");
  }

  const settings = await app.persistence.getAiConnectorPolicySettings();
  const client = getMcpClientByKind(input.clientKind);
  if (!client.supportedAuthModes.includes("bearer")) {
    throw routeError(403, "mcp_bearer_client_kind_unsupported", "Bearer fallback is not supported for this AI client");
  }
  if (!settings.bearerFallback.enabled) {
    throw routeError(403, "mcp_bearer_fallback_disabled", "Bearer fallback is disabled by admin policy");
  }
  if (!settings.allowedClientKinds[input.clientKind]) {
    throw routeError(403, "mcp_client_kind_disabled", `AI connector client kind ${input.clientKind} is disabled`);
  }
  if (!settings.bearerFallback.allowedClientKinds.includes(input.clientKind)) {
    throw routeError(403, "mcp_bearer_client_kind_disabled", `Bearer fallback is disabled for AI client ${input.clientKind}`);
  }

  const existing = await app.persistence.listAiConnectorConnectionsForUser(input.userId);
  const duplicateActiveBearer = existing.find((connection) =>
    connection.authMode === "bearer"
    && connection.vendor === client.vendor
    && connection.clientKind === client.clientKind
    && activeConnection(connection)
  );
  if (duplicateActiveBearer) {
    throw routeError(409, "mcp_bearer_connection_exists", "An active bearer fallback connector already exists for this AI client");
  }
  const activeBearerCount = existing.filter((connection) =>
    connection.authMode === "bearer" && activeConnection(connection)
  ).length;
  if (activeBearerCount >= settings.bearerFallback.maxActiveConnectorsPerUser) {
    throw routeError(409, "mcp_bearer_connection_limit_exceeded", "Bearer fallback connector limit exceeded");
  }

  const allowedScopes = [...new Set(input.scopes)].filter((scope) =>
    settings.bearerFallback.allowedToolGroups.includes(connectorGroupForScope(scope))
  );
  if (allowedScopes.length === 0) {
    throw routeError(403, "mcp_bearer_scopes_disabled", "All requested bearer fallback scope groups are disabled");
  }

  const expiresAt = addDaysIso(Math.min(
    input.lifetimeDays,
    settings.maxConnectorLifetimeDays,
    settings.bearerFallback.maxLifetimeDays,
  ));
  const connection = await createAiConnectorConnection(
    app,
    {
      userId: input.userId,
      provider: legacyProviderForClientKind(input.clientKind),
      vendor: client.vendor,
      clientKind: client.clientKind,
      authMode: "bearer",
      capabilities: client.capabilities,
      displayName: input.displayName,
      scopes: allowedScopes,
      expiresAt,
    },
    audit,
  );

  const bearerToken = createGeneratedBearerToken();
  try {
    await app.persistence.saveAiConnectorCredential({
      id: randomUUID(),
      connectionId: connection.id,
      credentialType: "bearer_token",
      tokenHash: hashGeneratedBearerToken(bearerToken),
      tokenHint: bearerToken.slice(-8),
      scopes: connection.scopes,
      sessionVersion: authUser.sessionVersion,
      expiresAt,
    });
  } catch (error) {
    try {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: audit.actorUserId ?? null,
        reason: "bearer_credential_create_failed",
        ipAddress: audit.ipAddress ?? null,
      });
    } catch (cleanupError) {
      app.log.error({ err: cleanupError, connectionId: connection.id }, "mcp_bearer_connector_cleanup_failed");
    }
    throw error;
  }

  return {
    connection,
    bearerToken,
    tokenHint: bearerToken.slice(-8),
    expiresAt,
  };
}

export async function revokeAiConnectorConnection(
  app: FastifyInstance,
  connectionId: string,
  input: {
    revokedByUserId: string | null;
    reason?: string | null;
    ipAddress?: string | null;
  },
): Promise<AiConnectorConnectionRecord> {
  const connection = await app.persistence.getAiConnectorConnection(connectionId);
  if (!connection) throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
  if (connection.status === "revoked") return connection;

  const now = nowIso();
  const next = await app.persistence.saveAiConnectorConnection({
    ...connection,
    status: "revoked",
    revokedAt: now,
    revokedByUserId: input.revokedByUserId,
    revocationReason: input.reason ?? "manual",
    updatedAt: now,
  });
  await app.persistence.revokeAiConnectorCredentialsForConnection(connection.id);
  await app.persistence.appendAuditLog({
    actorUserId: input.revokedByUserId,
    action: "ai_connector_revoked",
    targetUserId: connection.userId,
    ipAddress: input.ipAddress,
    metadata: {
      connectionId,
      provider: connection.provider,
      reason: input.reason ?? "manual",
    },
  });
  await createConnectorNotification(app, next, "revoked", { reason: input.reason ?? "manual" });
  return next;
}

export async function expireAiConnectorConnection(
  app: FastifyInstance,
  connection: AiConnectorConnectionRecord,
  reason: "absolute_expiry" | "inactivity_expiry",
): Promise<AiConnectorConnectionRecord> {
  if (connection.status === "expired") return connection;
  const now = nowIso();
  const next = await app.persistence.saveAiConnectorConnection({
    ...connection,
    status: "expired",
    expiryNotifiedAt: connection.expiryNotifiedAt ?? now,
    updatedAt: now,
  });
  await app.persistence.revokeAiConnectorCredentialsForConnection(connection.id);
  await app.persistence.appendAuditLog({
    actorUserId: null,
    action: "ai_connector_expired",
    targetUserId: connection.userId,
    metadata: {
      connectionId: connection.id,
      provider: connection.provider,
      reason,
    },
  });
  await createConnectorNotification(app, next, "expired", { reason });
  return next;
}

export async function maybeNotifyAiConnectorExpiringSoon(
  app: FastifyInstance,
  connection: AiConnectorConnectionRecord,
  settings: Pick<AiConnectorPolicySettingsDto, "expirationWarningDays">,
): Promise<AiConnectorConnectionRecord> {
  if (!connection.expiresAt || connection.expiryNotifiedAt) return connection;
  const warningMs = settings.expirationWarningDays * 24 * 60 * 60 * 1000;
  const expiresInMs = Date.parse(connection.expiresAt) - Date.now();
  if (expiresInMs < 0 || expiresInMs > warningMs) return connection;
  const notifiedAt = nowIso();
  const next = await app.persistence.saveAiConnectorConnection({
    ...connection,
    expiryNotifiedAt: notifiedAt,
    updatedAt: notifiedAt,
  });
  await createConnectorNotification(app, next, "expiring", { expiresAt: connection.expiresAt });
  return next;
}

export async function touchAiConnectorConnection(app: FastifyInstance, connection: AiConnectorConnectionRecord): Promise<void> {
  await app.persistence.saveAiConnectorConnection({
    ...connection,
    lastUsedAt: nowIso(),
  });
}
