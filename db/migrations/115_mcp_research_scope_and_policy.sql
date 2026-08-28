-- Additive research MCP authorization support for KZO-245.
--
-- Rollback notes:
-- - Forward-only migration. The new `research_tools_enabled` column defaults
--   FALSE so existing rows stay non-research unless explicitly enabled later.
-- - To roll back application behavior, stop reading the new scope/group and
--   keep the column/constraints in place until all app versions are updated.

ALTER TABLE ai_connector_policy_settings
  ADD COLUMN IF NOT EXISTS research_tools_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE ai_connector_policy_settings
  DROP CONSTRAINT IF EXISTS ai_connector_policy_settings_bearer_allowed_tool_groups_check,
  ADD CONSTRAINT ai_connector_policy_settings_bearer_allowed_tool_groups_check CHECK (
    bearer_allowed_tool_groups <@ ARRAY['read', 'research', 'drafts', 'write']::text[]
  );

ALTER TABLE ai_connector_connection_scopes
  DROP CONSTRAINT IF EXISTS ai_connector_connection_scopes_scope_check;

ALTER TABLE ai_connector_connection_scopes
  ADD CONSTRAINT ai_connector_connection_scopes_scope_check CHECK (
    scope IN (
      'portfolio:mcp_read', 'research:read', 'account:manage',
      'transaction_draft:create', 'transaction_draft:edit',
      'transaction_draft:archive', 'transaction_draft:delete',
      'transaction:write', 'dividend:write'
    )
  );
