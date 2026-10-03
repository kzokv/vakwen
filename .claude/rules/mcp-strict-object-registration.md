---
paths:
  - "apps/api/src/mcp/tools.ts"
  - "apps/api/src/mcp/registerMcpRoutes.ts"
  - "apps/api/test/integration/mcp*.test.ts"
---

# Preserve strict MCP object schemas at registration

When a tool contract must reject unknown arguments, pass the complete strict Zod object to MCP SDK registration. Passing only `schema.shape` retains field validators but discards object-level unknown-key behavior; the SDK may strip unexpected selectors before a handler's later check sees them.

Validate through the real `tools/call` route with an unexpected field and assert rejection. A passing direct `schema.safeParse` test alone does not verify what the SDK delivers to the handler. If an adapter requires a raw shape, enforce the full schema on original input before that adapter can strip fields.

Scope this rule to contracts that intentionally reject unknown fields. Do not change legacy tools' accepted inputs solely to make them strict.

Evidence: `mcp-profile.integration.test.ts`, “profile selector injection: foreign user arguments → rejected.” Its failing regression exposed strictness lost through `.shape`; the profile registration now retains the full object. Recheck this behavior when upgrading the MCP SDK.
