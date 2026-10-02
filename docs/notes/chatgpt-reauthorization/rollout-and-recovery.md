# Independent OAuth connections: cutover and recovery

This is an operator procedure for a later approved deployment. No deployment is authorized by the implementation handoff or this document. Validate in dev before considering main. Local tests cannot prove ChatGPT or Claude.ai routing or profile recognition.

## Preconditions

- Complete the eight repository gates and the focused migration/concurrency matrix on the final rebased revision. Preserve sanitized logs and the exact tested SHA.
- Apply append-only migration `123_independent_oauth_connections.sql`, numbered after latest dev migration 122. Validate clean install, upgrade, preservation, and rerun safety before rollout. Never rewrite applied migration 095.
- Capture a database backup using the approved environment workflow. Treat backup contents as sensitive. Record current configurable total connection cap and lifetime/inactivity settings; preserve them.
- Have a compatible build available that supports independent grants and the authorization pause switch. Pre-fix broad-replacement code is not a safe recovery build.

## Cutover

1. Set `MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false` in the deployment configuration for the compatible API build. The setting is read at process startup; restart/roll out those API processes for the value to take effect. It pauses authorization start, consent approval, and authorization-code exchange. Existing access-token validation and refresh-token exchange remain available, subject to normal expiry and security checks. Denial remains available.
2. Drain all old OAuth authorization writers before enabling the changed schema or accepting any new authorization. Old binaries do not understand the new switch; use the environment's ingress/traffic controls to prevent them receiving `/oauth/authorize`, consent approval, and authorization-code exchange requests. Preserve access and refresh routes. Do not assume setting an unknown variable in an old process freezes it.
3. Apply the approved append-only migration through the normal migration runner after backup and writer drain. It narrows the active uniqueness index only for ChatGPT/Claude.ai OAuth, keeps bearer uniqueness, and adds consent action/target and replacement-history fields. Existing labels, IDs, scopes, credential hashes, expiries, and revocation states are retained.
4. Start only compatible API and web builds with new authorizations still paused. Verify a preexisting active grant can make a read call and refresh. Verify revoked and expired grants remain rejected, the configured global cap is unchanged, and settings show accurate active/history entries.
5. Handle in-flight consent conservatively. Old pages missing `connectionAction` must fail validation and restart authorization. Legacy authorization codes without a bound action fail closed at activation; they must not trigger implicit replacement. The pause check runs before code consumption, but authorization codes still obey their original expiry. Do not extend expiry to bridge the deployment.
6. After all old writers are gone and dev checks pass, set the switch to `true`, restart the compatible API processes, and validate fresh consent. Create B while A remains usable; refresh both; replace only A with C; verify B and C remain usable and A access/refresh fail. Repeat for ChatGPT and Claude.ai, including cancellation and capacity exhaustion. Test only approved accounts and scopes.
7. Record hosted-client behavior separately: stable profile recognition where supported, existing conversation routing, visible remaining client entries, and manual cleanup needs. OpenAI profile metadata does not promise duplicate deletion; no equivalent Claude profile behavior is assumed. Main promotion requires a separate reviewable deployment decision.

## Recovery

Set `MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false` on every compatible API process and restart them to stop further creation/replacement while investigating. Keep existing access and refresh available; do not disable the entire MCP service merely to pause authorization. Verify this separation with an existing grant.

Prefer a forward repair or a compatible application rollback retaining independent-grant semantics and the expanded schema. Never restore old broad-replacement writers or blindly recreate the former unique index: multiple active OAuth grants are legitimate. A schema rollback requiring revocation needs its own reviewed backup, explicit survivor selection, and operator-approved cleanup plan.

The persistence transaction is the replacement commit boundary. A lost response or audit failure after commit may leave the selected old authorization revoked even if the client reports failure. Inspect the new connection and replacement link using safe request/consent correlation. Retrying a consumed code must not revoke another grant. Do not revive the old grant or change unrelated connections to conceal the failure; start a fresh, explicit consent flow if needed.

Do not reactivate historical credentials, reset expiry clocks, increase limits, or delete history as recovery shortcuts. Removing an entry from Vakwen history does not remove its counterpart in an AI client's settings. One-time removal of a stale external entry remains an explicit user action.
