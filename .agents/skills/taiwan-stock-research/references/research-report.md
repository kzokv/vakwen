# Identity-Only ResearchReport Contract

Construct this canonical shape from `get_research_manifest` and `get_research_identity` structured content:

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

## Faithful Markdown Projection

Markdown may add headings, labels, bullets, escaping, and layout only. Every factual value and scope statement must come from the canonical report artifact.

Include:

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

Do not add interpretations, comparisons, recommendations, current prices, financial metrics, or source material absent from the artifact.
