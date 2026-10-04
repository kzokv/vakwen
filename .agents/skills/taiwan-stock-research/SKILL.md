---
name: taiwan-stock-research
description: Produce canonical TWSE and TPEx identity, settled-market, monthly-revenue, MOPS financial-statement, or material-announcement research through Vakwen research MCP tools.
---

# Taiwan Stock Research

Use this skill when a Taiwan-listed company, ETF, or ETN must be researched from Vakwen's canonical, effective-dated identity, settled-price, monthly-revenue, MOPS financial-statement, and official disclosure stores.

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
   - Always call `get_research_identity` with the frozen selector and context so every report carries the canonical issuer, security, listing, and eligibility objects. Request and page identity history only when relevant.
   - Then call `get_monthly_revenue` for requested revenue research only when `monthly_revenue` is available.
   - Then call `get_financial_statements` for requested fundamentals research only when `financial_statements` is available. Treat official MOPS iXBRL/XBRL as authoritative, preserve cumulative Source Facts versus discrete derived statements, and keep filing basis, taxonomy, context, and unit ambiguity explicit.
   - Then call `get_price_series` for requested market context only when `price_series` is available. Keep scope, basis, metrics, and page settings within manifest capabilities. Preserve bounded-lineage counts and digest.
   - For disclosure/catalyst/risk research, call `list_material_announcements` when `material_announcements` is available. A standard pass requests twelve months; a focused pass requests ninety days and explicitly labels coverage non-exhaustive. Extend up to two years only for unresolved long-lived thesis items. Publication bounds are mandatory; event dates only narrow them.
   - Retrieve `get_disclosure_artifact` only for retained artifact IDs referenced by this subject's announcement/material evidence and needed by a declared claim. Never supply a URL, acquire/extract during a read, or use metadata as evidence of content. Use the same frozen context; page within declared budgets and record incomplete pagination.
   - Run the internal disclosure specialist using structured candidates with triggering evidence, material mechanism, affected metric/assumption, horizon, confirming/disconfirming evidence, and `observed`, `scheduled`, `conditional`, or `speculative` status. Keep analyst interpretation separate from publisher Source Facts. Newsworthiness alone is context; omit unsupported sentiment.
7. Construct the canonical artifact from `references/research-report.md`:
   - `research-report/4.0.0` with profile `focused_disclosures` for material-announcement research;
   - `research-report/2.0.0` with profile `monthly_revenue` for supported revenue research;
   - `research-report/3.0.0` with profile `financial_statement_fundamentals` for supported or withheld financial-statement fundamentals;
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
- Treat financial-statement filing facts as MOPS-authoritative only. Never substitute MOPS convenience summaries, FinMind, or synthetic quarters for financial-statement coverage.
- Financial-statement minimum windows are fixed: latest due YoY needs the latest due filing plus the prior-year comparable, multi-year trend needs 3 complete annual periods, and quarterly trend/seasonality needs 8 comparable discrete quarters.
- Withhold unsupported financial-statement claims when required statements are missing, basis/taxonomy/context ambiguity remains unresolved, units are unknown, the sector is unsupported, or the required window is incomplete.
- Do not merge issuers, securities, or listings based only on names or ticker similarity.
- Do not make forecasts, target-price, buy/sell/hold, suitability, tax, or legal claims.
- Do not add prose claims during rendering; scope and conclusion statements must already exist in the canonical artifact.
- Preserve stable MCP error codes in failures.

## Disclosure evidence and readiness

- Preserve original publisher titles and explanations, correction and retraction relations, exact text/page truncation, safe source links, artifact hash, page/table location, subject, period, unit, extraction version, and provenance. Superseded or retracted facts cannot support current claims; their history remains visible.
- Raw text/OCR is provisional extraction. Only separately verified canonical claims can support artifact-dependent factual assertions; missing subject, period, unit, value, or page/table verification withholds that assertion.
- Current official collection scan means a successful authoritative check within thirty minutes of the fixed context. More than thirty minutes through two hours is indeterminate; more than two hours is stale. Event facts themselves do not expire.
- A non-current official scan withholds current catalyst/risk assessment and fails the disclosure prerequisite for final recommendation, while independently supported historical facts remain visible.
- An unavailable, access-restricted, or processing-failed artifact withholds only its dependent claims. Bounded or non-exhaustive coverage cannot support exhaustive claims; it does not by itself invalidate unrelated supported claims or a current successful scan.
- A focused disclosure report never issues a final recommendation: price, revenue, financials, valuation, identity, confidence, and conflict gates must also be evaluated by the full composer. A passed disclosure gate is only one prerequisite.
- Render only statements, evidence references, classification, reasons, limitations, and recovery requirements already present in the validated structured report. Do not infer bullishness, bearishness, or an action from an announcement title.

- Disclosure specialist factual statements must equal an exact publisher excerpt verified against the referenced explanation or separately verified artifact claim. Observed/scheduled classifications require explicit dated occurrence/schedule evidence; a future plan cannot be observed. Mechanisms, affected assumptions, and horizons remain labelled provisional analytical judgments, separate from `sourceSupport`.
- `standard` extensions from thirteen through twenty-four months require an explicit unresolved corporate action, litigation, financing, restructuring, or long-lived thesis item. Focused ninety-day reports cannot silently expand.
- Render with `en` or `zh-TW` labels and policy explanations as requested; preserve original publisher text and claim content identically in both languages.
- Preserve `scan.record` (selected successful scan) separately from `scan.latestAttempt`. A failed refresh does not erase a still-current successful scan or restart its freshness clock. Show the failure and degraded collection readiness; once the selected success crosses thirty minutes, withhold current assessment until a successful scan restores the gate.
