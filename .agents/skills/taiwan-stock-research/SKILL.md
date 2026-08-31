---
name: taiwan-stock-research
description: Produce canonical TWSE and TPEx research reports through Vakwen research MCP tools, including identity and authoritative settled price series when available.
---

# Taiwan Stock Research

Use this skill when the user asks to identify or research a Taiwan-listed company, ETF, or ETN and the answer must be grounded in Vakwen's canonical identity store and authoritative settled price-series store.

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
7. If the manifest marks `price_series` as `available` and the user needs market context, call `get_price_series` with that same frozen selector and context. Keep the manifest-listed context fixed, and do not widen scope, basis, metrics, or page settings outside the manifest capabilities.
   - A returned metric's `lineage.state` may be `bounded`; preserve its counts and digest and do not describe the returned boundary sample as the complete observation list.
8. Construct the canonical `research-report/1.0.0` artifact defined in `references/research-report.md`:
   - use `identity_only` when only identity is supported or requested;
   - use `focused_market` when authoritative settled `price_series` is available and relevant.
9. Render Markdown only as a faithful projection of fields and statements already present in that artifact.

## Scope And Eligibility

- `operating_company`: identity is supported and authoritative settled `price_series` may also be supported. Use the manifest to decide whether the report stays `identity_only` or can be `focused_market`.
- `etf_limited`: identify the ETF and retain the limited-profile reason; do not invent holdings, valuation, or performance claims.
- `identity_only`: identify the security and state the returned scope limitation.
- `unknown`, `ineligible`, or `indeterminate`: return the exact eligibility state and reason code. Do not broaden research or substitute another data source.

Treat every manifest dataset marked `unavailable` as unsupported. For market context, use only canonical `price_series` returned by `get_price_series`. Do not call web search, portfolio catalog tools, intraday market-data tools, or upstream providers to fill gaps.

## Guardrails

- Treat MCP `structuredContent` as canonical. Compact text is a summary only.
- Keep raw values, normalized values, missingness, effective time, knowledge time, provenance IDs, and contract versions intact.
- Distinguish settled, intraday, and indicative scope exactly as the manifest and report contract do. `focused_market` covers authoritative settled market context only.
- Do not merge issuers, securities, or listings based only on names or ticker similarity.
- Do not make target-price, buy/sell/hold, suitability, tax, or legal claims.
- Do not add prose claims during rendering. Put any scope statement in the canonical report before rendering it.
- Preserve stable MCP error codes in failures.
