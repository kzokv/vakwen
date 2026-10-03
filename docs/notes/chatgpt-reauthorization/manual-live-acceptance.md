# Manual deployment and hosted-client acceptance

Owner: the user deploys and runs these checks. The agent's automated results do not mark these checks passed.

Use an isolated test deployment and dedicated test identities. Record the exact deployed source revision and patch/build identifier; test the OAuth-only main port, not the original dev-based branch. Do not merge to main merely to trigger this test deployment.

## Before deploying

1. Confirm all eight automated gates passed for the candidate. Review `implementation-evidence.md` for exact results and known limitations.
2. Record the API/web URLs, current build identifier, configured total connection cap, and connection lifetime/inactivity settings. Keep these settings unchanged.
3. Have the deployment's normal database backup and a compatible recovery build available. Follow `rollout-and-recovery.md`; old broad-replacement binaries and the old unique index are unsafe rollback targets after independent grants are created.
4. If possible, create one test OAuth grant on the old build before upgrading. Record its Vakwen connection ID, label, scopes, created/expiry timestamps, and ability to perform a harmless portfolio read. This verifies preservation through the upgrade.
5. Use the approved deployment procedure to drain old authorization writers, apply `123_independent_oauth_connections.sql`, and start matching API/web builds with `MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED=false`. The flag requires an API restart; old binaries do not understand it. Preserve existing access and refresh traffic during the transition.
6. With authorizations paused, the existing test connection must still read. A fresh authorization must report temporary unavailability without replacing anything. After observing refresh as described below, enable new authorizations and restart the compatible API processes.
7. Confirm public HTTPS `/mcp`, OAuth issuer/resource metadata, and exact callback allowlists match this test environment. Use the shipped ChatGPT and Claude.ai OAuth paths. Claude Code bearer tokens are not a substitute for Claude.ai acceptance. Do not broaden callback allowlists just to make a failed connection succeed.

## Execute separately for ChatGPT and Claude.ai

Use the same dedicated Vakwen user for A, B, and C within each client run. Distinguish their labels, for example `ChatGPT A`, `ChatGPT B`, and `ChatGPT C`. Record actual connection IDs; labels and profile IDs do not identify the replacement target.

If the hosted client cannot keep two entries for the same server, use separate approved hosted-client test accounts connected to the same Vakwen test user, if supported. If there is no way to independently invoke both grants, mark that scenario blocked. Two browser tabs using one shared grant do not establish independence.

| Step | Action | Required observation |
| --- | --- | --- |
| 1. A | Start hosted-client OAuth. Choose **Create another connection**, label it A, and approve minimum read permissions. | A is active in Vakwen. An actual `list_portfolio_contexts` or equivalent harmless read completes and A's activity updates. |
| 2. Profile | Invoke `get_profile` where the client exposes it. Record the returned `id`. | Profile ID represents the signed-in Vakwen user. If the client cannot invoke/expose it, record that limitation; do not infer a pass. |
| 3. B | Start a second independent OAuth flow for the same Vakwen user. Choose create and label it B. | A and B have different connection IDs; both remain active. Run a fresh read through each independently and verify activity under the corresponding ID. |
| 4. Rename | Rename B in Vakwen settings. | Its ID, scopes, expiry, status, and credentials remain effective; B still reads. Its profile ID matches A's. Do not expect Vakwen labels to rename external client entries. |
| 5. Cancel | Start another flow, choose replace A, then deny consent. | A and B still read. Their status, expiry, scopes, and replacement history are unchanged. No new active connection appears. |
| 6. Replace | Start another flow, explicitly select A for replacement, label the new grant C, and approve. | C becomes active. A is revoked with replacement history pointing to C. B remains active with unchanged ID/expiry/scopes. B and C independently read. |
| 7. Old grant | Try a fresh tool call through the client entry that still holds A. | A cannot access portfolio data; it receives an authentication/reconnect failure. B remains usable. If the client silently switches to C, record this and do not claim old-grant rejection was observed. |
| 8. Refresh | Wait at least 16 minutes after the latest authorization/known token refresh, then make fresh reads through B and C. | Both succeed without new consent. Verify actual API activity and, where available, refresh exchange success. Access tokens last 15 minutes in this implementation. Do not rely on cached answers or assume a background refresh's timing. |
| 9. Reconnect identity | Compare C's `get_profile` result with the previously recorded profile ID. | The ID is identical for the same Vakwen user despite different connection IDs and labels. Record client-visible recognition separately. Equivalent Claude UI profile recognition is not assumed. |
| 10. Revoke | Revoke B in Vakwen, then make fresh calls through B and C. | B fails; C continues working. B's revocation must not revoke C. |

To verify a different Vakwen user's profile, use a separately approved test identity: its profile ID must differ, and it must not see the first user's private portfolio data.

## Capacity and selection boundaries

- On a dedicated account, reach the existing configured total connection cap using test grants. Do not raise the cap. Creation should be unavailable; replacing an eligible connection should work without increasing the count.
- A ChatGPT authorization must not offer a Claude.ai grant as a replacement candidate, and vice versa. Other users' grants must never be candidates.
- To test a stale selection, open consent selecting A, revoke A in another session, then approve the original consent. The operation must reject or require a refreshed selection; it must not replace B or activate an unintended grant.
- If testing with both clients at once would exceed the configured cap, finish one client run and revoke only its test grants before the next. Keep existing unrelated grants and history intact.

## Record results

For each step capture:

- Client, test-user label, UTC timestamp, deployed build identifier, and PASS / FAIL / BLOCKED.
- Connection IDs A/B/C, profile ID when observable, before/after status, and safe server request IDs from activity.
- Expected versus actual behavior, plus sanitized screenshots or logs for failures.

Do not record access/refresh tokens, authorization codes, PKCE verifiers, client secrets, or complete callback URLs. The app's history and server activity are evidence of the bound connection; client-visible duplicate entries alone are not evidence that grants were replaced.

| Acceptance group | ChatGPT | Claude.ai |
| --- | --- | --- |
| Existing grant survives upgrade and authorization pause | Pending | Pending |
| Independent A/B reads | Pending | Pending |
| Rename preserves grant | Pending | Pending |
| Cancel preserves A/B | Pending | Pending |
| Replace A with C preserves B | Pending | Pending |
| Old A rejected | Pending | Pending |
| B/C refresh without consent | Pending | Pending |
| Stable profile across reconnect | Pending | Pending |
| Revoking B preserves C | Pending | Pending |
| Capacity and eligible-target boundaries | Pending | Pending |

## Failure and cleanup

A client-visible token-exchange error after the database commits can still leave the selected old grant replaced. Inspect the connection IDs and replacement history before retrying; do not assume an error restored A.

On an unintended revocation, identity mismatch, or cross-user access, stop live acceptance and retain sanitized evidence. Pause new authorizations on the compatible build while preserving existing access/refresh, then follow the recovery procedure. Do not reactivate old credentials, reset lifetimes, delete history, or restore the old uniqueness index to conceal a failure.

After testing, revoke only the test grants and remove their hosted-client entries manually as needed. Supply the completed result table and failure evidence for review. Hosted-client acceptance remains pending until the required observations are recorded.
