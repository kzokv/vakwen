# Documentation

## Structure

| Directory | Purpose | Lifecycle |
|-----------|---------|-----------|
| `001-architecture/` | System design and architecture docs | Evergreen — update in place |
| `002-operations/` | Runbook, setup guides, env reference | Evergreen — update in place |
| `003-adr/` | Architecture decision records | Append-only — one ADR per decision |
| `004-notes/` | Frozen technical snapshots | Never update after merge |

## Architecture (`001-architecture/`)

- [System Architecture](001-architecture/architecture.md) — monorepo layout, request lifecycle, deployment topology, build model
- [Auth and Session](001-architecture/auth-and-session.md) — OAuth flow, dev_bypass, demo mode, cookies, identity resolution
- [Backend, DB & API](001-architecture/backend-db-api.md) — Postgres schema, ER diagram, API routes, persistence write paths
- [Web Frontend](001-architecture/web-frontend.md) — component layering, auth middleware, session resolution
- [Canonical Accounting Model](001-architecture/canonical-accounting-model.md) — entities, terminology, invariants
- [Glossary](001-architecture/glossary.md) — domain terms, project conventions, system concepts
- [Research Disclosures](001-architecture/research-disclosures.md) — official announcements, retained artifact reads, report gates and operator recovery

## Operations (`002-operations/`)

- [Runbook](002-operations/runbook.md) — local dev, deployment, troubleshooting, rollback, secrets
- [Environment Variables](002-operations/environment-variables.md) — all env vars, schemas, validation, generation
- [CI/CD](002-operations/ci-cd.md) — GitHub Actions, deploy workflows, PR gate
- [macOS VM Docker Setup](002-operations/macos-vm-docker-setup.md) — Mac-specific Docker config
- [Acceptance Test Mapping](002-operations/acceptance-test-mapping.md) — test coverage mapping, AAA spec inventory, 7-suite definition

## ADRs (`003-adr/`)

- [Commission Discount Percent-Off Locale Semantics](003-adr/adr-commission-discount-percent-off-locale-semantics.md)

## Notes (`004-notes/`) — frozen snapshots

- `001-planning/` — ticket specs and implementation contracts (KZO-11, KZO-14, KZO-33)
- `002-accounting/` — accounting patterns, migration compatibility, correction rules
- `003-oauth-env-refactor/` — OAuth & env refactor arc (plans, reviews, implementation TODOs, debates)
- `automation-refactor/` — AAA test framework arc (design, migration, code reviews, audits, architecture snapshot)
