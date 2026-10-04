import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AiConnectorConnectionRecord } from "../persistence/types.js";
import { listMcpToolDefinitions } from "./tools.js";

// Attribution is request-local and populated only after signature/hash verification
// and persisted ownership/client/resource checks. Never decode claims here.
const trustedConnections = new WeakMap<FastifyRequest, Pick<AiConnectorConnectionRecord, "id" | "userId" | "displayName">>();
export function rememberVerifiedConnection(req: FastifyRequest, connection: AiConnectorConnectionRecord): void {
  trustedConnections.set(req, { id: connection.id, userId: connection.userId, displayName: connection.displayName });
}

export async function recordMcpAuthenticationFailure(app: FastifyInstance, req: FastifyRequest, error: unknown, requestId: string) {
  const connection = trustedConnections.get(req);
  const rawCode = error instanceof Error && "code" in error ? error.code : undefined;
  const reason = typeof rawCode === "string" && /^mcp_[a-z_]+$/.test(rawCode) ? rawCode : "mcp_auth_invalid";
  if (!connection) {
    app.log.warn({ requestId, reason }, "mcp_authentication_failed_unattributed");
    return;
  }
  const body = req.body as { method?: unknown; params?: { name?: unknown } } | undefined;
  const tool = listMcpToolDefinitions().find((candidate) => candidate.name === body?.params?.name);
  try {
    await app.persistence.appendAiConnectorAccessLog({
      connectionId: connection.id,
      userId: connection.userId,
      portfolioContextUserId: connection.userId,
      shareId: null,
      toolName: tool?.name ?? "mcp_authentication",
      accessKind: tool?.accessKind ?? "read",
      result: "denied",
      denialReason: reason,
      requestId,
      sourceIp: req.ip ?? null,
      userAgent: null,
      metadata: { source: "mcp_authentication", connectionLabel: connection.displayName },
    });
  } catch {
    // A diagnostics outage must not turn an auth rejection into a success or
    // suppress the protocol challenge. Keep only safe correlation in server logs.
    app.log.error({ requestId, connectionId: connection.id, reason }, "mcp_authentication_audit_failed");
  }
}
