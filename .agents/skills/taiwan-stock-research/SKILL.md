---
name: taiwan-stock-research
description: Produce canonical identity-only research for TWSE and TPEx listings through Vakwen research MCP tools.
---

# Taiwan Stock Research

Use this skill when the user asks to identify or research a Taiwan-listed company, ETF, or ETN and the answer must be grounded in Vakwen's canonical, effective-dated identity store.

Read `references/research-report.md` before producing a report.

## Required Workflow

1. Establish exactly one subject selector:
   - Prefer an existing `listing_id` when the user supplies one.
   - Otherwise require both the exact ticker string and `TWSE` or `TPEX` venue.
   - Never convert a ticker to a number, remove leading zeroes, infer the venue, or silently choose among ambiguous listings.
2. Establish one fixed temporal context:
   - `knowledgeAt` is required.
   - Default `effectiveAt` to `knowledgeAt`.
   - Default `assessmentMode` to `effective`.
   - Require `policySetVersion` for `re_evaluate` mode.
3. Call `get_research_manifest` first with that selector and context.
4. Inspect the returned manifest before continuing:
   - If `orchestration.skillExposure` is not `enabled`, stop and state that Skill orchestration is disabled by rollout policy.
   - If `research_identity` is not `available`, stop with its exact status and reason code.
   - If subject resolution is unknown or ambiguous, preserve the MCP error code and ask only for the selector detail needed to resolve it.
5. Freeze the manifest-returned `listing_id` selector and returned temporal context. Use those exact values for every following call.
6. Call `get_research_identity` with the frozen selector and context. Request history only when it is relevant; follow `nextCursor` without changing the selector or temporal context.
7. Construct the canonical `research-report/1.0.0` artifact defined in `references/research-report.md`.
8. Render Markdown only as a faithful projection of fields and statements already present in that artifact.

## Scope And Eligibility

- `operating_company`: identity is supported, but this release still produces the `identity_only` report profile.
- `etf_limited`: identify the ETF and retain the limited-profile reason; do not invent holdings, valuation, or performance claims.
- `identity_only`: identify the security and state the returned scope limitation.
- `unknown`, `ineligible`, or `indeterminate`: return the exact eligibility state and reason code. Do not broaden research or substitute another data source.

Only `research_identity` is available in this release. Treat every other manifest dataset marked `unavailable` as unsupported. Do not call web search, portfolio catalog tools, market-data tools, or upstream providers to fill gaps.

## Guardrails

- Treat MCP `structuredContent` as canonical. Compact text is a summary only.
- Keep raw values, normalized values, missingness, effective time, knowledge time, provenance IDs, and contract versions intact.
- Do not merge issuers, securities, or listings based only on names or ticker similarity.
- Do not make target-price, buy/sell/hold, suitability, tax, or legal claims.
- Do not add prose claims during rendering. Put any scope statement in the canonical report before rendering it.
- Preserve stable MCP error codes in failures.
