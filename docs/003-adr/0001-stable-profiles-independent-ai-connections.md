# ADR-0001: Stable profiles with independent AI connections

Status: Accepted 2026-10-02. Implementation present in the working checkout; final integration and rollout validation pending. See [implementation evidence](../notes/chatgpt-reauthorization/implementation-evidence.md).

Vakwen presents one stable Connected Profile per Vakwen User and permits independently manageable AI Connections for that profile, subject to an explicit connection limit. Creating or reconnecting one connection must not silently revoke another. Portfolio delegation remains within the user's existing access model; chats and selected portfolios do not create new profiles.

The previous one-active-connection policy allowed a new ChatGPT authorization to invalidate another entry for the same user, producing repeated reconnect prompts. Stable profile identification improves recognition across reconnects; independent authorizations prevent broad replacement from breaking unrelated access. Profile identification alone is not assumed to remove duplicates or establish a replacement target.

We reject a global single-active-connection policy for the same user and AI client type. Implementing this decision requires changing the database uniqueness constraint, activation logic, and tests together. Existing revoked grants must remain revoked. Expiry/cleanup policy and the proposed rollout/rollback safeguards are recorded in the [fix plan](../notes/chatgpt-reauthorization/fix-plan.md).

## Explicit replacement — accepted 2026-10-02

At consent, users can create another connection or explicitly select one existing connection to replace. Replace becomes effective only after successful token exchange; cancellation or precommit token-exchange failure preserves the existing authorization, and unrelated connections remain valid. Keep the superseded record as history. This adds a consent-screen decision but gives users immediate control over duplicate cleanup without guessing which authorization they intended to replace.

The profile identity cannot identify a specific old connection. The replacement target must be explicitly selected, bound to the consent transaction, checked for ownership and eligibility, and committed atomically with new activation. Replacing a Vakwen grant does not guarantee removal of the old entry from ChatGPT settings.

## Connection capacity — accepted 2026-10-02

Retain the existing administrator-configured active-connection limit per Vakwen User across AI clients; the current production value is three. This change does not increase the limit or create separate per-client allowances. At capacity, creation is unavailable while a valid explicit replacement can proceed without increasing the active count. Revoked and expired connections do not consume active capacity, and capacity must be rechecked atomically when the new grant activates.

## OAuth client coverage — accepted 2026-10-02

Apply independent creation and explicit selected replacement to both existing OAuth client types: ChatGPT and Claude.ai. They share the faulty lifecycle path, so both receive the change and regression coverage. Preserve bearer-client lifecycle behavior and bearer-specific limits. The OpenAI profile metadata is used for ChatGPT recognition; equivalent client-side identity recognition is not assumed for Claude.ai. A replacement is scoped to the eligible requesting client type, so a ChatGPT authorization cannot replace a Claude.ai connection.

## Expiry and cleanup — accepted 2026-10-02

Retain existing connection lifetimes, administrator maximums, inactivity expiry, and security-driven revocation. Do not add a shorter OAuth timeout or revoke grants based on duplicate profile identity or similar labels. Users can replace or revoke unused connections; otherwise existing expiry rules apply. Migration does not reset expiry or reactivate historical grants.

## Operational transition

New authorizations can be paused with `MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false` while existing access and refresh continue under their existing security rules. Drain old broad-replacement writers before enabling independent authorizations. Legacy consent without an explicit bound action fails closed. Use [the cutover and recovery procedure](../notes/chatgpt-reauthorization/rollout-and-recovery.md); historical credentials are never reactivated and rollback must retain independent-grant compatibility.
