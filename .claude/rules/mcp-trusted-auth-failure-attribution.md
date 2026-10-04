---
paths:
  - "apps/api/src/mcp/**"
  - "apps/api/test/integration/mcp-auth*.test.ts"
---

# Bind failed authentication diagnostics to verified credentials

Before writing an authentication failure into a user's connection history, verify the credential's signature or persisted token hash, then validate its applicable issuer, resource/audience, client and persisted owner/connection bindings. Keep that trusted attribution request-local. Never infer a history owner from merely decoded token claims or a caller-supplied connection ID.

An expired credential may still support attribution after cryptographic and persisted binding checks; recording its failure must never grant access or bypass expiry. Unattributable failures belong only in restricted server diagnostics.

Use server-generated request correlation. Do not log access/refresh tokens, authorization codes, PKCE verifiers, or credential-bearing query strings. Redacting the request URL does not sanitize separate structured OAuth log fields. If diagnostic persistence fails, retain the authentication rejection and protocol challenge.

Regression coverage should include a signed expired credential with trusted history, forged signature and wrong audience/client with no guessed user history, and an audit-storage failure that still rejects access. Keep sensitive request metadata out of test output and fixtures.

Evidence: `mcp-auth-diagnostics.integration.test.ts` covers expired/replaced credentials, untrusted bindings, correlation safety and failure handling. Existing edge-routing guidance in `chatgpt-mcp-cloudflare-edge.md` remains separate: absent server records do not prove a request reached Vakwen.
