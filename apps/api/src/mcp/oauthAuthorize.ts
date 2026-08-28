import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  AiConnectorClientKind,
  AiConnectorPolicySettingsDto,
  AiConnectorScope,
  McpOAuthConsentDecisionDto,
  McpOAuthConsentRequestDto,
  McpOAuthRedirectUriRepairDto,
} from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import { connectorGroupForScope } from "../services/mcpConnectorLifecycle.js";
import { getMcpClientByKind } from "./clientRegistry.js";
import { ALL_MCP_SCOPES, researchScopeAcquisitionAllowed } from "./tools.js";
import { inspectOAuthClient, type InspectedOAuthClient } from "./oauthClientAuth.js";
import {
  constantTimeEqual,
  getMcpOAuthTokenSecret,
  hashMcpOAuthToken,
  hmac,
  randomToken,
  sha256Base64Url,
} from "./oauthCrypto.js";
import { sendOAuthError, setMcpOAuthNoStoreHeaders } from "./oauthHttp.js";
import {
  getAuthorizationResponseIssuer,
  getInitialMcpScopes,
  getMcpOAuthIssuer,
  getMcpResourceUrl,
} from "./oauthMetadata.js";
import {
  oauthRedirect,
  oauthRedirectViaIssuer,
  openOAuthRedirectBridgePayload,
} from "./oauthRedirectBridge.js";

const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 90;
const CONSENT_CSRF_VERSION = 1;

const CHATGPT_REDIRECT_HOSTS = new Set(["chat.openai.com", "chatgpt.com"]);
const CLAUDE_AI_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CLAUDE_AI_METADATA_URL = "https://claude.ai/oauth/mcp-oauth-client-metadata";

const scopeSchema = z.enum(ALL_MCP_SCOPES as [typeof ALL_MCP_SCOPES[0], ...typeof ALL_MCP_SCOPES]);

const authorizeQuerySchema = z.object({
  response_type: z.literal("code"),
  client_id: z.string().trim().min(1).max(2048),
  redirect_uri: z.string().url(),
  state: z.string().max(4096).optional(),
  resource: z.string().url(),
  scope: z.string().max(2000).optional(),
  code_challenge: z.string().trim().min(43).max(256),
  code_challenge_method: z.literal("S256"),
}).passthrough();

const approveBodySchema = z.object({
  csrfToken: z.string().min(1),
  scopes: z.array(scopeSchema).min(1),
  lifetimeDays: z.number().int().min(1).optional(),
}).strict();

const denyBodySchema = z.object({
  csrfToken: z.string().min(1),
}).strict();

const redirectBridgeQuerySchema = z.object({
  payload: z.string().trim().min(1).max(8192),
}).strict();

function parseUrlClientId(clientId: string): URL | null {
  try {
    return new URL(clientId);
  } catch {
    return null;
  }
}

function csrfTokenFor(app: FastifyInstance, requestId: string, userId: string): string {
  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required for MCP OAuth consent CSRF");
  }
  const payload = `${CONSENT_CSRF_VERSION}:${requestId}:${userId}`;
  return `${CONSENT_CSRF_VERSION}.${hmac(sessionSecret, payload)}`;
}

function csrfHash(token: string): string {
  return sha256Base64Url(`mcp-oauth-csrf:${token}`);
}

function assertCsrf(app: FastifyInstance, requestId: string, userId: string, expectedHash: string, received: string): void {
  const expectedToken = csrfTokenFor(app, requestId, userId);
  if (!constantTimeEqual(expectedToken, received) || !constantTimeEqual(csrfHash(received), expectedHash)) {
    throw routeError(403, "mcp_oauth_csrf_invalid", "OAuth consent CSRF token is invalid");
  }
}

function parseScopes(scope: string | undefined): AiConnectorScope[] {
  if (!scope) return getInitialMcpScopes();
  const parsed = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(parsed.map((item) => scopeSchema.parse(item)))];
}

function normalizeExactRedirectUri(uri: string): string | null {
  const url = new URL(uri);
  if (url.username || url.password || url.search || url.hash || url.pathname === "/" || url.pathname === "") {
    return null;
  }
  return url.toString();
}

type RedirectUriAllowance = "builtin_chatgpt" | "local" | "custom" | "none";

function classifyRedirectUriAllowance(uri: string, customAllowlist: readonly string[] = []): RedirectUriAllowance {
  const url = new URL(uri);
  if (
    url.protocol === "https:"
    && CHATGPT_REDIRECT_HOSTS.has(url.hostname)
    && url.search === ""
    && url.hash === ""
    && (
      url.pathname === "/aip/oauth/callback"
      || /^\/aip\/[^/]+\/oauth\/callback$/.test(url.pathname)
      || /^\/connector\/oauth\/[^/]+$/.test(url.pathname)
    )
  ) {
    return "builtin_chatgpt";
  }
  if (Env.NODE_ENV === "test" || Env.NODE_ENV === "development") {
    if (
      (url.protocol === "http:" || url.protocol === "https:")
      && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      return "local";
    }
  }
  const normalized = normalizeExactRedirectUri(uri);
  if (normalized && customAllowlist.includes(normalized)) return "custom";
  return "none";
}

function redirectUriRepairDetails(input: {
  clientId: string;
  clientKind: AiConnectorClientKind;
  clientLabel: string;
  vendor: McpOAuthRedirectUriRepairDto["vendor"];
  redirectUri: string;
  allowedRedirectUris: readonly string[];
}): McpOAuthRedirectUriRepairDto {
  return {
    clientId: input.clientId,
    clientKind: input.clientKind,
    clientLabel: input.clientLabel,
    vendor: input.vendor,
    requestedRedirectUri: input.redirectUri,
    allowedRedirectUris: [...input.allowedRedirectUris],
    suggestedRedirectUris: input.clientKind === "claude_ai_connector" ? [CLAUDE_AI_CALLBACK] : [],
  };
}

function filterScopesByPolicy(
  scopes: AiConnectorScope[],
  settings: Pick<AiConnectorPolicySettingsDto, "groupToggles">,
): AiConnectorScope[] {
  return scopes
    .filter((scope) => scope !== "research:read" || researchScopeAcquisitionAllowed())
    .filter((scope) => settings.groupToggles[connectorGroupForScope(scope)]);
}

export async function handleMcpOAuthAuthorize(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | void> {
  setMcpOAuthNoStoreHeaders(reply);
  const rawQuery = req.query as Record<string, string | undefined>;
  const returnTo = `/connectors/chatgpt/authorize?${new URLSearchParams(
    Object.entries(rawQuery).flatMap(([key, value]) => value === undefined ? [] : [[key, value]]),
  ).toString()}`;

  try {
    const { hydrateAuthContext } = await import("../routes/registerRoutes.js");
    await hydrateAuthContext(app, req);
  } catch {
    return reply.redirect(`${app.appBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
  }
  if (!req.authContext) {
    return reply.redirect(`${app.appBaseUrl}/login?returnTo=${encodeURIComponent(returnTo)}`, 302);
  }

  let query: z.infer<typeof authorizeQuerySchema>;
  try {
    query = authorizeQuerySchema.parse(rawQuery);
  } catch {
    return sendOAuthError(reply, 400, "invalid_request", "OAuth authorization request is invalid");
  }

  const defaultIdentity = getMcpClientByKind(query.client_id === CLAUDE_AI_METADATA_URL ? "claude_ai_connector" : "chatgpt_app");
  let oauthClient: InspectedOAuthClient = {
    identity: {
      clientKind: defaultIdentity.clientKind,
      label: defaultIdentity.label,
      vendor: defaultIdentity.vendor,
    },
    metadata: null,
  };

  const settings = await app.persistence.getAiConnectorPolicySettings();
  const redirectUriAllowance = classifyRedirectUriAllowance(query.redirect_uri, settings.oauthRedirectUriAllowlist);
  if (redirectUriAllowance === "none") {
    return sendOAuthError(reply, 400, "invalid_request", "OAuth redirect_uri is not allowed", {
      redirectUriRepair: redirectUriRepairDetails({
        clientId: query.client_id,
        clientKind: oauthClient.identity.clientKind,
        clientLabel: oauthClient.identity.label,
        vendor: oauthClient.identity.vendor,
        redirectUri: query.redirect_uri,
        allowedRedirectUris: settings.oauthRedirectUriAllowlist,
      }),
    });
  }
  if (redirectUriAllowance === "custom" && !parseUrlClientId(query.client_id)) {
    return sendOAuthError(reply, 400, "invalid_client", "Custom OAuth redirect URIs require URL client metadata");
  }
  try {
    oauthClient = await inspectOAuthClient(query.client_id, query.redirect_uri);
  } catch (error) {
    const code = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "invalid_client";
    return sendOAuthError(reply, 400, code, error instanceof Error ? error.message : "OAuth client metadata is invalid");
  }
  const resource = await getMcpResourceUrl(app, req);
  if (query.resource !== resource) {
    return sendOAuthError(reply, 400, "invalid_target", "OAuth resource must match the MCP resource URL");
  }

  let scopes: AiConnectorScope[];
  try {
    scopes = query.scope ? parseScopes(query.scope) : getInitialMcpScopes(settings);
  } catch {
    return sendOAuthError(reply, 400, "invalid_scope", "OAuth scope contains an unsupported MCP scope");
  }
  if (scopes.length === 0) {
    return sendOAuthError(reply, 400, "invalid_scope", "OAuth scope must include at least one implemented MCP scope");
  }

  if (!settings.enabled || !settings.allowedClientKinds[oauthClient.identity.clientKind]) {
    return sendOAuthError(reply, 403, "access_denied", `${oauthClient.identity.label} MCP connectors are disabled`);
  }
  const policyScopes = filterScopesByPolicy(scopes, settings);
  if (policyScopes.length === 0) {
    return sendOAuthError(reply, 403, "access_denied", "All requested MCP scope groups are disabled");
  }

  const requestId = randomUUID();
  const csrfToken = csrfTokenFor(app, requestId, req.authContext.sessionUserId);
  await app.persistence.saveMcpOAuthAuthorizationRequest({
    id: requestId,
    userId: req.authContext.sessionUserId,
    clientId: query.client_id,
    redirectUri: query.redirect_uri,
    state: query.state ?? null,
    resource,
    scopes: policyScopes,
    codeChallenge: query.code_challenge,
    codeChallengeMethod: query.code_challenge_method,
    csrfTokenHash: csrfHash(csrfToken),
    expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
  });
  req.log.info({
    mcpOAuth: {
      requestId,
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      resource,
      scopes: policyScopes,
    },
  }, "mcp_oauth_authorize_started");

  return reply.redirect(`${app.appBaseUrl}/connectors/chatgpt/authorize?requestId=${encodeURIComponent(requestId)}`, 302);
}

export async function getMcpOAuthConsentRequest(
  app: FastifyInstance,
  req: FastifyRequest,
  requestId: string,
): Promise<McpOAuthConsentRequestDto> {
  if (!req.authContext) throw routeError(401, "auth_required", "authentication required");
  const request = await app.persistence.getMcpOAuthAuthorizationRequest(requestId);
  if (!request || request.userId !== req.authContext.sessionUserId) {
    throw routeError(404, "mcp_oauth_request_not_found", "OAuth consent request not found");
  }
  if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  const settings = await app.persistence.getAiConnectorPolicySettings();
  const oauthClient = await inspectOAuthClient(request.clientId, request.redirectUri);
  return {
    requestId: request.id,
    clientId: request.clientId,
    clientKind: oauthClient.identity.clientKind,
    clientLabel: oauthClient.identity.label,
    vendor: oauthClient.identity.vendor,
    redirectUri: request.redirectUri,
    resource: request.resource,
    scopes: [...request.scopes],
    csrfToken: csrfTokenFor(app, request.id, request.userId),
    expiresAt: request.expiresAt,
    redirectUriRepair: redirectUriRepairDetails({
      clientId: request.clientId,
      clientKind: oauthClient.identity.clientKind,
      clientLabel: oauthClient.identity.label,
      vendor: oauthClient.identity.vendor,
      redirectUri: request.redirectUri,
      allowedRedirectUris: settings.oauthRedirectUriAllowlist,
    }),
    policy: {
      maxConnectorLifetimeDays: settings.maxConnectorLifetimeDays,
      postedTransactionMutationBatchLimit: settings.postedTransactionMutationBatchLimit,
      groupToggles: { ...settings.groupToggles },
    } as McpOAuthConsentRequestDto["policy"],
  };
}

export async function approveMcpOAuthConsent(
  app: FastifyInstance,
  req: FastifyRequest,
  requestId: string,
  body: unknown,
): Promise<McpOAuthConsentDecisionDto> {
  if (!req.authContext) throw routeError(401, "auth_required", "authentication required");
  const parsed = approveBodySchema.parse(body);
  const request = await app.persistence.getMcpOAuthAuthorizationRequest(requestId);
  if (!request || request.userId !== req.authContext.sessionUserId) {
    throw routeError(404, "mcp_oauth_request_not_found", "OAuth consent request not found");
  }
  if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  assertCsrf(app, request.id, request.userId, request.csrfTokenHash, parsed.csrfToken);

  const settings = await app.persistence.getAiConnectorPolicySettings();
  const oauthClient = await inspectOAuthClient(request.clientId, request.redirectUri);
  const client = getMcpClientByKind(oauthClient.identity.clientKind);
  const requestedScopeSet = new Set(request.scopes);
  const selectedScopes = parsed.scopes.filter((scope) => requestedScopeSet.has(scope));
  const allowedScopes = filterScopesByPolicy(selectedScopes, settings);
  if (allowedScopes.length === 0) {
    throw routeError(403, "mcp_all_requested_scopes_disabled", "All selected MCP scope groups are disabled");
  }

  const secret = await getMcpOAuthTokenSecret(app);

  const lifetimeDays = Math.min(
    parsed.lifetimeDays ?? Math.min(DEFAULT_REFRESH_TOKEN_TTL_DAYS, settings.maxConnectorLifetimeDays),
    settings.maxConnectorLifetimeDays,
  );
  const expiresAt = new Date(Date.now() + lifetimeDays * 24 * 60 * 60 * 1000).toISOString();
  const connectionId = randomUUID();
  const code = randomToken(32);
  const approval = await app.persistence.approveMcpOAuthAuthorizationRequest({
    requestId: request.id,
    userId: request.userId,
    approvedAt: new Date().toISOString(),
    connection: {
      id: connectionId,
      userId: request.userId,
      provider: client.legacyProvider,
      vendor: client.vendor,
      clientKind: client.clientKind,
      authMode: client.defaultAuthMode,
      capabilities: [...client.capabilities],
      displayName: client.defaultDisplayName,
      status: "pending",
      oauthClientId: request.clientId,
      oauthSubject: request.userId,
      scopes: allowedScopes,
      expiresAt,
    },
    code: {
      id: randomUUID(),
      codeHash: hashMcpOAuthToken(secret, code),
      connectionId,
      userId: request.userId,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      resource: request.resource,
      scopes: allowedScopes,
      codeChallenge: request.codeChallenge,
      codeChallengeMethod: request.codeChallengeMethod,
      expiresAt: request.expiresAt,
    },
  });
  if (!approval) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }

  const issuer = await getMcpOAuthIssuer(app, req);
  const finalRedirectUrl = oauthRedirect(request.redirectUri, {
    code,
    state: request.state,
    iss: getAuthorizationResponseIssuer(issuer),
  });
  req.log.info({
    mcpOAuth: {
      requestId: request.id,
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      resource: request.resource,
      scopes: allowedScopes,
      issuer,
      authorizationResponseIssuer: getAuthorizationResponseIssuer(issuer) ?? null,
    },
  }, "mcp_oauth_approval_redirect_issued");
  return {
    redirectUrl: oauthRedirectViaIssuer({ issuer, secret, finalRedirectUrl }),
  };
}

export async function denyMcpOAuthConsent(
  app: FastifyInstance,
  req: FastifyRequest,
  requestId: string,
  body: unknown,
): Promise<McpOAuthConsentDecisionDto> {
  if (!req.authContext) throw routeError(401, "auth_required", "authentication required");
  const parsed = denyBodySchema.parse(body);
  const request = await app.persistence.getMcpOAuthAuthorizationRequest(requestId);
  if (!request || request.userId !== req.authContext.sessionUserId) {
    throw routeError(404, "mcp_oauth_request_not_found", "OAuth consent request not found");
  }
  if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  assertCsrf(app, request.id, request.userId, request.csrfTokenHash, parsed.csrfToken);
  const denied = await app.persistence.settleMcpOAuthAuthorizationRequest(
    request.id,
    request.userId,
    "denied",
    new Date().toISOString(),
  );
  if (!denied) {
    throw routeError(410, "mcp_oauth_request_expired", "OAuth consent request is no longer pending");
  }
  const issuer = await getMcpOAuthIssuer(app, req);
  const secret = await getMcpOAuthTokenSecret(app);
  const finalRedirectUrl = oauthRedirect(request.redirectUri, {
    error: "access_denied",
    error_description: "The user denied the Vakwen MCP connector request.",
    state: request.state,
    iss: getAuthorizationResponseIssuer(issuer),
  });
  return {
    redirectUrl: oauthRedirectViaIssuer({ issuer, secret, finalRedirectUrl }),
  };
}

export async function handleMcpOAuthRedirect(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
) {
  setMcpOAuthNoStoreHeaders(reply);
  const query = redirectBridgeQuerySchema.parse(req.query);
  const secret = await getMcpOAuthTokenSecret(app);
  const redirectUrl = openOAuthRedirectBridgePayload(secret, query.payload);
  return reply.redirect(redirectUrl, 302);
}
