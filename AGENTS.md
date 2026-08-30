# AGENTS.md

## Project Overview

- Root policy for this monorepo. The nearest local `AGENTS.md` wins for touched files.
- Read the nearest local `AGENTS.md` before changing a subtree with area-specific rules.

## Session Context

- Read `.worklog/latest-handoff.md`, `.worklog/current-focus.md`, and `.worklog/open-questions.md` only for resumed work or when prior-session context materially affects the task.

## Workspace Structure

- `apps/api` — Fastify API server (`@vakwen/api`)
- `apps/web` — Next.js web app (`@vakwen/web`)
- `libs/config` — shared env, config, validation (`@vakwen/config`)
- `libs/domain` — domain logic (`@vakwen/domain`)
- `libs/shared-types` — shared TypeScript types (`@vakwen/shared-types`)
- `libs/test-framework` — generic, app-agnostic AAA test framework (`@vakwen/test-framework`)
- `libs/test-e2e` — app-specific web E2E assistants, pages, fixtures (`@vakwen/test-e2e`)
- `libs/test-api` — app-specific API HTTP endpoints, assistants, fixtures (`@vakwen/test-api`)

## Repo-Specific Rules

- Keep `compilerOptions.strict` enabled across the TypeScript config chain.
- Keep scripts, commands, and docs synchronized when workflows change.
- Run the smallest relevant test scope first, then broader regression checks.
- When analyzing external API data, save the first raw response under `.worklog/<slug>/` and reuse that snapshot for subsequent analysis instead of refetching it. This preserves reproducibility and provider rate limits.
- Use `npm run test:integration:full:host` on Darwin or the lume VM shell, and `npm run test:integration:full:container` in Linux containers, for managed API Postgres integration coverage.

## Test Suites

"Full tests pass" requires ALL eight suites clean:

1. `npx eslint .` — full project lint (run from repo root)
2. `npm run typecheck` — typecheck (builds libs, then `tsc --noEmit` on both apps)
3. `npm run test --prefix apps/web` — web unit tests (vitest)
4. `npm run test --prefix apps/api` — API package tests (unit + memory-backed integration)
5. `npm run test:integration:full:host` — API integration tests (CI/host mode)
6. `npm run test:e2e:bypass:mem --prefix apps/web` — standard E2E (Playwright, dev_bypass)
7. `npm run test:e2e:oauth:mem --prefix apps/web` — OAuth E2E (Playwright, AUTH_MODE=oauth)
8. `npm run test:http --prefix apps/api` — API HTTP tests (Playwright, AUTH_MODE=oauth)

Never declare "all tests pass" with a subset.

**Common mistake — suite 4 does not replace suite 5.** Running `npm run test --prefix apps/api` (or bare `npx vitest run` in `apps/api/`) executes API unit tests plus memory-backed integration tests. Suite 5 (`test:integration:full:host`) spins up a managed Postgres + Redis stack and runs the full Postgres-backed integration suite. These are different test populations — migrations, identity resolution, and persistence tests only run against real Postgres. Always use the exact commands listed above.

## Git And PR Gate

- This repository is Linear-driven: commit subjects and PR titles must use `type(scope): LINEAR-TICKET: subject`.
- The only waiver path is PR label `waiver:linear-ticket` plus `## Waiver` fields `Reason:`, `Approved-by: @handle`, and `Scope: title|commits|both`.
- If the work is repo or process improvement and no ticket is already anchored in the branch, commits, or explicit user request, stop and confirm whether to use the waiver path before creating ticketed git metadata.

### PR Submission

- **Base branch:** Always target `dev`.
- **Assignee:** `--assignee @me` on every PR.
- **Labels:** At least one primary label matching PR content: `bug`, `enhancement`, `documentation`. Multiple primary labels allowed when the PR spans categories (e.g., a feature with significant doc updates gets both `enhancement` and `documentation`). If no existing label fits the change context, ask the user for approval before creating a new label.
- **Body format:** Use `docs/git-pr-flow.md` (global) required sections:
  - `## Problem`
  - `## Solution`
  - `## Testing` — must include `Evidence:` or `Waiver:` block
  - `## Risk/Rollback`
- CI enforces all of the above via `.github/workflows/pr-gate.yml`.

## AAA Project-Specific Conventions

**Fixture base decision tree:**

| Base | Auth | Prewarming | Use for |
|---|---|---|---|
| `base.ts` | Authenticated + identity | 5 routes prewarmed | Standard app feature tests |
| `noAuthBase.ts` | None | None | Login flows, auth errors, unauthenticated behavior |
| `sessionBase("oauth")` | OAuth session cookie | None | OAuth-specific flows, session management |
| `sessionBase("demo")` | Demo session cookie | None | Demo account flows, rate-limited tests |

**Playwright config files:**

| Config | Auth mode | Servers | Test dir |
|---|---|---|---|
| `apps/web/tests/e2e/playwright.config.ts` | `dev_bypass` | web+api | `specs/` |
| `apps/web/tests/e2e/playwright.oauth.config.ts` | `oauth` | web+api | `specs-oauth/` |
| `apps/api/test/http/playwright.config.ts` | `oauth` | api-only | `specs/` |

**Test naming convention:** `"[context]: [action] → [result]"` with arrow (`→`) separators for multi-step flows. Name should reveal what's being verified without reading the test body.

**Cookie mode divergence:** OAuth fixtures use `cookieMode: "domain"` (global), demo uses `cookieMode: "url"` (scoped). Switching fixture bases changes cookie behavior silently.

**Fixture barrel exports (`test-e2e/src/fixtures/index.ts`) are unused.** Specs import directly from specific fixture files (e.g., `@vakwen/test-e2e/fixtures/appPages`).

## Context7 Sources

- `/microsoft/typescript`
- `/typescript-eslint/typescript-eslint`
- `/microsoft/playwright.dev`
