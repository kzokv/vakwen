# ChatGPT reauthorization: approved fix plan

Date: 2026-10-02 (Asia/Taipei). Status: complete plan approved in the 2026-10-02 implementation handoff; implementation delivered through PR #305, with final repository gates and review tracked there. Hosted-client rollout validation remains separate. No deployment authorized. Production baseline: `main` at `28fa1b7380545ee340e7282dee4213609b3c5f4c`.

## Verified diagnosis

ChatGPT retained two connection entries for the same Vakwen user. One was healthy; one required authentication. Disconnecting the stale entry restored three production read calls, including the original affected conversation. UI access records: 14:04:58, 14:06:23, 14:11:14. Earlier grants were revoked with `replaced_by_oauth_authorization`.

Production code activates each new OAuth grant by revoking other connections for the same user/vendor/client-kind/auth-mode. Migration 095 enforces one active row for that tuple. Migration 097 removes only the older provider-level index. Memory persistence mirrors the replacement policy. Existing tests explicitly require replacement: this is an intentional policy that conflicts with independent ChatGPT connections.

The production UI replacement loop was not completed: automatic approval review rejected duplicate consent, and the pending request was denied. Local reproduction establishes backend causality; it does not prove deterministic ChatGPT UI routing. Production evidence consists of UI access/audit records, not raw HTTP request traces.

## Feedback loop

The earlier five-run characterization test passed by asserting today's broken behavior. That is useful evidence, but is not a regression gate. A proposed independent-connection regression now asserts that A stays usable after B is authorized.

Command, already run against an isolated archive of main:

```sh
cd /private/tmp/vakwen-oauth-repro-20261002/apps/api
../../node_modules/.bin/vitest run test/integration/mcp-oauth.integration.test.ts -t 'regression: connecting B' --reporter=dot
```

Minimal trigger: authorize A → initialize A and confirm a read succeeds → authorize B with the same user/client/read scope → call through A's existing session.

- Trigger present: **3 failed**, with `Adding independent connection B must not emit a reconnect challenge for working connection A: expected true not to be true`.
- Remove only authorization B: **3 passed**.
- Whole command: 16.16 seconds red, 8.80 seconds control; test bodies under one second. Three repetitions in each invocation.
- Failed response: HTTP 200, MCP `isError: true`, `mcp/www_authenticate` with `invalid_token` and `MCP connector connection is not active`.
- Tests use real Fastify OAuth/MCP handlers with memory persistence. Postgres was inspected but not executed. No production time, expired token, financial-write scope, UI widget, or refresh request is necessary.
- This assertion now applies to the accepted Create another connection path. A separate Replace selected connection test must assert that only the explicitly selected old connection is revoked after successful token exchange.

Ranked hypotheses and predictions: (1) replacement revokes A, so removing B keeps A healthy; supported by the differential control, code and production history; (2) expiry/refresh breaks A regardless of B; not supported by the control and immediate execution without refresh; (3) scope mismatch breaks A; not supported because both grants have identical read scope and A worked before B.

## Agreed language

Vakwen User, Connected Profile, and AI Connection are recorded in [AI Connections glossary](glossary.md). The profile identifies the authenticated user, not a delegated portfolio or a particular authorization.

Connection Replacement is now defined in the AI Connections glossary. Fresh consent offers Create another connection or Replace an existing connection; the user supplies the replacement target explicitly because the incoming authorization flow does not reliably identify it.

## OpenAI documentation clarification — 2026-10-02

Official references: [Plugin authentication](https://developers.openai.com/plugins/build/auth#support-multiple-accounts), [Workspace connections](https://learn.chatgpt.com/docs/enterprise/shared-connections).

Multi-account is an optional product capability, not a requirement to authorize every chat/session. Personal and work identities are an explicit example. OpenAI also documents company-managed connections for eligible shared workflows. Neither establishes that each tab, project, or device needs its own grant.

The auth contract leaves the provider's profile model to the provider. A profile tool supplies stable identity across reconnects and can improve recognition and duplicate detection; it does not guarantee duplicate cleanup or identify a particular prior OAuth grant for replacement.

Important correction to the framing: different Vakwen users already have different replacement keys. Personal/work examples alone do not prove our current per-user constraint must be removed. Our observed defect involves multiple credentials for the same user.

Accepted direction (2026-10-02): one stable connected profile per Vakwen user, existing delegated portfolio selection within that profile, and independently revocable grants when distinct connections legitimately coexist. Add the profile tool to improve client identity handling; retain a bounded grant policy without silent broad revocation. A profile-only fix must be tested rather than assumed to solve the lifecycle issue. Shared corporate connection support is a possible future use case, not proposed current Vakwen scope.

## First decision — accepted 2026-10-02

Scenario: the same person connects the same Vakwen user in two ChatGPT entries or two ChatGPT workspaces. Should both continue to work?

Decision: expose one stable profile per Vakwen user and permit independent OAuth connections for that profile, subject to an explicit active-connection limit. Creating or reconnecting one must not silently revoke another. Do not silently increase limits or revive revoked credentials.

Rejected alternative: retain one active connection, but reject or explicitly confirm replacement before invalidating it. This is a narrower change but cannot support simultaneous independent ChatGPT connections.

See [ADR-0001](../../003-adr/0001-stable-profiles-independent-ai-connections.md). This accepts the lifecycle invariant, not every implementation detail below.

## Second decision — accepted 2026-10-02: explicit consent-screen choice

Decision: Vakwen's consent screen offers **Create another connection** or **Replace an existing connection**. Replacement requires the user to select the specific connection. It must never be inferred from a shared user, display name, profile ID, client ID, or client kind.

The replacement is committed only when the new authorization successfully reaches token exchange. Cancellation, denied consent, expired authorization codes, and token-exchange failure before the activation transaction commits must leave the selected existing connection usable. Other connections and the Connected Profile identity remain unchanged. Retain the old record in history with a replacement reason and link it to the new connection.

Implementation requirements for the agreed choice:

- Bind the action and selected target to the server-side consent request and resulting authorization code. Validate ownership and eligible client/authentication type at consent and again during activation.
- Require an explicit target for Replace; show identifying information and the impact on the old authorization. No automatic replacement selection based on the same profile.
- Activate the new grant, persist its refresh credentials, and revoke only the selected target in one atomic operation with capacity enforcement. If the target was concurrently replaced, revoked, or otherwise became ineligible, return an actionable error; do not silently switch targets or fall back to unrestricted creation.
- Preserve consent scope checks and explicit approval for the new grant. Do not copy broader permissions merely because the replaced connection had them.
- A Vakwen replacement cannot itself remove an old entry from ChatGPT settings. Explain that the old authorization stops working; validate how ChatGPT's profile recognition handles the entries during rollout.

Rejected initial recommendation: always create a fresh grant and defer unused-connection cleanup. The user prefers an explicit replacement option during authorization.

## Third decision — accepted 2026-10-02: preserve connection capacity

The production UI currently shows an administrator-configured maximum of **3 active connections per user**. Existing activation counts active, unexpired connections across client types, but excludes the class being implicitly replaced. Independent connections require counting each retained active grant instead.

Decision: retain the configured per-user total limit; do not silently raise it or convert it into a separate allowance per client. For the current production setting this means three active connections in total. At the limit, disable Create another with a clear explanation and allow a selected valid replacement that leaves the active count unchanged. Expired/revoked records do not consume active capacity. Recheck atomically at exchange; the screen's earlier count is advisory.

Rejected alternatives: changing the allowance to a per-client limit or raising the total. The administrator setting remains configurable; this fix preserves its current value and per-user scope. No new hard-coded limit is introduced.

## Fourth decision — accepted 2026-10-02: both OAuth clients

Main's client registry exposes OAuth for ChatGPT (`chatgpt_app`) and Claude.ai (`claude_ai_connector`). They share the authorization/activation implementation, although each has its own vendor/client-kind identity. Both can therefore be affected by replacing all grants of one client type for the same user.

Decision: apply independent creation and explicit selected replacement to both existing OAuth client types, so the shared lifecycle has one policy. Preserve bearer-client lifecycle rules and existing bearer-specific limits. Add the OpenAI profile designation for ChatGPT identity recognition; do not claim equivalent Claude profile recognition without validation. Replacement targets must remain eligible for the requesting OAuth client type and never replace another client's connection merely to free capacity.

Rejected alternative: changing ChatGPT only while retaining Claude.ai's broad replacement policy. Both supported OAuth client types will receive the same lifecycle behavior and regression coverage; bearer lifecycle rules remain unchanged.

## Fifth decision — accepted 2026-10-02: automatic names with optional renaming

Main currently creates OAuth connections with the client default display name (ChatGPT or Claude.ai). Independent connections would therefore share names unless the UI adds a distinction. The same Connected Profile's display name must not be used as the only replacement selector label.

Decision: generate a useful connection label automatically and allow optional user renaming. Show creation time, last-used time, expiry/status, and permissions alongside the label when choosing a replacement. Do not claim to know a ChatGPT workspace or device when the authorization flow does not provide that information. Default labels must be distinguishable even when several connections are created close together; the exact naming format is an implementation choice.

Rejected alternative: requiring a connection name before approval. Users may use labels such as ChatGPT personal or Claude research, but naming must not block authorization. Renaming a connection must not change its Connected Profile identity, credentials, scopes, or expiry. Preserve existing user-assigned labels during migration; use additional identifying details where legacy default labels collide. Vakwen labels do not guarantee the same labels are displayed in external AI-client settings.

## Sixth decision — accepted 2026-10-02: preserve expiry and inactivity rules

The existing consent flow lets users choose a lifetime bounded by the administrator's maximum. Production currently has a 90-day maximum and a 90-day inactivity setting; an individual grant can expire sooner. Security revocation, account deactivation, session-version resets, and explicit user revocation remain separate existing controls.

Decision: preserve those lifetime/inactivity rules. Do not add automatic duplicate detection that revokes a grant merely because another connection represents the same profile or has a similar name. Users can explicitly replace or revoke an unused connection to free capacity; otherwise it follows its existing expiry rules. Expired connections must be reflected accurately in list/cap calculations even if they have not received a recent request. Abandoned pending authorizations should follow existing authorization expiry and must not consume active capacity.

Rejected alternative: adding a shorter OAuth-specific inactivity threshold to free slots sooner. Do not shorten existing lifetimes, reset their clocks during migration, or add automatic same-profile revocation. Existing security-driven revocation remains enforced.

## Approved implementation scope

1. Add an authenticated read-only profile tool with stable opaque identity and OpenAI profile metadata. Derive the profile from validated credentials, not the selected/delegated portfolio. Preserve identity across refresh, reconnect, scope upgrades and label changes. Implement the accepted Create another / Replace selected consent choices with a server-bound explicit replacement target. Never infer the target from profile or client identity alone.
2. Add an append-only database migration to narrow/remove the active uniqueness constraint for ChatGPT and Claude.ai OAuth connections. Preserve constraints and lifecycle rules for other authentication modes. Keep existing connection IDs, scopes, credentials, expiry and revocation states intact.
3. Replace broad revoke-and-activate behavior in both persistence backends. Activate Create another grants independently and replace only the user-selected grant for Replace; enforce the agreed cap atomically, including concurrent authorization. Expire stale rows before counting as appropriate. Do not solve the bug by bypassing the cap.
4. Preserve consent, tenant isolation, client/resource binding, session-version checks, expiry and refresh-replay protection. Scope expansion must still require consent. Ordinary token rotation must remain within its original grant.
5. Record authentication failures before returning the MCP challenge. Correlate request and known connection safely; never trust an unverified token's user/connection claims for attribution. Redact credentials and make the useful reason visible in the UI.
6. Distinguish replacement/revocation from refresh-token replay in diagnostic reasons. Preserve protocol-compatible OAuth errors and the security response to real replay.
7. Update the connection-management UI to distinguish independent entries, show per-connection last use and expiry, and revoke only the selected connection. Generate distinguishable default labels, allow optional renaming, and display creation/last-use context in the replacement selector. Preserve the accepted expiry/inactivity and manual cleanup rules.
8. Replace tests that mandate broad replacement. Add the selected regression plus refresh of both grants, same/different OAuth client IDs, explicit replacement, cancelled/failed replacement, stale or cross-user replacement targets, competing replacements, cross-user isolation, per-grant revocation, scope isolation, stable profile identity, distinct-user profiles, cap exhaustion, concurrency, and migration preservation/rollback cases. Cover actual Postgres, not just memory.
9. Validate memory/MCP scopes first, then `npm run test:integration:full:host` for managed Postgres. Add focused UI tests for changed behavior. Use the repository's full eight-suite gate if claiming all tests pass.
10. Roll out through dev before main. Do not automatically reactivate historical grants. Existing stale ChatGPT entries may still need one-time cleanup. Once multiple active grants exist, restoring the old unique index cannot be a blind rollback; specify a compatible rollback or explicit cleanup policy.

## Delivery sequence and boundaries

1. Prepare implementation from the normal development base, comparing its current OAuth code with the pinned production baseline before porting the reproducer. Do not overwrite unrelated workspace changes. Repository commits/PRs require ticketed metadata and PRs target dev; establish that metadata when implementation starts, not as part of this planning interview.
2. Add the failing independent-connection regression for both OAuth client types. Add selected-replacement and failure-preservation tests before changing the lifecycle. Retain the full original reproduction as a final verification scenario.
3. Introduce shared create/replace activation semantics in memory and Postgres, consent action/target storage, and transactional token credential persistence. Use a per-user serialization mechanism that also coordinates other operations consuming the same global capacity; locking only existing matching OAuth rows is insufficient when two new grants race or a bearer connection is created concurrently. Preserve bearer behavior while protecting the existing shared cap.
4. Add an append-only migration that permits multiple active ChatGPT/Claude.ai OAuth grants and retains applicable bearer constraints. Preserve all existing identities, grants, scope limits, token hashes, expiries, and revocation states. Record the selected replacement relationship for history and diagnostics. Choose new migration numbers against the implementation branch, never rewrite migration 095.
5. Add the authenticated profile tool and stable identity contract, then the consent create/replace choice, connection labels/rename, and capacity/expired-state display. The profile must always represent the authenticated Vakwen User, including when a tool acts on a delegated portfolio. Do not reuse a grant ID, portfolio ID, mutable email, or label as the profile ID.
6. Add focused request diagnostics and UI visibility through existing activity/history surfaces, then run the validation matrix below. Preserve protocol errors expected by OAuth clients.
7. Deploy to dev and validate both OAuth clients before proposing promotion to main. Production deployment is a later reviewable action; this plan does not authorize it.

Token-exchange success means the server-side transaction committed. Delivery of an HTTP response cannot be atomic with a database transaction: a response lost after commit may still leave the selected old grant revoked. Keep replay protection; log this boundary and test safe failure/recovery instead of promising that every client-visible network error preserves the old grant. A late failure must never revoke a second, unrelated connection.

## Diagnostics

- Successful calls, denials, and connection lifecycle events should expose useful outcomes in the existing user activity/history UI, including request correlation where available and the selected connection label.
- Authentication failures that can be attributed using trusted credential validation should carry a precise reason such as expired, explicitly revoked, or replaced. Never associate a request with a user's history solely from unverified token claims. Unattributable failures belong in restricted server diagnostics, not a guessed user's activity feed.
- Correlate consent, token exchange, create/replace action, and MCP request IDs without storing access tokens, refresh tokens, authorization codes, PKCE verifiers, or sensitive query strings in logs.
- Distinguish actual refresh-token replay from a credential already revoked through replacement. Retain existing replay protections and security-reset behavior.
- The UI can improve evidence coverage, but it must not imply that a missing request reached Vakwen; external ChatGPT routing or client caching remains outside the server's logs.

## Required validation

| Seam | Required signal |
|---|---|
| Real OAuth/MCP routes, memory and Postgres | A works; create B; A and B both work; both can refresh independently; repeated runs are deterministic for ChatGPT and Claude.ai. |
| Selected replacement | Replace A with C; C and unrelated B work; A rejects access and refresh; only A is linked as replaced. |
| Failure boundaries | Deny/cancel/expired code/precommit persistence failure preserves A; stale or foreign target is rejected; postcommit response loss does not trigger extra revocations. |
| Capacity/concurrency | At the configured total cap, create is rejected and valid replacement succeeds; concurrent create/create, create/replace, replace/replace and OAuth/bearer operations cannot exceed it. Expired/revoked records do not count. |
| Identity and permissions | Profile ID stable through refresh/reconnect/rename/scope change; distinct users differ; delegation does not change authenticated profile; credentials and scopes remain isolated; replay and account-security revocation still work. |
| Consent/settings UI | Explicit create/replace choice; no guessed replacement; distinguishable labels with optional rename; creation/last-used details; clear capacity and stale-target errors; accurate expired state. |
| Migration | Clean install and upgrade from current schema; rerun safety; existing grant/token preservation; bearer constraints preserved. |
| Diagnostics | The auth failures previously absent from activity are recorded when safely attributable; request correlation works; secret redaction and cross-user visibility checks pass. |
| Hosted clients | Dev browser tests for both ChatGPT and Claude.ai: independent creation, selected replacement, cancellation, refresh, profile recognition where supported, and correct remaining connections. Preserve user-approved credentials and scopes. |

Run the smallest changed route/UI suites first, then the exact managed Postgres command `npm run test:integration:full:host`. Before calling the complete change ready, use the root AGENTS.md eight-suite gate; a subset is not "all tests pass." Keep hosted-client evidence separate from local test results. Lack of access to a hosted client must be reported as an unverified rollout gate, not replaced by an assumption.

## Migration and rollback

- Keep currently valid production connections usable during upgrade. Do not revive historical revoked tokens, force all users to reconnect, or alter configured lifetime/connection limits.
- Existing stale ChatGPT/Claude entries may still require one-time removal or deliberate reauthorization in that client. Server-side history cleanup does not remove external entries.
- Stage database and application changes with a compatibility-aware rollout. Do not enable multiple active OAuth grants while older writers that perform broad replacement are still serving authorizations. Account for old consent pages and in-flight authorization codes during cutover: never fall back to the old implicit-replacement behavior for missing action/target fields.
- Preserve a recovery path that can suspend new authorizations while existing grants continue working. After independent grants exist, rolling back to code that revokes all same-client connections is unsafe even if the old database index stays removed.
- Do not blindly recreate the former unique index: duplicate active rows are now legitimate. Prefer a compatibility hotfix or forward repair. Any rollback requiring revocations must be an explicit reviewed operation, with backups and a selected survivor policy, not automatic data deletion.

## Shared understanding

Accepted: stable profile; independent AI Connections; explicit user-selected replacement; the existing configurable total limit (currently three); both ChatGPT and Claude.ai OAuth clients; automatic names with optional renaming; and existing expiry/inactivity rules. These choices are recorded in this plan, the AI Connections glossary, and ADR-0001 where architectural rationale is needed.

The remaining work is implementation and verification under those decisions. The final shared-understanding check was completed and approved, as recorded in the 2026-10-02 implementation handoff. No additional product-policy decision is assumed beyond the recorded choices; engineering safeguards above make them enforceable. No fix, migration, commit, PR, or deployment has been performed during the planning interview.

## Evidence

The prior investigation, production UI captures, sanitized local request traces, characterization patch, minimal red regression patch, and no-B control log are saved under:

`/Users/lume/.codex/visualizations/2026/10/02/01a0faf3-b510-7990-bfb3-727c621fc1c2/vakwen-auth-evidence/`

Historical planning stop (before the approved implementation handoff): no application fix or migration had been applied. Diagnosis phases 1–4 were supported by the investigation and red/control experiment; implementation and fix verification were deferred at that time.

Current implementation status and verified/pending gates are maintained in [implementation-evidence.md](implementation-evidence.md). The approved operational procedure is documented in [rollout-and-recovery.md](rollout-and-recovery.md); it is not deployment authorization.
