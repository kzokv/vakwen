import { rememberVerifiedConnection } from "./authDiagnostics.js";
import { Buffer } from "node:buffer";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import type { McpAuthContext, McpAuthService, McpProtectedResourceMetadata } from "./types.js";
import { ALL_MCP_SCOPES } from "./tools.js";
import {
  connectorGroupForScope,
  expireAiConnectorConnection,
  hashGeneratedBearerToken,
  isGeneratedBearerToken,
  maybeNotifyAiConnectorExpiringSoon,
  revokeAiConnectorConnection,
  touchAiConnectorConnection,
} from "../services/mcpConnectorLifecycle.js";
import {
  getMcpOAuthIssuer,
  getMcpProtectedResourceMetadata,
  getMcpResourceUrl,
  getMcpOAuthTokenSecret,
  verifyMcpOAuthAccessToken,
} from "./oauth.js";
import { getMcpClientByLegacyProvider } from "./clientRegistry.js";
import type { AiConnectorConnectionRecord, AiConnectorPolicySettingsRecord } from "../persistence/types.js";

const devTokenPayloadSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  connectionId: z.string().trim().min(1).max(200).optional(),
  clientId: z.string().trim().min(1).max(200).optional(),
  scopes: z.array(z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES])).optional(),
});
const scopeSchema = z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES]);

function readBearerToken(req: FastifyRequest): string {
  const raw = req.headers.authorization;
  if (!raw || Array.isArray(raw)) {
    throw routeError(401, "mcp_auth_required", "Authorization bearer token required");
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw routeError(401, "mcp_auth_required", "Authorization bearer token required");
  }
  return match[1]!.trim();
}

function decodeDevToken(token: string) {
  const [, encoded] = token.split(".", 2);
  if (!encoded || !token.startsWith("vakwen-dev.")) {
    throw routeError(401, "mcp_auth_unconfigured", "MCP bearer token verification is not configured");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  return devTokenPayloadSchema.parse(decoded);
}

export function mcpDevTokenAllowedForRuntime(nodeEnv: string = Env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

function assertDevTokenAllowed(): void {
  if (!mcpDevTokenAllowedForRuntime()) {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
}

function parseOAuthScopeClaim(scope: string) {
  try {
    const parsed = scope
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    return [...new Set(parsed.map((item) => scopeSchema.parse(item)))];
  } catch {
    throw routeError(401, "mcp_auth_invalid_scope", "MCP bearer token scope is invalid");
  }
}

export class DefaultMcpAuthService implements McpAuthService {
  async authenticateRequest(app: FastifyInstance, req: FastifyRequest): Promise<McpAuthContext> {
    const token = readBearerToken(req);
    if (token.startsWith("vakwen-dev.")) {
      assertDevTokenAllowed();
      const payload = decodeDevToken(token);
      const authUser = await app.persistence.getAuthUserById(payload.userId);
      if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
        throw routeError(401, "mcp_auth_invalid_user", "MCP bearer token user is not active");
      }
      const policySettings = await app.persistence.getAiConnectorPolicySettings();
      if (!policySettings.enabled) {
        throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
      }

      if (payload.connectionId) {
        const connection = await app.persistence.getAiConnectorConnection(payload.connectionId);
        if (!connection || connection.userId !== authUser.userId) {
          throw routeError(401, "mcp_auth_invalid_connection", "MCP bearer token connection is not valid");
        }
        const notified = await this.validateConnection(app, req, connection, policySettings);
        return {
          token,
          clientId: payload.clientId ?? notified.oauthClientId ?? notified.id,
          sessionUserId: authUser.userId,
          connection: notified,
          scopes: [...notified.scopes],
          toolToggles: { ...notified.toolToggles },
          expiresAt: notified.expiresAt,
          authMode: "dev_token",
        };
      }

      return {
        token,
        clientId: payload.clientId ?? "vakwen-dev-client",
        sessionUserId: authUser.userId,
        connection: null,
        scopes: [...(payload.scopes ?? ALL_MCP_SCOPES)],
        toolToggles: {},
        expiresAt: null,
        authMode: "dev_token",
      };
    }

    if (isGeneratedBearerToken(token)) {
      return this.authenticateGeneratedBearerRequest(app, req, token);
    }

    return this.authenticateOAuthRequest(app, req, token);
  }

  private async authenticateOAuthRequest(
    app: FastifyInstance,
    req: FastifyRequest,
    token: string,
  ): Promise<McpAuthContext> {
    let payload;
    try {
      payload = verifyMcpOAuthAccessToken(await getMcpOAuthTokenSecret(app), token, { allowExpired: true });
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) throw error;
      throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
    }

    const issuer = await getMcpOAuthIssuer(app, req);
    const resource = await getMcpResourceUrl(app, req);
    if (payload.iss !== issuer || payload.aud !== resource || payload.resource !== resource) {
      throw routeError(401, "mcp_auth_invalid_audience", "MCP bearer token audience is invalid");
    }

    const authUser = await app.persistence.getAuthUserById(payload.sub);
    const connection = await app.persistence.getAiConnectorConnection(payload.connectionId);
    if (!authUser || !connection || connection.userId !== authUser.userId
      || connection.authMode !== "oauth" || connection.oauthClientId !== payload.client_id) {
      throw routeError(401, "mcp_auth_invalid_connection", "MCP bearer token connection is not valid");
    }
    rememberVerifiedConnection(req, connection);
    if (authUser.deactivatedAt || authUser.deletedAt) {
      throw routeError(401, "mcp_auth_invalid_user", "MCP bearer token user is not active");
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      throw routeError(401, "mcp_auth_expired", "MCP bearer token has expired");
    }
    if (authUser.sessionVersion !== payload.sv) {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "session_version_changed",
        ipAddress: req.ip ?? null,
      });
      throw routeError(401, "mcp_auth_invalid_session", "MCP bearer token session is no longer valid");
    }

    const policySettings = await app.persistence.getAiConnectorPolicySettings();
    if (!policySettings.enabled) {
      throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
    }
    const notified = await this.validateConnection(app, req, connection, policySettings);
    const tokenScopes = parseOAuthScopeClaim(payload.scope);
    const effectiveScopes = tokenScopes.filter((scope) => notified.scopes.includes(scope));
    return {
      token,
      clientId: payload.client_id,
      sessionUserId: authUser.userId,
      connection: notified,
      scopes: effectiveScopes,
      toolToggles: { ...notified.toolToggles },
      expiresAt: notified.expiresAt,
      authMode: "oauth",
    };
  }

  private async authenticateGeneratedBearerRequest(
    app: FastifyInstance,
    req: FastifyRequest,
    token: string,
  ): Promise<McpAuthContext> {
    const credential = await app.persistence.getAiConnectorCredentialByHash(hashGeneratedBearerToken(token));
    if (!credential || credential.credentialType !== "bearer_token") {
      throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
    }

    const connection = await app.persistence.getAiConnectorConnection(credential.connectionId);
    if (!connection) {
      throw routeError(401, "mcp_auth_invalid_connection", "MCP bearer token connection is not valid");
    }
    rememberVerifiedConnection(req, connection);
    if (connection.status === "expired") {
      const expiryReason = connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()
        ? "absolute_expiry"
        : "inactivity_expiry";
      await expireAiConnectorConnection(app, connection, expiryReason);
      throw routeError(401, "mcp_connection_expired", "MCP connector connection has expired");
    }
    if (credential.revokedAt || credential.replacedByCredentialId) {
      const replaced = connection.revocationReason === "replaced_by_oauth_authorization";
      throw routeError(401, replaced ? "mcp_connection_replaced" : "mcp_connection_revoked",
        replaced ? "MCP connector connection was replaced" : "MCP connector credential was revoked");
    }
    if (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) {
      await expireAiConnectorConnection(app, connection, "absolute_expiry");
      throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
    }
    const authUser = await app.persistence.getAuthUserById(connection.userId);
    if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
      throw routeError(401, "mcp_auth_invalid_user", "MCP bearer token user is not active");
    }
    if (credential.sessionVersion !== null && credential.sessionVersion !== authUser.sessionVersion) {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "session_version_changed",
        ipAddress: req.ip ?? null,
      });
      throw routeError(401, "mcp_auth_invalid_session", "MCP bearer token session is no longer valid");
    }

    const policySettings = await app.persistence.getAiConnectorPolicySettings();
    if (!policySettings.enabled) {
      throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
    }
    const clientKind = connection.clientKind ?? getMcpClientByLegacyProvider(connection.provider).clientKind;
    if (!policySettings.bearerFallback.enabled) {
      throw routeError(403, "mcp_bearer_fallback_disabled", "MCP bearer fallback is disabled");
    }
    if (!policySettings.bearerFallback.allowedClientKinds.includes(clientKind)) {
      throw routeError(403, "mcp_bearer_client_kind_disabled", `MCP bearer fallback is disabled for ${clientKind}`);
    }
    const bearerAllowedScopes = credential.scopes.filter((scope) =>
      policySettings.bearerFallback.allowedToolGroups.includes(connectorGroupForScope(scope))
    );
    if (credential.scopes.length > 0 && bearerAllowedScopes.length === 0) {
      throw routeError(403, "mcp_bearer_tool_group_disabled", "MCP bearer fallback is disabled for token tool groups");
    }
    const notified = await this.validateConnection(app, req, connection, policySettings);
    return {
      token,
      clientId: notified.clientKind,
      sessionUserId: authUser.userId,
      connection: notified,
      scopes: bearerAllowedScopes.filter((scope) => notified.scopes.includes(scope)),
      toolToggles: { ...notified.toolToggles },
      expiresAt: credential.expiresAt ?? notified.expiresAt,
      authMode: "bearer",
    };
  }

  private async validateConnection(
    app: FastifyInstance,
    req: FastifyRequest,
    connection: AiConnectorConnectionRecord,
    policySettings: AiConnectorPolicySettingsRecord,
  ) {
    const clientKind = connection.clientKind ?? getMcpClientByLegacyProvider(connection.provider).clientKind;
    const clientAllowed = policySettings.allowedClientKinds?.[clientKind] ?? policySettings.allowedProviders[connection.provider];
    if (!clientAllowed) {
      throw routeError(403, "mcp_client_kind_disabled", `AI connector client kind ${clientKind} is disabled`);
    }
    if (connection.status !== "active") {
      if (connection.status === "expired") {
        const expiryReason = connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()
          ? "absolute_expiry"
          : "inactivity_expiry";
        await expireAiConnectorConnection(app, connection, expiryReason);
        throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired");
      }
      if (connection.status === "revoked") {
        const replaced = connection.revocationReason === "replaced_by_oauth_authorization";
        throw routeError(403, replaced ? "mcp_connection_replaced" : "mcp_connection_revoked",
          replaced ? "MCP connector connection was replaced" : "MCP connector connection was revoked");
      }
      throw routeError(403, "mcp_connection_inactive", "MCP connector connection is not active");
    }
    if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()) {
      await expireAiConnectorConnection(app, connection, "absolute_expiry");
      throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired");
    }
    const inactiveSince = Date.parse(connection.lastUsedAt ?? connection.createdAt);
    const inactivityMs = policySettings.inactivityExpiryDays * 24 * 60 * 60 * 1000;
    if (Number.isFinite(inactiveSince) && Date.now() - inactiveSince > inactivityMs) {
      await expireAiConnectorConnection(app, connection, "inactivity_expiry");
      throw routeError(403, "mcp_connection_expired", "MCP connector connection has expired due to inactivity");
    }
    const notified = await maybeNotifyAiConnectorExpiringSoon(app, connection, policySettings);
    await touchAiConnectorConnection(app, notified);
    return notified;
  }

  getProtectedResourceMetadata(app: FastifyInstance, req: FastifyRequest): Promise<McpProtectedResourceMetadata> {
    return getMcpProtectedResourceMetadata(app, req);
  }
}
