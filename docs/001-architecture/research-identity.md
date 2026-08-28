# Taiwan Research Identity

KZO-246 delivers an identity-only research vertical. It is separate from the legacy instrument catalog and portfolio market-data paths.

## Data flow

1. A positive-gated pg-boss worker fetches declared official TWSE and TPEx snapshots, including the TWSE securities-firm master and explicit ETN retirement tables. ETF absence retirement is fail-closed: provider success and non-empty payloads are required, and a venue snapshot that omits more than the 1% completeness guard is rejected before any records append. After a complete current ETF snapshot, a previously active ETF absent from that venue's current feed receives an inactive revision at the snapshot date.
2. Provider adapters validate source-native fields, preserve ticker strings, normalize dates and numeric values, and retain raw values alongside normalized values.
3. Canonicalization assigns opaque stable `Issuer`, `Security`, and effective-dated `Listing` IDs. Company IDs use the official unified business number. ETF IDs use the fund business number when the source publishes it; the TPEx ETF feed instead uses a venue-scoped key composed only from its official issuer, ticker, and listing-date identifiers. ETN issuer IDs use the securities-firm master's business number. ETN Security IDs use an official contract identity derived from that issuer identity, venue, listing and maturity dates, underlying index, and note type; mutable ticker, legal name, and display name are not ID inputs. An unresolved ETN issuer fails acquisition instead of producing an unstable fallback ID.
4. Memory and PostgreSQL append immutable revisions. Reads apply both `effectiveAt` and `knowledgeAt` cutoffs. Equal effective/retrieval timestamps use a shared semantic precedence so explicit status-only revisions sort after full snapshots in both backends. Scheduled acquisition reads one bounded latest revision per Listing and venue rather than materializing each Listing's complete immutable history.
5. Store-only services resolve exactly one listing and return a fixed temporal context. They never fetch upstream data. Effective and as-recorded assessments return persisted eligibility; re-evaluation requests fail explicitly until versioned policy-set evaluation is implemented. Identity provenance is bounded to sources supporting the current facts and requested history page.
6. MCP exposes concrete object schemas for `get_research_manifest` and `get_research_identity` under `research:read`. Each structured response has one required `result` field whose value is a strict success-or-error union; empty, truncated, and mixed success/error payloads are rejected.
7. The `taiwan-stock-research` Skill freezes the returned listing/context and produces a canonical `research-report/1.0.0` identity-only artifact before rendering Markdown.

## Canonical persistence

Migration `116_research_identity_history.sql` creates `research.identity_records`; migration `117_research_identity_revision_precedence.sql` adds the stored semantic tie-breaker; migration `118_research_identity_latest_listing_index.sql` adds the venue/listing temporal index used by bounded acquisition reads. Each row stores selector and temporal columns for indexed queries plus the complete canonical JSON record. `record_key` is derived from provenance and listing IDs; retries of the same acquisition record are idempotent and never overwrite earlier history, while a later retrieval remains a distinct knowledge-time observation.

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
- Ticker/venue resolution compares the selector with each candidate Listing's effective latest ticker state. An obsolete ticker fails with `research_subject_not_found`; if it has been reassigned, only the new Listing remains a candidate.
- A ticker/venue resolving to more than one effective latest listing fails with `research_subject_ambiguous`.
- When a ticker has been reused, a known inactive predecessor does not make the sole active Listing ambiguous. If knowledge-time evidence still leaves multiple Listings active, resolution fails closed.
- Reads return only records whose effective and retrieval timestamps are within the fixed context, preventing future-information leakage.
- History cursors are opaque and bound to the immutable Listing plus the complete fixed temporal context; cross-subject or cross-context reuse fails with `research_cursor_invalid`.
- Manifest output is unpaginated status metadata for exactly eleven canonical dataset IDs. In this release only `research_identity` is available.
