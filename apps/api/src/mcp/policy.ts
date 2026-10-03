import type { FastifyInstance, FastifyRequest } from "fastify";
import type {
  AiConnectorAccessKind,
  AiConnectorScope,
  ShareCapability,
} from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import type {
  McpAuthContext,
  McpPolicyService,
  McpResolvedContext,
} from "./types.js";
import { connectorGroupForScope } from "../services/mcpConnectorLifecycle.js";
import { getMcpClientByLegacyProvider } from "./clientRegistry.js";

const READ_LIMIT = { windowMs: 60_000, max: 120 };
const MUTATION_LIMIT = { windowMs: 60_000, max: 60 };
const RATE_BUCKET_PRUNE_INTERVAL_MS = 60_000;

interface RateBucket {
  count: number;
  windowStartedAt: number;
  expiresAt: number;
}

const rateBuckets = new Map<string, RateBucket>();
let nextRateBucketPruneAt = 0;

export function resetMcpRateLimitBucketsForTest(): void {
  rateBuckets.clear();
  nextRateBucketPruneAt = 0;
}

export function getMcpRateLimitBucketCountForTest(): number {
  return rateBuckets.size;
}

export function scopesForToolAccess(
  accessKind: AiConnectorAccessKind,
  toolName: string,
  toolScope: AiConnectorScope,
): AiConnectorScope[] {
  if (accessKind === "read") return ["portfolio:mcp_read"];
  if (toolName === "list_draftable_account_names") {
    return ["transaction_draft:create", "transaction_draft:edit"];
  }
  return [toolScope];
}

function limitsForAccessKind(accessKind: AiConnectorAccessKind) {
  return accessKind === "read" ? READ_LIMIT : MUTATION_LIMIT;
}

function pruneExpiredRateBuckets(now: number): void {
  if (now < nextRateBucketPruneAt) return;
  nextRateBucketPruneAt = now + RATE_BUCKET_PRUNE_INTERVAL_MS;
  for (const [key, bucket] of rateBuckets) {
    if (bucket.expiresAt <= now) {
      rateBuckets.delete(key);
    }
  }
}

function requireAnyScope(auth: McpAuthContext, scopes: readonly AiConnectorScope[]): void {
  if (!scopes.some((scope) => auth.scopes.includes(scope))) {
    throw routeError(403, "mcp_scope_denied", `MCP scope ${scopes.join(" or ")} is not enabled for this connection`);
  }
}

export function assertMcpScopesGranted(auth: McpAuthContext, scopes: readonly AiConnectorScope[]): void {
  requireAnyScope(auth, scopes);
}

function rateLimitKey(
  auth: McpAuthContext,
  accessKind: AiConnectorAccessKind,
  resolvedContext: McpResolvedContext,
  sourceIp: string | undefined,
): string {
  const connectionKey = auth.connection?.id ?? auth.clientId;
  const contextKey = accessKind === "read" ? resolvedContext.portfolioContextUserId : "mutation";
  return `${connectionKey}:${auth.sessionUserId}:${contextKey}:${accessKind}:${sourceIp ?? "unknown"}`;
}

function enforceRateLimit(
  auth: McpAuthContext,
  accessKind: AiConnectorAccessKind,
  resolvedContext: McpResolvedContext,
  sourceIp: string | undefined,
): void {
  const key = rateLimitKey(auth, accessKind, resolvedContext, sourceIp);
  const limits = limitsForAccessKind(accessKind);
  const now = Date.now();
  pruneExpiredRateBuckets(now);
  const existing = rateBuckets.get(key);
  if (!existing || now - existing.windowStartedAt >= limits.windowMs) {
    rateBuckets.set(key, { count: 1, windowStartedAt: now, expiresAt: now + limits.windowMs });
    return;
  }
  existing.count += 1;
  rateBuckets.set(key, existing);
  if (existing.count > limits.max) {
    throw routeError(429, "mcp_rate_limited", "MCP rate limit exceeded");
  }
}

async function resolveSharedContext(
  app: FastifyInstance,
  sessionUserId: string,
  requestedContextUserId: string | undefined,
): Promise<McpResolvedContext> {
  if (!requestedContextUserId || requestedContextUserId === sessionUserId) {
    return {
      sessionUserId,
      portfolioContextUserId: sessionUserId,
      shareId: null,
      shareCapabilities: [],
    };
  }

  const inbound = await app.persistence.listInboundSharesForGrantee(sessionUserId);
  const share = inbound.active.find((candidate) => candidate.ownerUserId === requestedContextUserId) ?? null;
  if (!share) {
    throw routeError(403, "mcp_shared_context_denied", "Shared portfolio MCP access is not available for that context");
  }

  const shareCapabilities = await app.persistence.getShareCapabilities(share.id);
  return {
    sessionUserId,
    portfolioContextUserId: requestedContextUserId,
    shareId: share.id,
    shareCapabilities,
  };
}

function requireShareCapability(
  resolvedContext: McpResolvedContext,
  requiredScopes: readonly AiConnectorScope[],
): void {
  if (!resolvedContext.shareId) return;
  const needed = requiredScopes as readonly ShareCapability[];
  if (!needed.some((scope) => resolvedContext.shareCapabilities.includes(scope))) {
    throw routeError(
      403,
      "shared_capability_required",
      `Shared portfolio capability ${needed.join(" or ")} is not enabled`,
      {
        requiredCapabilities: needed,
      },
    );
  }
}

export function assertMcpShareCapabilities(
  resolvedContext: McpResolvedContext,
  requiredScopes: readonly AiConnectorScope[],
): void {
  requireShareCapability(resolvedContext, requiredScopes);
}

export class DefaultMcpPolicyService implements McpPolicyService {
  constructor(
    private readonly toolScopes: Record<string, AiConnectorScope>,
  ) {}

  async assertToolAccess(
    app: FastifyInstance,
    req: FastifyRequest,
    auth: McpAuthContext,
    toolName: string,
    accessKind: AiConnectorAccessKind,
    requestedContextUserId?: string,
  ): Promise<McpResolvedContext> {
    const toolScope = this.toolScopes[toolName];
    if (!toolScope) {
      throw routeError(404, "mcp_tool_not_found", `Unknown MCP tool ${toolName}`);
    }
    if (auth.toolToggles[toolName] === false) {
      throw routeError(403, "mcp_tool_disabled", `MCP tool ${toolName} is disabled for this connection`);
    }
    const settings = await app.persistence.getAiConnectorPolicySettings();
    if (!settings.enabled) {
      throw routeError(403, "mcp_deployment_disabled", "AI connector deployment is disabled");
    }
    if (auth.connection) {
      const clientKind = auth.connection.clientKind ?? getMcpClientByLegacyProvider(auth.connection.provider).clientKind;
      const allowed = settings.allowedClientKinds?.[clientKind] ?? settings.allowedProviders[auth.connection.provider];
      if (!allowed) {
        throw routeError(403, "mcp_client_kind_disabled", `AI connector client kind ${clientKind} is disabled`);
      }
    }
    if (toolName === "get_profile") {
      const context = await resolveSharedContext(app, auth.sessionUserId, undefined);
      enforceRateLimit(auth, accessKind, context, req.ip);
      return context;
    }
    const group = connectorGroupForScope(toolScope);
    if (auth.authMode === "bearer" && !settings.bearerFallback.allowedToolGroups.includes(group)) {
      throw routeError(403, "mcp_bearer_tool_group_disabled", `MCP bearer fallback is disabled for ${group} tools`);
    }
    if (!settings.groupToggles[group]) {
      throw routeError(403, "mcp_tool_group_disabled", `MCP tool group ${group} is disabled`);
    }
    const requiredScopes = scopesForToolAccess(accessKind, toolName, toolScope);
    requireAnyScope(auth, requiredScopes);
    const resolvedContext = await resolveSharedContext(app, auth.sessionUserId, requestedContextUserId);
    requireShareCapability(resolvedContext, requiredScopes);
    enforceRateLimit(auth, accessKind, resolvedContext, req.ip);
    return resolvedContext;
  }
}
