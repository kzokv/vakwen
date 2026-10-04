# Research Material Announcements and Disclosure Artifacts

KZO-247 adds issuer-owned announcement evidence and retained disclosure artifacts to Taiwan research. The public surface has no UI, portfolio access, transaction behavior, sentiment feed, or upstream refresh tool. Existing research identity, financial-statement, and price tools retain their responsibilities.

## Public read contracts

Both tools require explicit `research:read` consent and the enabled research tool group. A portfolio-only connection does not grant research access. Canonical evidence is returned in `structuredContent.result`; text content contains a compact status summary. The tools are read-only, non-destructive, idempotent, closed-world, and forbid background task execution.

| Tool | Initial request | Bounds and result |
|---|---|---|
| `list_material_announcements` | One Listing selector; optional fixed context, publication range, narrower event-date range, evidence view, purposes, order and limit | Default 90-day publication window; maximum two calendar years. Default 25 and maximum 100 complete announcement records. Descending publication order by default, with stable ID tie-breaking. |
| `get_disclosure_artifact` | Repeated Listing selector and opaque retained artifact ID; optional context, evidence view, purposes, order and limit | Default three and maximum ten pages; at most 50,000 exposed Unicode characters. Retained blocks and separately verified claims, with page/total coverage and truncation. |

The Listing selector is `listing_id` or `ticker_venue` with a lossless ticker and explicit `TWSE` or `TPEX` venue. Disclosures belong to the resolved Issuer. The selector is not permission to follow a venue transfer or attach evidence to another issuer.

Publication bounds determine when an announcement became knowable. Event dates may narrow that range but do not replace it. The service preserves publication precision, original publication fields, title, rule clause, event date, issuer explanation, attachment references, and correction/retraction relations.

Explanation text is limited to 20,000 Unicode characters per announcement. The response states original and retained counts, exact truncation, source location, hash and source URL. An explanation artifact permits inspection beyond the inline limit. Dataset tools do not translate, summarize, assign sentiment, or classify catalysts.

Both initial requests accept `evidenceView`, defaulting to `selected_with_conflicts`; `all_observations` explicitly requests retained audit history. The default announcement view excludes explicitly superseded observations while retaining unresolved equal-authority conflict participants. Selection metadata records selected/conflicting IDs, excluded counts, reasons and policy version. Correction and retraction relations remain available across page boundaries.

Optional `purposes` accepts at most twenty unique IDs from the versioned registry advertised by the manifest: `factual_use`, `current_assessment`, and `exhaustive_conclusion`. Omission evaluates all three. The response reports readiness separately for each requested purpose. Evidence view and purposes are bound into the continuation chain.

### Continuations and budgets

Continue with only the repeated `subject` and `cursor`. Do not repeat or change context, artifact ID, range, ordering, or limit. A signed cursor binds the immutable Listing, normalized query, fixed temporal context, versions, operation and authenticated connector context. Artifact cursors also bind content hash and extraction version. Chains expire after 24 hours.

Character caps and serialized response-byte budgets are separate. Responses preserve complete records and expose response-budget truncation; an oversized indivisible record returns `record_too_large`. Callers must not interpret an incomplete page chain as exhaustive evidence.

### Artifact authorization and exposure

An artifact must be referenced by the selected issuer's retained announcement attachment or independently retained material-reference record. Arbitrary URLs, unrelated IDs, generic provenance objects and financial-statement bulk XBRL are rejected. The material-reference seam does not add investor-material discovery.

Reads never fetch a source, extract a file, append evidence, enqueue work, populate a cache or change freshness. Restricted, indeterminate and failed extraction states preserve safe metadata while withholding bulk content. Missing retained content may return a typed acquisition state when a valid reference exists; a store failure returns a tool error rather than empty evidence.

Blocks retain source page/table location, subject, period, unit and extraction context. Unknown period/unit remains explicitly unknown. Raw extraction or OCR does not become a verified publisher claim automatically. Claim exposure requires matching subject, cited blocks, location, qualifiers and knowledge cutoff. Retained source bytes are internal; they are not included in public MCP output.

## Acquisition and persistence

Research-enabled pg-boss startup registers `research-disclosure-acquisition`, runs it at startup, and schedules `*/15 * * * *`. Internal ingestion uses official MOPS-origin routes for both boards:

- TWSE: `https://openapi.twse.com.tw/v1/opendata/t187ap04_L`
- TPEx: `https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O`

For each snapshot record, ingestion also uses the verified official MOPS SPA history and detail routes, `https://mops.twse.com.tw/mops/api/t05st01` and `https://mops.twse.com.tw/mops/api/t05st01_detail`. It verifies issuer/board/date/sequence routing before retaining issuer-authored detail, attachment references and explicit correction links. A denied or malformed detail response is recorded in independent `detailQuality`; usable snapshot explanation survives.

These feeds are recent snapshots, not a two-year history API. A successful fetch does not establish historical or attachment-discovery completeness. Native field differences include TWSE's trailing-space `主旨 ` key and TPEx's `SecuritiesCompanyCode`; publication times may omit a leading zero.

Acquisition validates official source URLs, rejects redirects, bounds fetch time and input size, hashes retained content, and performs extraction before persistence. Plain text uses bounded logical pages; HTML extraction preserves table identifiers; PDF extraction uses physical page numbers. Logical text/HTML locations must not be represented as physical PDF pages. Extraction retains evidence without promoting it to verified claims. Failed acquisition attempts are not fabricated empty artifacts.

Migration `124_research_disclosures.sql` adds announcement, artifact, scan and material-reference tables under `research`. Memory and Postgres implementations expose the same append/read contract. Exact replay is idempotent; conflicting reuse of an immutable ID is rejected. Corrections and retractions preserve old evidence and append relations. Report conclusions depending on corrected or retracted evidence are withheld until supported by the replacement evidence.

Publication/effective time and retrieval/processing/knowledge time are independently constrained. Later evidence must not appear in an earlier knowledge-time report. Parent-source provenance and retained artifact provenance must remain distinguishable so artifact bytes, hashes, extraction versions and acquisition records can be audited.

## Readiness and focused reports

The official collection check is current through 30 minutes, indeterminate after 30 minutes through two hours, and stale after two hours. Announcement observations themselves do not expire; freshness belongs to the collection check. Source failure does not refresh old evidence. A failed refresh preserves the most recent successful scan as the selected scan until its own freshness boundary. `scan.latestAttempt` independently exposes the failed attempt; current-assessment readiness is degraded while the selected successful scan remains current, then blocked when that scan becomes indeterminate or stale.

A current official scan is mandatory for current catalyst/risk assessment and the disclosure prerequisite of final recommendation. Artifact restrictions or missing pages withhold only dependent claims. A current but non-exhaustive scan cannot establish the absence of other announcements. Authority, confidence, completeness, freshness and purpose readiness are separate fields.

The focused report uses a fixed manifest context and bounded calls to the store-only services. Its standard scan is twelve months; its focused scan is ninety days and explicitly non-exhaustive. A standard report may request a 13–24 month extension with an explicit unresolved corporate-action, litigation, financing, restructuring or long-lived thesis reason and a named thesis item. Focused reports reject extensions. English and Traditional Chinese rendering preserve the same original evidence, classifications and withholding decisions.

Catalysts and risks distinguish observed, scheduled, conditional and speculative states. Their triggering evidence, causal mechanism, affected metric or assumption, horizon, confirmation and disconfirmation must be explicit. The factual statement must equal an exact retained publisher excerpt. Observed and scheduled statuses require matching dated publisher evidence and occurrence/scheduling cues; future plans cannot become observed events. Mechanisms and other interpretation remain explicitly provisional analytical judgments, with source support recorded separately. Analyst interpretation is not a publisher Source Fact; an evidence ID alone does not establish that the proposed statement is true. Unsupported sentiment and directional investment instructions are outside this report.

This focused profile does not evaluate the remaining mandatory financial, revenue, price and valuation gates. It therefore issues no final recommendation even when its disclosure prerequisite passes. Original publisher wording remains available alongside rendered analysis.

## Operator recovery and rollback

The existing research gates remain default-off: `MCP_RESEARCH_ACQUISITION_ENABLED`, `MCP_RESEARCH_MCP_ENABLED`, and `MCP_RESEARCH_SKILL_ENABLED`. The independent `MCP_RESEARCH_ANNOUNCEMENTS_TWSE_ENABLED` and `MCP_RESEARCH_ANNOUNCEMENTS_TPEX_ENABLED` acquisition switches also default to false. A board's worker route requires its switch and the global acquisition gate. Turning a board's acquisition switch off preserves retained store reads. Enable acquisition and canonical identity readiness before exposing reads. Research reads do not offer an ad hoc refresh or extraction action.

For missing or stale scans, inspect scheduled worker execution and the board-specific acquisition outcome. For restricted sources, retain the restriction state and retry through the permitted scheduled path; do not bypass access controls. For processing failures, repair and version the parser/extractor, retain original evidence, and create a new valid acquisition/processing revision. For identity ambiguity, resolve canonical issuer/Listing identity before retrying. For immutable conflicts, investigate ID/provenance reuse rather than overwriting retained history.

Rollback disables research exposure/Skill/acquisition gates and rolls back application code while leaving additive research tables intact. Preserve retained evidence for diagnosis and replay. Re-enable only after source, identity, lineage and affected-purpose checks pass.

## Verification and limits

Deterministic tests cover public MCP schemas and authorization, both board routes, temporal selection, cursor binding, pagination, correction/retraction, restricted/failed artifacts, extraction, report withholding, and no read-side acquisition. Managed Postgres tests cover persistence parity, immutable replay and restart durability.

Focused verification exercises real OAuth consent and public MCP-to-report composition for both boards; negative cases cover scope denial, cross-principal cursor replay, source/artifact restrictions, whole-store/audit outage redaction, schema branch consistency, and dependent-only withholding. These checks establish the tested contract behaviors, not rollout readiness. The delivery PR's Testing/Evidence section is the authoritative record for exact commands, final outcomes and the complete eight-suite gate; a focused pass must not be read as an all-tests-pass claim.

Live verification fetched and retained one TWSE snapshot (five rows) and one TPEx snapshot (four rows). Official MOPS SPA history/detail responses were also captured for TWSE 2072 and TPEx 4530, with an additional 2330 detail capture. Those captures prove endpoint/field behavior at that time; they do not prove historical coverage, complete attachment discovery, sustained provider health, or rollout promotion. Live-source restrictions must remain visible separately from deterministic test results.
