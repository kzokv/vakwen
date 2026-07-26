# Bounded Account Mutation Persistence

`POST /accounts` and `PATCH /accounts/:id` must use narrow persistence operations. They must not call `loadStore()`/`saveStore()` or read/write unrelated transactions, holdings, market data, snapshots, or configuration.

- Account creation atomically writes the account, seeded default fee profile, audit row, and any required reporting-currency fallback state.
- Account update validates profile ownership and writes only the account/configuration rows and audit state involved in the change.
- Keep Memory and PostgreSQL implementations behaviorally equivalent.
- Protect the boundary with structural CI assertions that forbidden full-store methods are not called. Wall-clock thresholds are benchmark evidence, not blocking CI assertions.
- For performance evidence, benchmark against a representative large PostgreSQL history and retain raw plus summarized artifacts. Compare legacy full-store and bounded paths using identical seeded data.

Any new field added to an account mutation response or persistence operation must be reviewed across API routes, MCP callers, lifecycle responses, audit semantics, and initiating-client cache updates.
