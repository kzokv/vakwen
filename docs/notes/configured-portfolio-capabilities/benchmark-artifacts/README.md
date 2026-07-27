# Account mutation benchmark

Run `bash scripts/run-account-mutation-benchmark-host.sh` from a Darwin or host
shell with Docker available. The runner creates an isolated managed Postgres and
Redis stack, applies all numbered migrations, seeds two portfolios with at least
2,000 posted trade rows each, and compares the former full-store mutation shape
with the bounded `createAccount` and `updateAccount` persistence operations.

The benchmark uses two warmups and 24 measured samples by default. It writes raw
durations and a statistical summary beside this file. Numeric timing is
deliberately opt-in and is not a CI gate; unit and integration tests instead
assert structurally that account create/update never call `loadStore` or
`saveStore`.

## Recorded result

The 2026-07-26 Darwin arm64 run with Node 25.6.0 produced:

| Mutation | Legacy mean | Bounded mean | Speedup | Bounded P95 |
|---|---:|---:|---:|---:|
| Create | 6,538.95 ms | 11.17 ms | 585.42x | 16.85 ms |
| Update | 6,553.40 ms | 7.00 ms | 936.50x | 10.68 ms |

See `account-mutation-postgres-raw.json` for all 24 measured samples per
operation and `account-mutation-postgres-summary.json` for calculated
statistics.
