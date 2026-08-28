# Taiwan Research Identity

KZO-246 delivers an identity-only research vertical. It is separate from the legacy instrument catalog and portfolio market-data paths.

## Data flow

1. A positive-gated pg-boss worker fetches declared official TWSE and TPEx snapshots.
2. Provider adapters validate source-native fields, preserve ticker strings, normalize dates and numeric values, and retain raw values alongside normalized values.
3. Canonicalization assigns opaque stable `Issuer`, `Security`, and effective-dated `Listing` IDs. Company IDs use the official unified business number. ETF IDs use the fund business number when the source publishes it; the TPEx ETF feed instead uses a venue-scoped key composed only from its official issuer, ticker, and listing-date identifiers. ETN issuer IDs use the official issuer identity available in the ETN feed.
4. Memory and PostgreSQL append immutable revisions. Reads apply both `effectiveAt` and `knowledgeAt` cutoffs.
5. Store-only services resolve exactly one listing and return a fixed temporal context. They never fetch upstream data.
6. MCP exposes concrete strict schemas for `get_research_manifest` and `get_research_identity` under `research:read`.
7. The `taiwan-stock-research` Skill freezes the returned listing/context and produces a canonical `research-report/1.0.0` identity-only artifact before rendering Markdown.

## Canonical persistence

Migration `116_research_identity_history.sql` creates `research.identity_records`. Each row stores selector and temporal columns for indexed queries plus the complete canonical JSON record. `record_key` is derived from provenance and listing IDs; retries of the same acquisition record are idempotent and never overwrite earlier history, while a later retrieval remains a distinct knowledge-time observation.

Identity revisions carry:

- raw and normalized source facts with explicit missingness
- effective, retrieval, and processing timestamps
- publisher, exact access provider (`TWSE_OPENAPI`, `TPEX_OPENAPI`, `TWSE_WEB_JSON`, or `TPEX_WEB_JSON`), authority role, source URL, content hash, acquisition run, parser version, usage policy, retention, and exposure metadata
- operating-company, ETF-limited, identity-only, or unknown eligibility
- active/inactive listing status and predecessor listing linkage for venue transfers

## Query invariants

- A selector is exactly `listing_id` or `ticker_venue`.
- Tickers remain strings; leading zeroes and alphanumeric suffixes are significant.
- `effectiveAt` must not exceed `knowledgeAt`.
- A ticker/venue resolving to more than one effective listing fails with `research_subject_ambiguous`.
- When a ticker has been reused, a known inactive predecessor does not make the sole active Listing ambiguous. If knowledge-time evidence still leaves multiple Listings active, resolution fails closed.
- Reads return only records whose effective and retrieval timestamps are within the fixed context, preventing future-information leakage.
- History cursors are opaque and bound to the immutable Listing plus the complete fixed temporal context; cross-subject or cross-context reuse fails with `research_cursor_invalid`.
- Manifest output is unpaginated status metadata for exactly eleven canonical dataset IDs. In this release only `research_identity` is available.
