---
name: taiwan-stock-research
description: Produce canonical TWSE and TPEx identity, settled-market, or monthly-revenue research through Vakwen research MCP tools.
---

# Taiwan Stock Research

Use this skill when a Taiwan-listed company, ETF, or ETN must be researched from Vakwen's canonical, effective-dated identity, settled-price, and monthly-revenue stores.

Read `references/research-report.md` before producing a report.

## Required Workflow

1. Establish exactly one subject selector:
   - Prefer an existing `listing_id` when supplied.
   - Otherwise require the exact ticker string and `TWSE` or `TPEX` venue.
   - Never convert a ticker to a number, remove leading zeroes, infer the venue, or silently choose among ambiguous listings.
2. Establish one fixed temporal context:
   - `knowledgeAt` is required.
   - Default `effectiveAt` to `knowledgeAt` and `assessmentMode` to `effective`.
   - Require `policySetVersion` for `re_evaluate` mode.
3. Call `get_research_manifest` first with that selector and context.
4. Inspect the manifest before continuing:
   - Stop if `orchestration.skillExposure` is not `enabled`.
   - Stop with the exact dataset status and reason if `research_identity` is unavailable.
   - Preserve unknown or ambiguous subject error codes and request only the selector detail needed to resolve them.
5. Freeze the manifest-returned `listing_id` selector and temporal context for every following call.
6. Choose the report path from the user request and manifest:
   - Call `get_monthly_revenue` for requested revenue research only when `monthly_revenue` is available.
   - Call `get_price_series` for requested market context only when `price_series` is available. Keep scope, basis, metrics, and page settings within manifest capabilities. Preserve bounded-lineage counts and digest.
   - Otherwise call `get_research_identity`; request and page history only when relevant.
7. Construct the canonical artifact from `references/research-report.md`:
   - `research-report/2.0.0` with profile `monthly_revenue` for supported revenue research;
   - `research-report/1.0.0` with profile `focused_market` for supported settled-market context;
   - `research-report/1.0.0` with profile `identity_only` otherwise.
8. Render Markdown only as a faithful projection of the artifact.

## Scope And Eligibility

- `operating_company`: identity is supported; use manifest availability to decide whether price or revenue research is supported.
- `etf_limited`: identify the ETF and retain the limited-profile reason; do not invent holdings, valuation, or performance claims.
- `identity_only`: identify the security and state the returned scope limitation.
- `unknown`, `ineligible`, or `indeterminate`: return the exact eligibility state and reason code.

Treat every unavailable manifest dataset as unsupported. Do not use web search, portfolio catalog tools, intraday market-data tools, or upstream providers to fill gaps.

## Guardrails

- Treat MCP `structuredContent` as canonical; compact text is a summary only.
- Preserve raw and normalized values, explicit missingness, effective and knowledge times, provenance IDs, and contract versions.
- Distinguish settled, intraday, and indicative prices exactly; `focused_market` covers authoritative settled context only.
- Treat monthly-revenue publisher comparisons as Source Facts and preserve derived-metric lineage and withholding reasons.
- Do not merge issuers, securities, or listings based only on names or ticker similarity.
- Do not make forecasts, target-price, buy/sell/hold, suitability, tax, or legal claims.
- Do not add prose claims during rendering; scope and conclusion statements must already exist in the canonical artifact.
- Preserve stable MCP error codes in failures.
