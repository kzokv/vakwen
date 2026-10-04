# ResearchReport Contracts

Construct one of these canonical shapes from `get_research_manifest` and the relevant identity, price-series, or monthly-revenue MCP `structuredContent`.

## Identity-only contract

Use this shape when the user asked for identity research only, or when the dataset required by the requested path is unavailable in the manifest: `monthly_revenue` for revenue research or `price_series` for settled-market research. Revenue availability must not control a settled-market request, and price availability must not control a revenue request.

```json
{
  "contractVersion": "research-report/1.0.0",
  "profile": "identity_only",
  "selector": { "kind": "listing_id", "listingId": "..." },
  "context": {
    "knowledgeAt": "ISO-8601 timestamp",
    "effectiveAt": "ISO-8601 timestamp",
    "assessmentMode": "effective | as_recorded | re_evaluate",
    "policySetVersion": "present only for re_evaluate"
  },
  "generatedAt": "the fixed knowledgeAt timestamp",
  "sections": [
    {
      "id": "identity",
      "issuer": "canonical issuer object",
      "security": "canonical security object",
      "listing": "canonical listing object",
      "legalName": "latest effective normalized value or null",
      "displayName": "latest effective normalized value or null",
      "industryCode": "latest effective normalized value or null"
    },
    {
      "id": "eligibility",
      "profile": "returned eligibility profile",
      "state": "returned eligibility state",
      "reasonCode": "returned eligibility reason code"
    },
    {
      "id": "unsupported_scope",
      "reasonCode": "identity_only_release",
      "statement": "This release supports canonical identity research only; market, financial, ownership, trading, dividend, announcement, and investor-material claims are not included."
    }
  ],
  "evidence": {
    "observationIds": ["every observation used by the report"],
    "provenanceIds": ["each distinct provenance record used by the report"]
  }
}
```

## `focused_market`

Use this profile only when the manifest marks `price_series` as `available`. The `selector`, `context`, and price-series request context must stay identical to the manifest-returned values.

```json
{
  "contractVersion": "research-report/1.0.0",
  "profile": "focused_market",
  "selector": { "kind": "listing_id", "listingId": "..." },
  "context": {
    "knowledgeAt": "ISO-8601 timestamp",
    "effectiveAt": "ISO-8601 timestamp",
    "assessmentMode": "effective | as_recorded | re_evaluate",
    "policySetVersion": "present only for re_evaluate"
  },
  "generatedAt": "the fixed knowledgeAt timestamp",
  "sections": [
    {
      "id": "identity",
      "issuer": "canonical issuer object",
      "security": "canonical security object",
      "listing": "canonical listing object",
      "displayName": "latest effective normalized value or null"
    },
    {
      "id": "market_context",
      "statement": "Market-context research distinguishes settled authoritative closes from intraday and indicative prices, and excludes technical signals, targets, and attractiveness claims.",
      "priceSeries": "the full get_price_series structured content",
      "indicativePricesExcluded": true,
      "intradayPricesExcluded": true,
      "technicalSignalsExcluded": true
    }
  ],
  "evidence": {
    "provenanceIds": ["each distinct identity and price-series provenance record used by the report"],
    "sessionDates": ["each returned sessionDate in the report"]
  }
}
```

## Faithful Markdown Projection

Markdown may add headings, labels, bullets, escaping, and layout only. Every factual value and scope statement must come from the canonical report artifact.

For `identity_only`, include:

- display name
- venue and exact ticker
- listing ID
- legal name
- security type
- industry code or `Not reported`
- eligibility state, profile, and reason code
- effective and knowledge timestamps
- the exact unsupported-scope statement
- every provenance ID

For `focused_market`, include:

- display name
- venue and exact ticker
- listing ID
- effective and knowledge timestamps
- the exact settled-market scope statement
- each returned session, preserving its explicit state (`settled_full_bar`, `settled_close_only`, `no_trade`, `suspended`, `stale`, `missing`, `corporate_action_incomplete`)
- only values already carried by the canonical price-series session
- every provenance ID present in `evidence.provenanceIds`

Do not add interpretations, comparisons, recommendations, current prices, financial metrics, or source material absent from the artifact.

## Monthly-revenue contract

Use this shape when the user asked for revenue research and the manifest marks `monthly_revenue` as `available`. Copy the `conclusion` object exactly from the `get_monthly_revenue` result; do not derive or rewrite its statement in the Skill.

```json
{
  "contractVersion": "research-report/2.0.0",
  "profile": "monthly_revenue",
  "selector": { "kind": "listing_id", "listingId": "..." },
  "context": {
    "knowledgeAt": "ISO-8601 timestamp",
    "effectiveAt": "ISO-8601 timestamp",
    "assessmentMode": "effective | as_recorded | re_evaluate",
    "policySetVersion": "present only for re_evaluate"
  },
  "generatedAt": "the fixed knowledgeAt timestamp",
  "sections": [
    {
      "id": "identity",
      "issuer": "canonical issuer object",
      "security": "canonical security object",
      "listing": "canonical listing object",
      "displayName": "latest effective normalized value or null"
    },
    {
      "id": "eligibility",
      "profile": "returned eligibility profile",
      "state": "returned eligibility state",
      "reasonCode": "returned eligibility reason code"
    },
    {
      "id": "monthly_revenue",
      "freshness": "returned monthly revenue freshness object",
      "latestMonth": "latest returned YYYY-MM month or null",
      "latestRecord": "the complete latest returned monthly-revenue item, including publication context, raw and normalized source facts, publisher comparisons, basis-change state, and derived metrics, or null",
      "latestYearOverYearPercent": "returned derived metric object or null"
    }
  ],
  "conclusion": {
    "status": "supported | withheld",
    "statement": "exact get_monthly_revenue conclusion statement",
    "reasonCodes": ["exact get_monthly_revenue reason codes"]
  },
  "evidence": {
    "provenanceIds": ["each distinct provenance record used by the report"]
  }
}
```

## Faithful monthly-revenue Markdown projection

Markdown may add headings, labels, bullets, escaping, and layout only. Every factual value and conclusion statement must come from the canonical report artifact.

Include:

- display name when present in the identity section, otherwise venue and exact ticker
- listing ID
- effective and knowledge timestamps
- latest returned revenue month or `Not available`
- freshness latest expected month and due status
- latest record publication context, raw and normalized source facts, publisher comparisons, and basis-change state when present
- the latest returned YoY metric status and value or withheld reason
- conclusion status, exact statement, and every reason code
- every provenance ID

Do not add forecasts, recommendations, valuation claims, or any conclusion that is stronger than the returned `conclusion` object.

## Financial-statement fundamentals contract

Use this shape when the user asked for financial-statement fundamentals and the manifest marks `financial_statements` as `available`. The source of record is the canonical store populated only from official MOPS XBRL or iXBRL artifacts.

```json
{
  "contractVersion": "research-report/3.0.0",
  "profile": "financial_statement_fundamentals",
  "selector": { "kind": "listing_id", "listingId": "..." },
  "context": {
    "knowledgeAt": "ISO-8601 timestamp",
    "effectiveAt": "ISO-8601 timestamp",
    "assessmentMode": "effective | as_recorded | re_evaluate",
    "policySetVersion": "present only for re_evaluate"
  },
  "generatedAt": "the fixed knowledgeAt timestamp",
  "sections": [
    {
      "id": "identity",
      "issuer": "canonical issuer object",
      "security": "canonical security object",
      "listing": "canonical listing object",
      "displayName": "latest effective normalized value or null"
    },
    {
      "id": "minimum_windows",
      "windows": {
        "latestYearOverYear": "latest due filing plus prior-year comparable",
        "multiYearTrendAnnualPeriods": 3,
        "quarterlyTrendDiscreteQuarters": 8
      }
    },
    {
      "id": "independent_facts",
      "sector": "returned sector classification",
      "periods": [
        {
          "fiscalYear": 2025,
          "fiscalPeriod": "annual | q1 | q2 | q3 | q4",
          "basis": "consolidated | individual | unknown",
          "taxonomyVersion": "returned taxonomy version or null",
          "requiredStatementsPresent": true,
          "issues": {
            "basisAmbiguity": false,
            "taxonomyAmbiguity": false,
            "contextAmbiguity": false,
            "unknownUnitIds": []
          },
          "facts": ["selected independent source facts already carried by the stored artifact"]
        }
      ]
    }
  ],
  "conclusions": [
    {
      "id": "latest_revenue_yoy | multi_year_revenue_trend | quarterly_revenue_trend",
      "status": "supported | withheld",
      "statement": "exact canonical statement",
      "reasonCodes": ["exact canonical withholding reasons when present"]
    }
  ],
  "evidence": {
    "provenanceIds": ["each distinct financial-statement provenance record used by the report"]
  }
}
```

### Financial-statement guardrails

- Treat official MOPS iXBRL or XBRL only as authoritative for financial-statement coverage.
- Preserve filing revisions, amendments, restatements, taxonomy version, unit metadata, context metadata, duplicate contexts, unknown units, and unmapped concepts explicitly.
- Distinguish cumulative Source Facts from any discrete-quarter derived output; never claim a synthetic quarter as a source fact.
- Withhold conclusions for unsupported sectors, missing required statements, unresolved basis or taxonomy or context ambiguity, unknown units, or insufficient windows.
- Do not forecast, value, recommend, or rank securities from this artifact.
