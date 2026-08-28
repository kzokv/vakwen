# MCP Tool And Scope Extension Checklist

When adding a new MCP tool family or a new AI connector scope, update the full connector surface in one PR. A tool that works in the local service layer but is missing OAuth metadata, connector consent UI, lifecycle policy mapping, or ChatGPT Apps widget metadata is incomplete.

## Required touch-points

1. **Shared scope/type surface:** update `libs/shared-types/src/index.ts` for the scope union and all request/response/widget DTOs used by API and web.
2. **OAuth and MCP metadata:** update `apps/api/src/mcp/tools.ts`, OAuth scope exposure, and `apps/api/src/mcp/registerMcpRoutes.ts` dispatch for every new tool.
3. **Lifecycle policy mapping:** update `apps/api/src/services/mcpConnectorLifecycle.ts` so the new scope lands in the intended policy group and insufficient-scope checks behave like the rest of the connector.
4. **Service authorization:** enforce scope and share-context capabilities in the MCP service, not only in route dispatch.
5. **Connector consent UI:** update scope labels, settings groupings, reconnect-required detection, and ChatGPT authorization defaults in `apps/web/components/connectors/**` and `apps/web/components/settings/**`.
6. **ChatGPT Apps resources:** when the tool has an interactive component, add the route, bridge parser, harness/mock payload, and `get_*_component` tool metadata together.
7. **Tests:** add API auth/scope coverage, tool behavior coverage, web component/consent tests, and E2E coverage for widget or connector flows.

## Additive scopes with rollout gates

When an existing tool gains an alternative scope, treat authorization as one contract across every public seam. The same rollout matrix must govern:

- OAuth authorization-server and protected-resource `scopes_supported`
- omitted-scope defaults in `/oauth/authorize`
- MCP tool discovery/security metadata and `WWW-Authenticate` challenges
- consent filtering and persisted connector grants
- connector PATCH/reconnect/recreate behavior

OAuth metadata must not advertise a scope that the current acquisition gates will reject. Omitted-scope authorization must choose an enabled, acquirable path; it must not force a legacy scope when only the additive group is enabled. Rollback gates may block use and new acquisition, but unrelated connector edits must preserve already-stored grants. Scope expansion still requires the established reconnect/recreate flow.

For every independently switchable gate, test at least the all-off, all-required-on, and each partial-on state. Also test legacy-only, additive-only, combined-scope, missing-scope, and stored-grant-after-rollback connectors. This matrix catches discovery/authorization mismatches that happy-path scope tests miss.

## Current validated example

The `account:manage` account tools feature touched all seven areas: shared DTOs, OAuth scope metadata, lifecycle write-group mapping, account MCP services, connector consent/settings labels, account-manager + transaction-draft ChatGPT components, and API/web/E2E tests. KZO-245 added the rollout-matrix requirement after review found that partial research-gate states could advertise an unacquirable scope, default to a disabled legacy scope, or drop a stored additive grant during an unrelated edit.

**How to apply:** During scope-grill or team architect briefing, name the seven touch-points explicitly. During pre-PR review, grep the new scope/tool name across all seven areas; any missing area is at least a HIGH finding unless the scope is intentionally read-only and documented as such.
