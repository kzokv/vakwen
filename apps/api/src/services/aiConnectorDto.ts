import type { AiConnectorConnectionDto } from "@vakwen/shared-types";
import type { AiConnectorConnectionRecord } from "../persistence/types.js";

export function toAiConnectorConnectionDto(record: AiConnectorConnectionRecord): AiConnectorConnectionDto {
  return {
    id: record.id,
    provider: record.provider,
    vendor: record.vendor,
    clientKind: record.clientKind,
    authMode: record.authMode,
    capabilities: record.capabilities,
    displayName: record.displayName,
    status: record.status,
    hiddenAt: record.hiddenAt ?? null,
    scopes: record.scopes,
    toolToggles: record.toolToggles,
    expiresAt: record.expiresAt,
    expiryNotifiedAt: record.expiryNotifiedAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    revocationReason: record.revocationReason,
    replacedByConnectionId: record.replacedByConnectionId ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
