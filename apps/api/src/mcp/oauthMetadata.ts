import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AiConnectorScope } from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { routeError } from "../lib/routeError.js";
import type { AiConnectorPolicySettingsRecord } from "../persistence/types.js";
import {
  ALL_MCP_SCOPES,
  listMcpToolDefinitions,
  researchScopeAcquisitionAllowed,
  scopesForListedTool,
} from "./tools.js";
import type { McpProtectedResourceMetadata } from "./types.js";

function implementedScopesFor(settings?: Pick<AiConnectorPolicySettingsRecord, "groupToggles">): Set<AiConnectorScope> {
  const implementedScopes = new Set<AiConnectorScope>();
  for (const tool of listMcpToolDefinitions({ legacyReadGroupEnabled: settings?.groupToggles.read ?? true })) {
    for (const scope of scopesForListedTool(tool)) {
      if (scope === "research:read" && !researchScopeAcquisitionAllowed()) continue;
      implementedScopes.add(scope);
    }
  }
  return implementedScopes;
}

export function getSupportedMcpScopes(settings?: Pick<AiConnectorPolicySettingsRecord, "groupToggles">): AiConnectorScope[] {
  const implementedScopes = implementedScopesFor(settings);
  return ALL_MCP_SCOPES.filter((scope) => implementedScopes.has(scope));
}

export function getInitialMcpScopes(settings?: Pick<AiConnectorPolicySettingsRecord, "groupToggles">): AiConnectorScope[] {
  const supportedScopes = new Set(getSupportedMcpScopes(settings));
  if (settings?.groupToggles.read !== false && supportedScopes.has("portfolio:mcp_read")) {
    return ["portfolio:mcp_read"];
  }
  if (settings?.groupToggles.research === true && supportedScopes.has("research:read")) {
    return ["research:read"];
  }
  return [];
}

export function withInitialMcpScopes(
  scopes: AiConnectorScope[],
  settings?: Pick<AiConnectorPolicySettingsRecord, "groupToggles">,
): AiConnectorScope[] {
  const requested = new Set([...getInitialMcpScopes(settings), ...scopes]);
  return getSupportedMcpScopes(settings).filter((scope) => requested.has(scope));
}

export function buildRequestOrigin(req: FastifyRequest): string {
  const protocol = Array.isArray(req.headers["x-forwarded-proto"])
    ? req.headers["x-forwarded-proto"][0]
    : req.headers["x-forwarded-proto"];
  const host = Array.isArray(req.headers["x-forwarded-host"])
    ? req.headers["x-forwarded-host"][0]
    : req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:4000";
  return `${protocol ?? "http"}://${host}`;
}

function normalizeIssuer(value: string): string {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function localRuntime(): boolean {
  return Env.NODE_ENV === "test" || Env.NODE_ENV === "development";
}

function assertIssuerAllowed(issuer: string): string {
  const url = new URL(issuer);
  if (url.protocol === "https:") return issuer;
  if (localRuntime() && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) return issuer;
  throw routeError(503, "mcp_oauth_issuer_unconfigured", "MCP OAuth public issuer must be configured with HTTPS");
}

export async function getMcpOAuthIssuer(app: FastifyInstance, req: FastifyRequest): Promise<string> {
  const settings = await app.persistence.getAiConnectorPolicySettings();
  if (settings.oauthPublicIssuer) {
    return assertIssuerAllowed(normalizeIssuer(settings.oauthPublicIssuer));
  }
  if (!localRuntime()) {
    throw routeError(503, "mcp_oauth_issuer_unconfigured", "MCP OAuth public issuer must be configured");
  }
  return assertIssuerAllowed(normalizeIssuer(buildRequestOrigin(req)));
}

export async function getMcpResourceUrl(app: FastifyInstance, req: FastifyRequest): Promise<string> {
  return `${await getMcpOAuthIssuer(app, req)}/mcp`;
}

export async function getMcpProtectedResourceMetadata(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<McpProtectedResourceMetadata> {
  const issuer = await getMcpOAuthIssuer(app, req);
  const settings = await app.persistence.getAiConnectorPolicySettings();
  return {
    resource: `${issuer}/mcp`,
    authorization_servers: [issuer],
    scopes_supported: getSupportedMcpScopes(settings),
    bearer_methods_supported: ["header"],
    resource_documentation: `${issuer}/mcp/health`,
  };
}

export async function getMcpProtectedResourceMetadataUrl(app: FastifyInstance, req: FastifyRequest): Promise<string> {
  const issuer = await getMcpOAuthIssuer(app, req);
  return `${issuer}/.well-known/oauth-protected-resource/mcp`;
}

export function getAuthorizationResponseIssuer(issuer: string): string | undefined {
  const url = new URL(issuer);
  return url.protocol === "https:" && url.search === "" && url.hash === "" ? issuer : undefined;
}

export async function getMcpAuthorizationServerMetadata(app: FastifyInstance, req: FastifyRequest) {
  const issuer = await getMcpOAuthIssuer(app, req);
  const authorizationResponseIssuer = getAuthorizationResponseIssuer(issuer);
  const settings = await app.persistence.getAiConnectorPolicySettings();
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256"],
    client_id_metadata_document_supported: true,
    ...(authorizationResponseIssuer
      ? { authorization_response_iss_parameter_supported: true }
      : {}),
    scopes_supported: getSupportedMcpScopes(settings),
    resource_documentation: `${issuer}/mcp/health`,
  };
}

function quoteWwwAuthenticateValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function buildMcpWwwAuthenticateHeader(
  metadataUrl: string,
  options: {
    scope?: AiConnectorScope | AiConnectorScope[];
    error?: string;
    errorDescription?: string;
  } = {},
): string {
  const scope = Array.isArray(options.scope) ? options.scope.join(" ") : options.scope;
  const params = [
    ["realm", "vakwen-mcp"],
    ["resource_metadata", metadataUrl],
    ...(scope ? [["scope", scope] as const] : []),
    ...(options.error ? [["error", options.error] as const] : []),
    ...(options.errorDescription ? [["error_description", options.errorDescription] as const] : []),
  ];
  return `Bearer ${params.map(([key, value]) => `${key}=${quoteWwwAuthenticateValue(value)}`).join(", ")}`;
}
