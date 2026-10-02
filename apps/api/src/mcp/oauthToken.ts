import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Env } from "@vakwen/config";
import type { AiConnectorScope } from "@vakwen/shared-types";
import type { SaveAiConnectorCredentialInput } from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import { expireAiConnectorConnection, revokeAiConnectorConnection } from "../services/mcpConnectorLifecycle.js";
import {
  CLIENT_ASSERTION_MAX_CHARS,
  CLIENT_ASSERTION_TYPE_JWT_BEARER,
  validateOAuthTokenClient,
} from "./oauthClientAuth.js";
import {
  base64UrlJson,
  constantTimeEqual,
  getMcpOAuthTokenSecret,
  hashMcpOAuthToken,
  hmac,
  randomToken,
  sha256Base64Url,
} from "./oauthCrypto.js";
import { sendOAuthError, setMcpOAuthNoStoreHeaders } from "./oauthHttp.js";
import { getMcpOAuthIssuer } from "./oauthMetadata.js";

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const tokenBodySchema = z.discriminatedUnion("grant_type", [
  z.object({
    grant_type: z.literal("authorization_code"),
    code: z.string().trim().min(1),
    redirect_uri: z.string().url().optional(),
    client_id: z.string().trim().min(1).max(2048),
    code_verifier: z.string().trim().min(43).max(256),
    resource: z.string().url().optional(),
    client_assertion_type: z.literal(CLIENT_ASSERTION_TYPE_JWT_BEARER).optional(),
    client_assertion: z.string().trim().min(1).max(CLIENT_ASSERTION_MAX_CHARS).optional(),
  }).passthrough(),
  z.object({
    grant_type: z.literal("refresh_token"),
    refresh_token: z.string().trim().min(1),
    client_id: z.string().trim().min(1).max(2048),
    resource: z.string().url().optional(),
    client_assertion_type: z.literal(CLIENT_ASSERTION_TYPE_JWT_BEARER).optional(),
    client_assertion: z.string().trim().min(1).max(CLIENT_ASSERTION_MAX_CHARS).optional(),
  }).passthrough(),
]);

const accessTokenPayloadSchema = z.object({
  iss: z.string().url(),
  aud: z.string().url(),
  resource: z.string().url(),
  sub: z.string().min(1),
  connectionId: z.string().min(1),
  client_id: z.string().min(1),
  sv: z.number().int().nonnegative(),
  scope: z.string(),
  iat: z.number().int(),
  exp: z.number().int(),
  jti: z.string().min(1),
});

export type McpOAuthAccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

function signAccessToken(secret: string, payload: McpOAuthAccessTokenPayload): string {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT", kid: "mcp-oauth-v1" });
  const body = base64UrlJson(payload);
  return `${header}.${body}.${hmac(secret, `${header}.${body}`)}`;
}

export function verifyMcpOAuthAccessToken(
  secret: string,
  token: string,
  options?: { allowExpired?: boolean },
): McpOAuthAccessTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  const [header, body, signature] = parts as [string, string, string];
  const expected = hmac(secret, `${header}.${body}`);
  if (!constantTimeEqual(expected, signature)) {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  let decodedHeader: { alg?: string; typ?: string };
  let decodedPayload: unknown;
  try {
    decodedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string; typ?: string };
    decodedPayload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  if (decodedHeader.alg !== "HS256") {
    throw routeError(401, "mcp_auth_invalid", "Invalid MCP bearer token");
  }
  const payload = accessTokenPayloadSchema.parse(decodedPayload);
  if (!options?.allowExpired && payload.exp <= Math.floor(Date.now() / 1000)) {
    throw routeError(401, "mcp_auth_expired", "MCP bearer token has expired");
  }
  return payload;
}

async function issueTokens(input: {
  app: FastifyInstance;
  req: FastifyRequest;
  connectionId: string;
  userId: string;
  clientId: string;
  resource: string;
  scopes: AiConnectorScope[];
  refreshExpiresAt: string | null;
  refreshCredentialId?: string;
  predecessorCredentialId?: string | null;
  tokenFamilyId?: string | null;
  persistCredential?: (credential: SaveAiConnectorCredentialInput) => Promise<void>;
}) {
  const secret = await getMcpOAuthTokenSecret(input.app);
  const authUser = await input.app.persistence.getAuthUserById(input.userId);
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
    throw routeError(401, "mcp_auth_invalid_user", "MCP OAuth user is not active");
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const accessToken = signAccessToken(secret, {
    iss: await getMcpOAuthIssuer(input.app, input.req),
    aud: input.resource,
    resource: input.resource,
    sub: input.userId,
    connectionId: input.connectionId,
    client_id: input.clientId,
    sv: authUser.sessionVersion,
    scope: input.scopes.join(" "),
    iat: nowSeconds,
    exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomUUID(),
  });
  const refreshToken = randomToken(48);
  const refreshCredentialId = input.refreshCredentialId ?? randomUUID();
  const familyId = input.tokenFamilyId ?? randomUUID();
  const persistCredential = input.persistCredential ?? ((credential: SaveAiConnectorCredentialInput) => input.app.persistence.saveAiConnectorCredential(credential));
  await persistCredential({
    id: refreshCredentialId,
    connectionId: input.connectionId,
    credentialType: "oauth_refresh_token",
    tokenHash: hashMcpOAuthToken(secret, refreshToken),
    tokenHint: refreshToken.slice(-8),
    tokenFamilyId: familyId,
    predecessorCredentialId: input.predecessorCredentialId ?? null,
    oauthClientId: input.clientId,
    resource: input.resource,
    scopes: input.scopes,
    sessionVersion: authUser.sessionVersion,
    expiresAt: input.refreshExpiresAt,
  });
  if (input.predecessorCredentialId) {
    await input.app.persistence.revokeAiConnectorCredential(input.predecessorCredentialId, refreshCredentialId);
  }
  return {
    token_type: "Bearer",
    access_token: accessToken,
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: input.scopes.join(" "),
  };
}

export async function handleMcpOAuthToken(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | Record<string, unknown>> {
  setMcpOAuthNoStoreHeaders(reply);

  let body: z.infer<typeof tokenBodySchema>;
  try {
    body = tokenBodySchema.parse(req.body);
  } catch {
    return sendOAuthError(reply, 400, "invalid_request", "OAuth token request is invalid");
  }

  try {
    await validateOAuthTokenClient(body, `${await getMcpOAuthIssuer(app, req)}/oauth/token`);
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "invalid_client";
    return sendOAuthError(reply, 400, code, error instanceof Error ? error.message : "OAuth client authentication failed");
  }

  let secret: string;
  try {
    secret = await getMcpOAuthTokenSecret(app);
  } catch {
    return sendOAuthError(reply, 503, "server_error", "MCP OAuth token secret is not configured");
  }

  if (body.grant_type === "authorization_code") {
    if (!Env.MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED) return sendOAuthError(reply, 503, "temporarily_unavailable", "New authorizations are temporarily paused; retry later");
    const code = await app.persistence.consumeMcpOAuthAuthorizationCode(hashMcpOAuthToken(secret, body.code));
    if (!code) return sendOAuthError(reply, 400, "invalid_grant", "Authorization code is invalid or expired");
    const redirectUri = body.redirect_uri ?? code.redirectUri;
    const resource = body.resource ?? code.resource;
    if (
      code.clientId !== body.client_id
      || code.redirectUri !== redirectUri
      || code.resource !== resource
      || sha256Base64Url(body.code_verifier) !== code.codeChallenge
    ) {
      return sendOAuthError(reply, 400, "invalid_grant", "Authorization code verifier or binding is invalid");
    }
    const connection = await app.persistence.getAiConnectorConnection(code.connectionId);
    if (!connection || connection.status !== "pending") {
      return sendOAuthError(reply, 400, "invalid_grant", "Connector authorization is no longer pending");
    }
    const settings = await app.persistence.getAiConnectorPolicySettings();
    let activatedResult: Awaited<ReturnType<typeof app.persistence.activateAiConnectorOAuthConnection>> = null;
    let tokens: Awaited<ReturnType<typeof issueTokens>>;
    try {
      tokens = await issueTokens({ app, req, connectionId: connection.id, userId: code.userId,
        clientId: code.clientId, resource, scopes: connection.scopes, refreshExpiresAt: connection.expiresAt,
        persistCredential: async (refreshCredential) => {
          activatedResult = await app.persistence.activateAiConnectorOAuthConnection({
            connectionId: connection.id, userId: code.userId, provider: connection.provider,
            vendor: connection.vendor, clientKind: connection.clientKind, authMode: connection.authMode,
            maxActiveConnectionsPerUser: settings.maxActiveConnectionsPerUser,
            oauthClientId: code.clientId, oauthSubject: code.userId, lastUsedAt: new Date().toISOString(),
            revokedByUserId: code.userId, revocationReason: "replaced_by_oauth_authorization",
            connectionAction: code.connectionAction ?? undefined,
            replacementConnectionId: code.replacementConnectionId, refreshCredential,
          });
          if (!activatedResult) throw routeError(400, "invalid_grant", "Connector authorization is no longer pending");
        },
      });
    } catch (error) {
      const expectedFailure = error instanceof Error && "statusCode" in error && typeof error.statusCode === "number"
        && error.statusCode >= 400 && error.statusCode < 500 && "code" in error && typeof error.code === "string";
      const reason = expectedFailure ? error.code as string : "server_error";
      req.log.warn({ connectionId: connection.id, requestId: req.id, reason, connectionAction: code.connectionAction }, "mcp_oauth_activation_failed");
      return sendOAuthError(reply, reason === "server_error" ? 503 : 400,
        reason === "server_error" ? "server_error" : "invalid_grant",
        reason === "server_error" ? "Authorization could not be saved; restart authorization" : (error instanceof Error ? error.message : "Authorization failed"), { reason });
    }
    // Successful return from the persistence operation is the commit boundary.
    const committed = activatedResult as Awaited<ReturnType<typeof app.persistence.activateAiConnectorOAuthConnection>>;
    if (!committed) return sendOAuthError(reply, 400, "invalid_grant", "Connector authorization is no longer pending");
    const activated = committed.connection;
    for (const revokedConnectionId of committed.revokedConnectionIds) {
      await app.persistence.appendAuditLog({
        actorUserId: code.userId,
        action: "ai_connector_revoked",
        targetUserId: code.userId,
        ipAddress: req.ip,
        metadata: {
          requestId: req.id,
          authorizationRequestId: code.authorizationRequestId ?? null,
          connectionAction: code.connectionAction,
          replacedByConnectionId: activated.id,
          connectionId: revokedConnectionId,
          provider: connection.provider,
          vendor: connection.vendor,
          clientKind: connection.clientKind,
          authMode: connection.authMode,
          reason: "replaced_by_oauth_authorization",
        },
      });
    }
    await app.persistence.appendAuditLog({
      actorUserId: code.userId,
      action: "ai_connector_connected",
      targetUserId: code.userId,
      ipAddress: req.ip,
      metadata: {
        requestId: req.id,
        authorizationRequestId: code.authorizationRequestId ?? null,
        connectionAction: code.connectionAction,
        replacementConnectionId: code.replacementConnectionId ?? null,
        connectionId: activated.id,
        provider: activated.provider,
        scopes: activated.scopes,
        expiresAt: activated.expiresAt,
        clientKind: activated.clientKind,
      },
    });
    req.log.info({
      mcpOAuth: {
        requestId: req.id,
        authorizationRequestId: code.authorizationRequestId ?? null,
        connectionAction: code.connectionAction,
        replacementConnectionId: code.replacementConnectionId ?? null,
        connectionId: activated.id,
        clientKind: activated.clientKind,
        scopes: activated.scopes,
      },
    }, "mcp_oauth_token_issued");
    return tokens;
  }

  const credential = await app.persistence.getAiConnectorCredentialByHash(
    hashMcpOAuthToken(secret, body.refresh_token),
  );
  if (!credential) return sendOAuthError(reply, 400, "invalid_grant", "Refresh token is invalid");
  const connection = await app.persistence.getAiConnectorConnection(credential.connectionId);
  if (!connection) return sendOAuthError(reply, 400, "invalid_grant", "Connector connection is invalid");
  const resource = body.resource ?? credential.resource;
  if (!resource) return sendOAuthError(reply, 400, "invalid_grant", "Refresh token binding is invalid");
  if (credential.credentialType !== "oauth_refresh_token" || credential.oauthClientId !== body.client_id || credential.resource !== resource) {
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token binding is invalid");
  }
  if (connection.status !== "active") {
    const reason = connection.revocationReason ?? (connection.status === "expired" ? (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now() ? "absolute_expiry" : "inactivity_expiry") : "connection_inactive");
    if (connection.status === "expired") {
      await expireAiConnectorConnection(app, connection, reason === "inactivity_expiry" ? "inactivity_expiry" : "absolute_expiry");
    }
    req.log.info({ connectionId: connection.id, requestId: req.id, reason }, "mcp_oauth_refresh_rejected");
    return sendOAuthError(reply, 400, "invalid_grant", "Connector authorization is revoked or expired; reconnect", { reason });
  }
  if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()) {
    return sendOAuthError(reply, 400, "invalid_grant", "Connector authorization has expired", { reason: "absolute_expiry" });
  }
  if (credential.revokedAt || credential.replacedByCredentialId) {
    if (connection.status === "active") {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "refresh_token_reuse",
        ipAddress: req.ip,
      });
    }
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token has already been used");
  }
  if (
    credential.credentialType !== "oauth_refresh_token"
    || credential.oauthClientId !== body.client_id
    || credential.resource !== resource
    || (credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now())
  ) {
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token binding is invalid");
  }
  if (connection.status !== "active") {
    return sendOAuthError(reply, 400, "invalid_grant", "Connector connection is not active");
  }
  const authUser = await app.persistence.getAuthUserById(connection.userId);
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt || authUser.sessionVersion !== credential.sessionVersion) {
    await revokeAiConnectorConnection(app, connection.id, {
      revokedByUserId: null,
      reason: "session_version_changed",
      ipAddress: req.ip,
    });
    return sendOAuthError(reply, 400, "invalid_grant", "User session state changed; reconnect the MCP connector");
  }
  const nextCredentialId = randomUUID();
  const consumed = await app.persistence.consumeAiConnectorCredential(credential.id);
  if (!consumed) {
    if (connection.status === "active") {
      await revokeAiConnectorConnection(app, connection.id, {
        revokedByUserId: null,
        reason: "refresh_token_reuse",
        ipAddress: req.ip,
      });
    }
    return sendOAuthError(reply, 400, "invalid_grant", "Refresh token has already been used");
  }
  return issueTokens({
    app,
    req,
    connectionId: connection.id,
    userId: connection.userId,
    clientId: body.client_id,
    resource,
    scopes: credential.scopes.filter((scope) => connection.scopes.includes(scope)),
    refreshExpiresAt: connection.expiresAt,
    refreshCredentialId: nextCredentialId,
    predecessorCredentialId: credential.id,
    tokenFamilyId: credential.tokenFamilyId,
  });
}
