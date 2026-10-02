-- Compatibility rollout: stop old OAuth authorization writers before enabling this schema.
-- Existing grants, credentials, labels, expiry and revocation state are preserved.
DROP INDEX IF EXISTS ux_ai_connector_connections_user_client_kind_auth_active;
CREATE UNIQUE INDEX IF NOT EXISTS ux_ai_connector_connections_user_client_kind_auth_active
  ON ai_connector_connections (user_id, vendor, client_kind, auth_mode)
  WHERE status = 'active'
    AND NOT (auth_mode = 'oauth' AND client_kind IN ('chatgpt_app', 'claude_ai_connector'));

ALTER TABLE ai_connector_connections
  ADD COLUMN IF NOT EXISTS replaced_by_connection_id TEXT REFERENCES ai_connector_connections(id);
ALTER TABLE mcp_oauth_authorization_requests
  ADD COLUMN IF NOT EXISTS connection_action TEXT CHECK (connection_action IN ('create', 'replace')),
  ADD COLUMN IF NOT EXISTS replacement_connection_id TEXT REFERENCES ai_connector_connections(id);
ALTER TABLE mcp_oauth_authorization_codes
  ADD COLUMN IF NOT EXISTS authorization_request_id TEXT REFERENCES mcp_oauth_authorization_requests(id),
  ADD COLUMN IF NOT EXISTS connection_action TEXT CHECK (connection_action IN ('create', 'replace')),
  ADD COLUMN IF NOT EXISTS replacement_connection_id TEXT REFERENCES ai_connector_connections(id);
-- NULL action identifies legacy in-flight approvals: application rejects them and requires fresh consent.
-- Rollback is forward repair/compatible application only. Never recreate old index while independent grants exist.

-- Existing historical expirations already completed the old lifecycle; do not notify them again.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
    AND table_name = 'ai_connector_connections' AND column_name = 'expiry_processed_at') THEN
    ALTER TABLE ai_connector_connections ADD COLUMN expiry_processed_at TIMESTAMPTZ;
    UPDATE ai_connector_connections SET expiry_processed_at = updated_at WHERE status = 'expired';
  END IF;
END $$;
